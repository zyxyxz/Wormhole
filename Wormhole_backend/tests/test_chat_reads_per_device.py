"""Per-device read tracking (Task 32).

Covers the storage shape (composite PK lets two devices coexist for the
same user) and the MIN-across-devices semantics that drive the unread
count: the lagging device wins, so a desktop read can't silently clear a
phone's badge.
"""
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base

# Importing model modules registers them on Base.metadata so create_all
# materialises every table the test might touch.
import models.chat  # noqa: F401
import models.chat_read  # noqa: F401
import models.user  # noqa: F401
import models.space  # noqa: F401
from models.chat_read import ChatRead


@pytest_asyncio.fixture()
async def memdb():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_chat_read_unique_per_device(memdb):
    """Two devices for the same (space, user) coexist as separate rows."""
    memdb.add(ChatRead(space_id=1, user_id="alice", device_id="dev_a", last_read_message_id=10))
    memdb.add(ChatRead(space_id=1, user_id="alice", device_id="dev_b", last_read_message_id=5))
    await memdb.commit()

    rows = (await memdb.execute(
        select(ChatRead).where(ChatRead.space_id == 1, ChatRead.user_id == "alice")
    )).scalars().all()
    assert len(rows) == 2
    by_device = {r.device_id: r.last_read_message_id for r in rows}
    assert by_device == {"dev_a": 10, "dev_b": 5}


@pytest.mark.asyncio
async def test_min_read_across_devices(memdb):
    """Unread count derives from MIN(last_read) — the lagging device wins."""
    memdb.add(ChatRead(space_id=1, user_id="alice", device_id="dev_a", last_read_message_id=10))
    memdb.add(ChatRead(space_id=1, user_id="alice", device_id="dev_b", last_read_message_id=5))
    await memdb.commit()

    min_id = (await memdb.execute(
        select(func.min(ChatRead.last_read_message_id)).where(
            ChatRead.space_id == 1, ChatRead.user_id == "alice",
        )
    )).scalar()
    assert min_id == 5  # the lagging device


@pytest.mark.asyncio
async def test_min_isolated_by_user_and_space(memdb):
    """MIN aggregation is scoped — other users / spaces don't bleed in."""
    memdb.add(ChatRead(space_id=1, user_id="alice", device_id="dev_a", last_read_message_id=10))
    memdb.add(ChatRead(space_id=1, user_id="bob", device_id="dev_x", last_read_message_id=2))
    memdb.add(ChatRead(space_id=2, user_id="alice", device_id="dev_a", last_read_message_id=3))
    await memdb.commit()

    alice_space1 = (await memdb.execute(
        select(func.min(ChatRead.last_read_message_id)).where(
            ChatRead.space_id == 1, ChatRead.user_id == "alice",
        )
    )).scalar()
    assert alice_space1 == 10  # bob's row excluded, space=2 row excluded


@pytest.mark.asyncio
async def test_no_devices_yields_null_min(memdb):
    """Caller can detect "no per-device reads recorded" via NULL MIN."""
    min_id = (await memdb.execute(
        select(func.min(ChatRead.last_read_message_id)).where(
            ChatRead.space_id == 99, ChatRead.user_id == "ghost",
        )
    )).scalar()
    assert min_id is None
