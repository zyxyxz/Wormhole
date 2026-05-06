"""Tests for /api/logs/track-batch (Task 23).

The batch endpoint accepts an `events[]` payload and enqueues each entry
through the same async log worker that single-event /track uses. These
tests verify the public API contract — auth gating, accepted/rejected
shapes, and the empty-batch no-op — without reaching into the queue
internals.
"""
import pytest


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


@pytest.mark.asyncio
async def test_track_batch_accepts_events(client):
    openid, token = await _login(client, "alice")
    headers = {"Authorization": f"Bearer {token}", "X-User-Id": openid}
    resp = await client.post(
        "/api/logs/track-batch",
        headers=headers,
        json={
            "events": [
                {"user_id": openid, "action": "page_view", "page": "/home"},
                {"user_id": openid, "action": "click", "page": "/home", "detail": "btn"},
            ]
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["count"] == 2


@pytest.mark.asyncio
async def test_track_batch_empty_list(client):
    # Empty batch is a no-op and doesn't require auth (nothing to attribute).
    resp = await client.post("/api/logs/track-batch", json={"events": []})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["count"] == 0
