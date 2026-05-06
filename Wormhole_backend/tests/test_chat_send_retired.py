"""Verify HTTP /api/chat/send returns 410 Gone after Task 10.

After Task 10 the chat send path is WebSocket-only. The HTTP route still exists
in OpenAPI (marked ``deprecated=True``) so clients see a clear 410 with a
pointer to the WS endpoint instead of a silent 404.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_http_chat_send_returns_410():
    client = TestClient(app)
    resp = client.post(
        "/api/chat/send",
        json={
            "space_id": 1,
            "user_id": "x",
            "content": "hi",
            "message_type": "text",
        },
    )
    assert resp.status_code == 410, resp.text
    body = resp.json()
    assert "WebSocket" in body["detail"]
    assert "/ws/chat/" in body["detail"]


def test_http_chat_send_410_without_body():
    """The deprecated handler takes no args, so even an empty POST returns 410."""
    client = TestClient(app)
    resp = client.post("/api/chat/send")
    assert resp.status_code == 410, resp.text


def test_send_route_marked_deprecated_in_openapi():
    """The route stays visible in OpenAPI as deprecated for one release cycle."""
    client = TestClient(app)
    schema = client.get("/openapi.json").json()
    send_op = schema["paths"]["/api/chat/send"]["post"]
    assert send_op.get("deprecated") is True
