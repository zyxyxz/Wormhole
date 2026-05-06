"""Verify enqueue_log + log_worker batching behavior.

The async writer pulls from an asyncio.Queue and persists in batches via the
real OperationLog model. Tests use an in-memory sqlite engine and patch
``log_service.AsyncSessionLocal`` so writes don't hit the dev DB.
"""
import asyncio
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services import log_service

# Importing model modules registers them on Base.metadata so create_all
# materialises operation_logs (and any tables it FKs against, transitively).
import models.logs  # noqa: F401


@pytest_asyncio.fixture()
async def memdb(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    # Patch the AsyncSessionLocal that log_service uses so the worker writes
    # into our in-memory engine, not the real DB.
    monkeypatch.setattr(log_service, "AsyncSessionLocal", Session)
    yield engine, Session
    await engine.dispose()


@pytest.mark.asyncio
async def test_enqueue_log_drops_when_worker_not_started():
    """No worker running -> enqueue_log silently no-ops (must not raise)."""
    # Defensive: ensure module-level queue is None before the call.
    assert log_service._queue is None
    log_service.enqueue_log(user_id="alice", action="test")
    # If we got here without raising, behaviour is correct.


@pytest.mark.asyncio
async def test_enqueue_log_skips_when_user_or_action_missing(memdb):
    _, Session = memdb
    log_service.start_log_worker()
    try:
        log_service.enqueue_log(user_id=None, action="x")
        log_service.enqueue_log(user_id="u", action=None)
        log_service.enqueue_log(user_id="", action="x")
        await asyncio.sleep(0.05)
    finally:
        await log_service.stop_log_worker()

    from models.logs import OperationLog
    async with Session() as s:
        rows = (await s.execute(select(OperationLog))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_log_worker_persists_single_entry(memdb):
    _, Session = memdb
    log_service.start_log_worker()
    try:
        log_service.enqueue_log(
            user_id="alice",
            action="test",
            space_id=1,
            detail={"key": "value"},
        )
        # Worker only commits after at least one drain cycle. stop_log_worker
        # waits for a clean shutdown, so the entry is durable by then.
    finally:
        await log_service.stop_log_worker()

    from models.logs import OperationLog
    async with Session() as s:
        rows = (await s.execute(select(OperationLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].user_id == "alice"
    assert rows[0].action == "test"
    assert rows[0].space_id == 1
    # detail is JSON-encoded for non-string payloads
    assert rows[0].detail == '{"key": "value"}'


@pytest.mark.asyncio
async def test_log_worker_batches_multiple_entries(memdb):
    _, Session = memdb
    log_service.start_log_worker()
    try:
        for i in range(5):
            log_service.enqueue_log(user_id=f"u{i}", action="bulk")
    finally:
        await log_service.stop_log_worker()

    from models.logs import OperationLog
    async with Session() as s:
        rows = (await s.execute(select(OperationLog).order_by(OperationLog.id))).scalars().all()
    assert len(rows) == 5
    assert sorted(r.user_id for r in rows) == ["u0", "u1", "u2", "u3", "u4"]
