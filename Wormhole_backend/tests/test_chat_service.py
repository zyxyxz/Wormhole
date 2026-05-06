"""Verify chat_service.send_message is the single source of truth for chat sends.

Both the HTTP route and the WS handler delegate to this service after Task 9,
so its persistence + payload contract must be airtight.
"""
import pytest
import pytest_asyncio
from unittest.mock import patch

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services import chat_service

# Importing model modules registers them on Base.metadata so create_all
# materialises every table the service might touch (UserAlias join, etc.).
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
async def test_send_message_persists_and_broadcasts(memdb):
    """Happy path: text message persists, payload carries the id, side-effects fire."""
    with patch("app.services.chat_service.fire_room_notification") as mock_notify:
        msg, payload = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="hello",
            message_type="text",
            media_url=None,
            media_duration=None,
            client_id="cid-1",
        )
    assert msg.id is not None
    assert msg.content == "hello"
    assert msg.message_type == "text"
    assert payload["id"] == msg.id
    assert payload["user_id"] == "alice"
    assert payload["content"] == "hello"
    assert payload["message_type"] == "text"
    assert payload["client_id"] == "cid-1"
    # No UserAlias row -> alias is None
    assert payload["alias"] is None
    assert payload["avatar_url"] is None
    # created_at must be ISO string for JSON serialisation
    assert isinstance(payload["created_at"], str)
    # notification dispatcher fired with the right shape
    mock_notify.assert_called_once()
    kwargs = mock_notify.call_args.kwargs
    assert kwargs["space_id"] == 1
    assert kwargs["event_type"] == "chat"
    assert kwargs["sender_user_id"] == "alice"
    assert kwargs["force_send"] is False


@pytest.mark.asyncio
async def test_send_message_rejects_unknown_type(memdb):
    with pytest.raises(chat_service.ChatSendError) as exc:
        await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="x",
            message_type="badtype",
            media_url=None,
            media_duration=None,
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_send_message_rejects_empty_text(memdb):
    with patch("app.services.chat_service.fire_room_notification"):
        with pytest.raises(chat_service.ChatSendError) as exc:
            await chat_service.send_message(
                memdb,
                space_id=1,
                user_id="alice",
                content="   ",
                message_type="text",
                media_url=None,
                media_duration=None,
            )
    assert exc.value.status_code == 400
    assert "内容" in exc.value.detail


@pytest.mark.asyncio
async def test_send_message_image_requires_media_url(memdb):
    with pytest.raises(chat_service.ChatSendError) as exc:
        await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="",
            message_type="image",
            media_url=None,
            media_duration=None,
        )
    assert exc.value.status_code == 400
