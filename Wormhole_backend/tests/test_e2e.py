"""End-to-end smoke tests covering core user flows.

Each test drives the FastAPI app through httpx.AsyncClient against a fresh
in-memory DB (see conftest.py). They are intentionally light on assertions
— the goal is "this happy path returns 2xx and produces the expected ID",
not "every field is correct" — so they catch regressions without becoming
brittle to harmless schema additions.
"""
import pytest


def _extract(body: dict, *keys):
    """Look up `keys` first at the top level, then under `data`.

    The codebase mixes flat and nested response shapes; this helper hides
    that so individual tests don't have to spell out both forms.
    """
    for k in keys:
        if k in body and body[k] is not None:
            return body[k]
    nested = body.get("data") or {}
    for k in keys:
        if k in nested and nested[k] is not None:
            return nested[k]
    return None


@pytest.mark.asyncio
async def test_health_check(client):
    """/healthz must stay cheap and always-on."""
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.asyncio
async def test_dev_login_returns_openid(client):
    """Dev login (no WeChat creds + fallback flag) returns dev_<code> openid."""
    resp = await client.post("/api/auth/login", json={"code": "alice"})
    assert resp.status_code == 200
    body = resp.json()
    openid = _extract(body, "openid")
    assert openid == "dev_alice"
    # Token must be present so subsequent requests can authenticate.
    assert _extract(body, "access_token")


@pytest.mark.asyncio
async def test_enter_space_creates_when_missing(client):
    """Entering a 6-digit code with create_if_missing=True provisions a space."""
    login = await client.post("/api/auth/login", json={"code": "bob"})
    body = login.json()
    openid = _extract(body, "openid")
    token = _extract(body, "access_token")
    assert openid and token

    headers = {"Authorization": f"Bearer {token}", "X-User-Id": openid}
    resp = await client.post(
        "/api/space/enter",
        json={"space_code": "888888", "user_id": openid, "create_if_missing": True},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("success") is True
    assert isinstance(body.get("space_id"), int)


@pytest.mark.asyncio
async def test_create_feed_post_and_like(client):
    """Create a feed post, like it, and verify the like_count increments."""
    # Login + enter space
    login = await client.post("/api/auth/login", json={"code": "carol"})
    body = login.json()
    openid = _extract(body, "openid")
    token = _extract(body, "access_token")
    headers = {"Authorization": f"Bearer {token}", "X-User-Id": openid}

    enter = await client.post(
        "/api/space/enter",
        json={"space_code": "777777", "user_id": openid, "create_if_missing": True},
        headers=headers,
    )
    assert enter.status_code == 200
    space_id = enter.json()["space_id"]

    # Create a text post (media_type=none + non-empty content is the
    # minimum the route accepts; see schemas/feed.py PostCreate).
    create = await client.post(
        "/api/feed/create",
        json={
            "space_id": space_id,
            "user_id": openid,
            "content": "hello world",
            "media_type": "none",
            "media_urls": [],
        },
        headers=headers,
    )
    assert create.status_code == 200, create.text
    post_body = create.json()
    post_id = post_body["id"]
    assert isinstance(post_id, int)

    # Like the post.
    like = await client.post(
        "/api/feed/like",
        json={"post_id": post_id, "user_id": openid, "like": True},
        headers=headers,
    )
    assert like.status_code == 200, like.text
    like_body = like.json()
    assert like_body.get("success") is True
    assert like_body.get("like_count") == 1
    assert like_body.get("liked") is True


@pytest.mark.asyncio
async def test_chat_history_empty_for_fresh_space(client):
    """A newly-entered space has an empty chat history."""
    login = await client.post("/api/auth/login", json={"code": "dave"})
    body = login.json()
    openid = _extract(body, "openid")
    token = _extract(body, "access_token")
    headers = {"Authorization": f"Bearer {token}", "X-User-Id": openid}

    enter = await client.post(
        "/api/space/enter",
        json={"space_code": "666666", "user_id": openid, "create_if_missing": True},
        headers=headers,
    )
    space_id = enter.json()["space_id"]

    resp = await client.get(
        f"/api/chat/history?space_id={space_id}",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("messages") == []
