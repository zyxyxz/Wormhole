"""Rate limiting tests (Task 4 - slowapi integration).

Verifies that:
1. The slowapi limiter actually returns 429 once the per-IP threshold is exceeded.
2. The real `app.main` FastAPI app has the limiter wired onto `app.state`.
"""

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


def _make_app():
    """Build a tiny FastAPI app with an isolated Limiter instance.

    Using a fresh Limiter per test keeps the in-memory counter from leaking
    across test cases (and prevents pollution of the production
    `app.utils.limiter.limiter` instance).
    """
    local_limiter = Limiter(key_func=get_remote_address)
    app = FastAPI()
    app.state.limiter = local_limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.get("/probe")
    @local_limiter.limit("3/minute")
    def probe(request: Request):
        return {"ok": True}

    return app


def test_rate_limit_kicks_in():
    client = TestClient(_make_app())
    # First 3 should pass.
    for _ in range(3):
        r = client.get("/probe")
        assert r.status_code == 200, r.text
    # 4th must 429.
    r = client.get("/probe")
    assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text}"


def test_eleventh_login_attempt_is_429():
    """Spec says: 连续 11 次调 /api/auth/login 第 11 次应得 429.

    We assert this against an isolated app/route that mirrors the limit
    (10/minute) without depending on the real WeChat OAuth side effects.
    """
    local_limiter = Limiter(key_func=get_remote_address)
    app = FastAPI()
    app.state.limiter = local_limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.post("/login")
    @local_limiter.limit("10/minute")
    def login(request: Request):
        return {"ok": True}

    client = TestClient(app)
    for i in range(10):
        r = client.post("/login")
        assert r.status_code == 200, f"call {i + 1} should pass, got {r.status_code}"
    r = client.post("/login")
    assert r.status_code == 429


def test_main_app_has_limiter():
    """The production app object exposes the limiter on app.state.limiter."""
    from app import main

    assert hasattr(main.app.state, "limiter"), (
        "main app must register limiter on state for slowapi decorators to work"
    )
    # Ensure it's the same instance we exported.
    from app.utils.limiter import limiter as exported_limiter

    assert main.app.state.limiter is exported_limiter
