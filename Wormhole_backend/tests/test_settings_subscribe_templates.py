"""Task 33: /api/settings/system exposes subscribe-message template IDs.

The miniapp reads the `subscribe_templates` block on launch to drive
proactive `wx.requestSubscribeMessage` calls on first send. Empty strings
are valid (and the default) — they tell the client to no-op until ops
configures real WeChat template IDs.
"""
from fastapi.testclient import TestClient
from app.main import app


def test_system_endpoint_includes_subscribe_templates():
    client = TestClient(app)
    resp = client.get("/api/settings/system")
    assert resp.status_code == 200
    body = resp.json()
    assert "subscribe_templates" in body
    tmpl = body["subscribe_templates"]
    assert "chat_message" in tmpl
    assert "feed_post" in tmpl
