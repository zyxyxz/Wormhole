import pytest

from app import security


def test_missing_jwt_secret_raises(monkeypatch):
    monkeypatch.setenv("WORMHOLE_ENV", "production")
    monkeypatch.setattr(security.settings, "AUTH_JWT_SECRET", "")
    with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
        security.require_jwt_secret_configured()


def test_dev_mode_missing_secret_does_not_raise(monkeypatch):
    monkeypatch.delenv("WORMHOLE_ENV", raising=False)
    monkeypatch.setattr(security.settings, "AUTH_JWT_SECRET", "")
    # Should not raise in development (default) mode
    security.require_jwt_secret_configured()


def test_production_with_secret_does_not_raise(monkeypatch):
    monkeypatch.setenv("WORMHOLE_ENV", "production")
    monkeypatch.setattr(security.settings, "AUTH_JWT_SECRET", "real-secret-value")
    security.require_jwt_secret_configured()


def test_whitespace_only_secret_raises_in_production(monkeypatch):
    monkeypatch.setenv("WORMHOLE_ENV", "production")
    monkeypatch.setattr(security.settings, "AUTH_JWT_SECRET", "   ")
    with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
        security.require_jwt_secret_configured()


def test_uppercase_production_env_still_triggers_check(monkeypatch):
    monkeypatch.setenv("WORMHOLE_ENV", "PRODUCTION")
    monkeypatch.setattr(security.settings, "AUTH_JWT_SECRET", "")
    with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
        security.require_jwt_secret_configured()
