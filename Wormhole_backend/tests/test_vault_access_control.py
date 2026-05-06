"""Task 34 regression: vault endpoints reject non-members.

The vault is a per-space shared store. All members of the space share one
passphrase, so any cross-space leak (a non-member receiving the salt /
check ciphertext / file list) breaks the security model: it lets the
non-member mount an offline brute-force attack against another space's
passphrase. These tests pin the access-control contract on
`/api/vault/*` so future refactors can't silently drop the membership
check.

See `docs/audits/2026-05-vault.md` F6 for the threat model.
"""
import pytest
import pytest_asyncio


@pytest_asyncio.fixture(autouse=True)
async def _reset_limiter():
    """Flush the process-wide slowapi counter before each test.

    `app.utils.limiter.limiter` is a module-level `Limiter` instance whose
    in-memory counter persists across tests run in the same process. The
    auth-login endpoint allows only 10/minute and we hit it many times per
    test, so without this reset the suite gets random 429s once the bucket
    fills up.
    """
    from app.utils.limiter import limiter

    limiter.reset()
    yield
    limiter.reset()


def _extract(body: dict, *keys):
    for k in keys:
        if k in body and body[k] is not None:
            return body[k]
    nested = body.get("data") or {}
    for k in keys:
        if k in nested and nested[k] is not None:
            return nested[k]
    return None


async def _login(client, code: str):
    resp = await client.post("/api/auth/login", json={"code": code})
    assert resp.status_code == 200
    body = resp.json()
    openid = _extract(body, "openid")
    token = _extract(body, "access_token")
    assert openid and token
    return openid, token


async def _enter_space(client, openid: str, token: str, space_code: str = "777777"):
    headers = {"Authorization": f"Bearer {token}", "X-User-Id": openid}
    resp = await client.post(
        "/api/space/enter",
        json={"space_code": space_code, "user_id": openid, "create_if_missing": True},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return int(resp.json()["space_id"])


def _auth(openid: str, token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "X-User-Id": openid}


@pytest.mark.asyncio
async def test_vault_status_rejects_non_member(client):
    """A user who is not a member of the space cannot read /vault/status.

    The endpoint returns the salt + check ciphertext that an offline
    PBKDF2 brute-forcer needs, so leaking it to a non-member would
    let them attack the passphrase from a single status response.
    """
    owner_id, owner_token = await _login(client, "vault_owner")
    space_id = await _enter_space(client, owner_id, owner_token, space_code="777111")

    intruder_id, intruder_token = await _login(client, "vault_intruder")
    resp = await client.get(
        "/api/vault/status",
        params={"space_id": space_id, "user_id": intruder_id},
        headers=_auth(intruder_id, intruder_token),
    )
    assert resp.status_code in (403, 404), resp.text


@pytest.mark.asyncio
async def test_vault_files_rejects_non_member(client):
    """`/vault/files` must not list a vault to non-members."""
    owner_id, owner_token = await _login(client, "vault_owner_b")
    space_id = await _enter_space(client, owner_id, owner_token, space_code="777222")

    intruder_id, intruder_token = await _login(client, "vault_intruder_b")
    resp = await client.get(
        "/api/vault/files",
        params={"space_id": space_id, "user_id": intruder_id},
        headers=_auth(intruder_id, intruder_token),
    )
    assert resp.status_code in (403, 404), resp.text


@pytest.mark.asyncio
async def test_vault_init_rejects_non_member(client):
    """A non-member cannot initialize someone else's vault."""
    owner_id, owner_token = await _login(client, "vault_owner_c")
    space_id = await _enter_space(client, owner_id, owner_token, space_code="777333")

    intruder_id, intruder_token = await _login(client, "vault_intruder_c")
    resp = await client.post(
        "/api/vault/init",
        json={
            "space_id": space_id,
            "user_id": intruder_id,
            "key_salt": "AAAA",
            "kdf_algo": "pbkdf2-sha256",
            "kdf_iterations": 100000,
            "check_nonce": "BBBB",
            "check_ciphertext": "CCCC",
            "check_tag": "DDDD",
        },
        headers=_auth(intruder_id, intruder_token),
    )
    assert resp.status_code in (403, 404), resp.text


@pytest.mark.asyncio
async def test_vault_init_floor_rejects_low_iterations(client):
    """Audit F1: schema floor of 100k must reject e.g. kdf_iterations=10000."""
    owner_id, owner_token = await _login(client, "vault_owner_d")
    space_id = await _enter_space(client, owner_id, owner_token, space_code="777444")

    resp = await client.post(
        "/api/vault/init",
        json={
            "space_id": space_id,
            "user_id": owner_id,
            "key_salt": "AAAA",
            "kdf_algo": "pbkdf2-sha256",
            "kdf_iterations": 10000,  # below new floor
            "check_nonce": "BBBB",
            "check_ciphertext": "CCCC",
            "check_tag": "DDDD",
        },
        headers=_auth(owner_id, owner_token),
    )
    # Pydantic field validation surfaces as 422.
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_vault_status_member_can_read(client):
    """Sanity: an actual space member can read /vault/status (uninitialized)."""
    owner_id, owner_token = await _login(client, "vault_owner_e")
    space_id = await _enter_space(client, owner_id, owner_token, space_code="777555")

    resp = await client.get(
        "/api/vault/status",
        params={"space_id": space_id, "user_id": owner_id},
        headers=_auth(owner_id, owner_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["initialized"] is False
    # max_file_bytes is always echoed so the client can size-check uploads.
    assert int(body["max_file_bytes"]) > 0
