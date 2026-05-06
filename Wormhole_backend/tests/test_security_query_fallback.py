"""Verify that HTTP auth helpers do NOT fall back to user_id in URL query.

Query parameters leak into proxy/CDN/server logs and are easy to forge,
so accepting them as an identity assertion on HTTP routes is a security hole.
WebSocket endpoints keep the query fallback because WeChat MiniProgram's
wx.connectSocket cannot reliably attach custom headers (CDN strips them).
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import security


class _Headers:
    """Case-insensitive headers shim mirroring Starlette's Headers.get."""

    def __init__(self, mapping):
        self._mapping = {k.lower(): v for k, v in (mapping or {}).items()}

    def get(self, key, default=None):
        return self._mapping.get(key.lower(), default)


def _make_request(*, query=None, headers=None, path="/api/test", method="GET"):
    """Minimal FastAPI Request stand-in for unit-testing security helpers."""
    return SimpleNamespace(
        headers=_Headers(headers or {}),
        query_params=query or {},
        client=None,
        url=SimpleNamespace(path=path),
        method=method,
    )


def test_get_http_user_id_ignores_query():
    """user_id arriving via ?user_id= must NOT authenticate the request."""
    req = _make_request(query={"user_id": "oeXXX"})
    assert security.get_http_user_id(req) is None


def test_get_http_user_id_ignores_alternate_query_keys():
    """Other historical query aliases must also be ignored on HTTP."""
    for key in ("operator_user_id", "auth_user", "openid"):
        req = _make_request(query={key: "oeXXX"})
        assert security.get_http_user_id(req) is None, (
            f"HTTP path must ignore ?{key}=... query identity"
        )


def test_get_http_user_id_accepts_x_user_id_header():
    req = _make_request(headers={"x-user-id": "oeYYY"})
    assert security.get_http_user_id(req) == "oeYYY"


def test_get_http_user_id_accepts_x_openid_header():
    req = _make_request(headers={"x-openid": "oeZZZ"})
    assert security.get_http_user_id(req) == "oeZZZ"


def test_get_ws_user_id_still_accepts_query():
    """WS endpoint keeps query fallback because miniapp WS can't reliably set headers."""
    req = _make_request(query={"user_id": "oeWWW"})
    assert security.get_ws_user_id(req) == "oeWWW"


def test_get_ws_user_id_accepts_header_too():
    req = _make_request(headers={"x-user-id": "oeAAA"})
    assert security.get_ws_user_id(req) == "oeAAA"


def test_verify_request_user_accepts_query_as_legacy_fallback():
    """Transitional: ?user_id= is honoured when no header is sent.

    Logged as AUTH_FALLBACK source=query so we can phase this out once the
    1.1.0+ client (which always sets X-User-Id) is fully rolled out.
    """
    req = _make_request(query={"user_id": "oeBBB"})
    assert security.verify_request_user(req, required=True) == "oeBBB"


def test_verify_request_user_query_satisfies_claimed_check_via_fallback():
    """Claimed body user_id with no header is accepted via legacy query fallback."""
    req = _make_request(query={"user_id": "oeCCC"})
    assert security.verify_request_user(req, claimed_user_id="oeCCC", required=True) == "oeCCC"


def test_verify_request_user_accepts_header_identity():
    req = _make_request(headers={"x-user-id": "oeDDD"})
    assert security.verify_request_user(req, required=True) == "oeDDD"


def test_verify_request_user_optional_returns_query_fallback():
    """When ?user_id= is present and required=False, return it (legacy)."""
    req = _make_request(query={"user_id": "oeEEE"})
    assert security.verify_request_user(req, required=False) == "oeEEE"


def test_verify_request_user_optional_returns_none_without_any_identity():
    """When nothing is present and required=False, return None."""
    req = _make_request()
    assert security.verify_request_user(req, required=False) is None


def test_verify_request_user_token_query_still_blocked():
    """Token-via-query stays closed even with the user_id query fallback open."""
    # _extract_auth_token defaults to allow_query=False on HTTP path; a
    # ?token= alone produces no identity here.
    req = _make_request(query={"token": "fake.jwt.token"})
    with pytest.raises(HTTPException):
        security.verify_request_user(req, required=True)


def test_http_route_via_real_request_rejects_query_user_id():
    """Sanity: a real Starlette Request (case-insensitive Headers, real QueryParams) behaves the same."""
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient

    app = FastAPI()

    @app.get("/probe")
    def probe(request: Request):
        return {"identity": security.get_http_user_id(request)}

    client = TestClient(app)
    # Query-only: must NOT authenticate
    r = client.get("/probe", params={"user_id": "oeQUERY"})
    assert r.json()["identity"] is None
    # Header: must authenticate
    r = client.get("/probe", headers={"X-User-Id": "oeHEADER"})
    assert r.json()["identity"] == "oeHEADER"
    # Both header AND query: header wins, query is ignored
    r = client.get("/probe", params={"user_id": "oeQUERY"}, headers={"X-User-Id": "oeHEADER"})
    assert r.json()["identity"] == "oeHEADER"
