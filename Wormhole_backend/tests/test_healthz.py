"""Verify /healthz endpoint."""
from fastapi.testclient import TestClient
from app.main import app


def test_healthz_returns_ok_with_timestamp():
    client = TestClient(app)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert isinstance(body["ts"], int)
    assert body["ts"] > 0
