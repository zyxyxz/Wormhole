import importlib
import os

import pytest


def _reload_security():
    """Reload config + security so the Settings singleton picks up monkeypatched env vars."""
    import app.config as cfg
    importlib.reload(cfg)
    import app.security as sec
    importlib.reload(sec)
    return sec


def test_missing_jwt_secret_raises(monkeypatch):
    monkeypatch.delenv("AUTH_JWT_SECRET", raising=False)
    monkeypatch.setenv("WORMHOLE_ENV", "production")
    sec = _reload_security()
    with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
        sec.assert_jwt_secret_configured()


def test_dev_mode_missing_secret_does_not_raise(monkeypatch):
    monkeypatch.delenv("AUTH_JWT_SECRET", raising=False)
    monkeypatch.delenv("WORMHOLE_ENV", raising=False)
    sec = _reload_security()
    # Should not raise in development (default) mode
    sec.assert_jwt_secret_configured()


def test_production_with_secret_does_not_raise(monkeypatch):
    monkeypatch.setenv("AUTH_JWT_SECRET", "a-real-production-secret")
    monkeypatch.setenv("WORMHOLE_ENV", "production")
    sec = _reload_security()
    sec.assert_jwt_secret_configured()
