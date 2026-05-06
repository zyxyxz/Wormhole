"""Verify chat_service.send_message emits unread_inc to event_manager.

Task 11 replaces the 10 s polling on the chat tab badge with a WS push.
The push is fired from chat_service so both HTTP and WS callers benefit
without each having to remember to broadcast.
"""
from unittest.mock import patch, AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services import chat_service

# Importing model modules registers them on Base.metadata so create_all
# materialises every table the service might touch.
import models.chat  # noqa: F401
import models.user  # noqa: F401
import models.space  # noqa: F401
import models.logs  # noqa: F401


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
async def test_send_message_emits_unread_inc(memdb):
    """A successful send must broadcast unread_inc on event_manager."""
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager") as mock_em:
        mock_em.broadcast = AsyncMock()
        msg, _payload = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="hello",
            message_type="text",
            media_url=None,
            media_duration=None,
        )
    mock_em.broadcast.assert_awaited_once()
    args, _kwargs = mock_em.broadcast.call_args
    assert args[0] == 1
    assert args[1]["event"] == "unread_inc"
    assert args[1]["from_user_id"] == "alice"
    assert args[1]["message_id"] == msg.id


@pytest.mark.asyncio
async def test_send_message_swallows_broadcast_failure(memdb):
    """If event_manager.broadcast blows up, the send still returns OK.

    The message is already committed at the broadcast point, so a
    broadcast failure must be invisible to the caller.
    """
    failing = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager") as mock_em:
        mock_em.broadcast = failing
        msg, payload = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="hello",
            message_type="text",
            media_url=None,
            media_duration=None,
        )
    assert msg.id is not None
    assert payload["id"] == msg.id
    failing.assert_awaited_once()
