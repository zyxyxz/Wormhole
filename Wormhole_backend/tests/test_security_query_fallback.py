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


def test_verify_request_user_rejects_query_only_identity():
    """Requesting user via ?user_id= alone must not authenticate on HTTP."""
    req = _make_request(query={"user_id": "oeBBB"})
    with pytest.raises(HTTPException) as exc:
        security.verify_request_user(req, required=True)
    assert exc.value.status_code in (401, 403)


def test_verify_request_user_query_does_not_satisfy_claimed_check():
    """Claimed body user_id must be backed by token/header, not by query echo."""
    req = _make_request(query={"user_id": "oeCCC"})
    with pytest.raises(HTTPException) as exc:
        security.verify_request_user(req, claimed_user_id="oeCCC", required=True)
    assert exc.value.status_code in (401, 403)


def test_verify_request_user_accepts_header_identity():
    req = _make_request(headers={"x-user-id": "oeDDD"})
    assert security.verify_request_user(req, required=True) == "oeDDD"


def test_verify_request_user_optional_returns_none_without_identity():
    req = _make_request(query={"user_id": "oeEEE"})
    assert security.verify_request_user(req, required=False) is None


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
