"""Shared fixtures for e2e/integration tests against the FastAPI app.

These fixtures spin up the real FastAPI app on a fresh per-test SQLite file
and expose it via httpx.AsyncClient + ASGITransport so tests can drive the
HTTP surface end-to-end without bringing up a TCP server. Each test gets an
isolated DB so writes don't leak between tests.

Implementation notes
--------------------
We do NOT reload `app.database` because that would create a new declarative
`Base` instance — the model classes (Post, Message, etc.) are already bound
to the original `Base`, and `metadata.create_all(new_base)` would then create
zero tables. Instead we:

1. Build a fresh async engine pointing at a per-test sqlite file.
2. Monkeypatch `app.database.engine` and `AsyncSessionLocal` with the new
   pair, so existing routes (which call `get_db()` -> `AsyncSessionLocal()`)
   transparently use the test DB.
3. Run the original `create_tables()` (now bound to the patched engine via
   the module-level `engine` reference) so all tables + migrations apply.

This keeps the production import graph untouched and exercises the same
session/dependency wiring the live server uses.
"""
import os
from typing import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker


# Set env vars at import time so the very first import of `app.config`
# inside the worker process picks them up. monkeypatch in fixtures arrives
# too late if any other test (or pytest collection) has already imported
# the app module tree.
os.environ.setdefault("AUTH_JWT_SECRET", "testsecret")
os.environ.setdefault("AUTH_ALLOW_DEV_LOGIN_FALLBACK", "true")
os.environ.setdefault("WECHAT_APP_ID", "")
os.environ.setdefault("WECHAT_APP_SECRET", "")
os.environ.setdefault("WORMHOLE_ENV", "development")


@pytest_asyncio.fixture()
async def app_with_memdb(monkeypatch, tmp_path):
    """Yield the FastAPI app bound to a fresh per-test SQLite DB."""
    db_path = tmp_path / "test.db"
    test_url = f"sqlite+aiosqlite:///{db_path}"

    # Import lazily so this module is import-safe even if the env vars above
    # are tweaked by callers.
    from app import database as db_mod
    from app import main as main_mod
    # Make sure dev-login fallback flips on for the test session even if the
    # Settings object was instantiated earlier with a stale value.
    from app.config import settings as app_settings
    monkeypatch.setattr(app_settings, "AUTH_ALLOW_DEV_LOGIN_FALLBACK", True)
    monkeypatch.setattr(app_settings, "WECHAT_APP_ID", "")
    monkeypatch.setattr(app_settings, "WECHAT_APP_SECRET", "")

    # Build the per-test engine + session factory and swap them in.
    new_engine = create_async_engine(test_url, echo=False)
    NewSessionLocal = sessionmaker(new_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(db_mod, "engine", new_engine)
    monkeypatch.setattr(db_mod, "AsyncSessionLocal", NewSessionLocal)

    app = main_mod.app

    try:
        # Drive the lifespan manually so startup tasks (table creation,
        # log worker, static mount) run exactly as they do in production.
        async with main_mod.lifespan(app):
            yield app
    finally:
        await new_engine.dispose()


@pytest_asyncio.fixture()
async def client(app_with_memdb) -> AsyncIterator[AsyncClient]:
    """An httpx.AsyncClient bound to the in-memory app via ASGI transport."""
    transport = ASGITransport(app=app_with_memdb)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c
