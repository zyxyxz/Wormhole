"""FTS5 search index integration test (Task 30).

Verifies the migration creates the virtual table + triggers, that
``chat_service.send_message`` writes pass through the AI trigger and become
searchable, and that the JOIN-back to ``messages`` returns the original row.
"""
import pytest
import pytest_asyncio
from unittest.mock import patch

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from app.database import Base
from app.services import chat_service
from app.migrations import add_messages_fts5

# Importing the model modules registers them on Base.metadata so create_all
# materialises every table the service might touch.
import models.chat  # noqa: F401
import models.user  # noqa: F401
import models.space  # noqa: F401
import models.logs  # noqa: F401


@pytest_asyncio.fixture()
async def memdb_with_fts():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await add_messages_fts5(conn)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_fts5_indexes_inserts_via_trigger(memdb_with_fts):
    """A row inserted through chat_service should be searchable immediately."""
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"):
        await chat_service.send_message(
            memdb_with_fts,
            space_id=1,
            user_id="u1",
            content="hello world",
            message_type="text",
            media_url=None,
            media_duration=None,
        )
        await chat_service.send_message(
            memdb_with_fts,
            space_id=1,
            user_id="u1",
            content="goodbye sunshine",
            message_type="text",
            media_url=None,
            media_duration=None,
        )

    rows = (await memdb_with_fts.execute(text(
        """
        SELECT m.id, m.content
        FROM messages_fts fts
        JOIN messages m ON m.id = fts.rowid
        WHERE fts.content MATCH :q
        """
    ), {"q": '"hello"'})).fetchall()
    assert len(rows) == 1
    assert rows[0].content == "hello world"


@pytest.mark.asyncio
async def test_fts5_match_returns_no_rows_for_unknown_term(memdb_with_fts):
    """Sanity: a term not present in any message returns zero rows."""
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"):
        await chat_service.send_message(
            memdb_with_fts,
            space_id=1,
            user_id="u1",
            content="hello world",
            message_type="text",
            media_url=None,
            media_duration=None,
        )

    rows = (await memdb_with_fts.execute(text(
        "SELECT m.id FROM messages_fts fts JOIN messages m ON m.id = fts.rowid WHERE fts.content MATCH :q"
    ), {"q": '"absentword"'})).fetchall()
    assert rows == []


@pytest.mark.asyncio
async def test_fts5_backfill_indexes_existing_rows(tmp_path):
    """If `messages` rows pre-date the FTS migration, the backfill must seed them.

    Uses a file-backed SQLite so the same DB is visible across the multiple
    connections we open here — `:memory:` would give each connection its own
    isolated database and the legacy row would vanish.
    """
    db_path = tmp_path / "fts_backfill.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Insert a message BEFORE the FTS table exists, mimicking pre-Task-30 data.
    async with Session() as session:
        from models.chat import Message
        session.add(Message(space_id=1, user_id="u1", content="legacy ping", message_type="text"))
        await session.commit()

    # Now apply the migration. The backfill INSERT must populate fts for the
    # legacy row even though no AI trigger fired for it.
    async with engine.begin() as conn:
        await add_messages_fts5(conn)

    async with Session() as session:
        rows = (await session.execute(text(
            "SELECT m.content FROM messages_fts fts JOIN messages m ON m.id = fts.rowid WHERE fts.content MATCH :q"
        ), {"q": '"legacy"'})).fetchall()
        assert len(rows) == 1
        assert rows[0].content == "legacy ping"

    await engine.dispose()
