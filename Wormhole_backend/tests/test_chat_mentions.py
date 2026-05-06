"""Task 29: @mentions on chat messages.

Covers persistence (JSON list), dedup + 20-cap, the no-mentions baseline,
and that the directed-notification helper is invoked exactly when there
are valid mentions to deliver.
"""
import json
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services import chat_service

import models.chat  # noqa: F401  - register messages table
import models.user  # noqa: F401
import models.space  # noqa: F401
import models.logs  # noqa: F401
import models.message_reaction  # noqa: F401


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
async def test_send_with_mentions_persists(memdb):
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"), \
         patch("app.services.chat_service.fire_mention_notifications") as mock_mention:
        msg, payload = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="@bob @carol hi",
            message_type="text",
            media_url=None,
            media_duration=None,
            mentions=["bob", "carol"],
        )
    assert json.loads(msg.mentions) == ["bob", "carol"]
    assert payload["mentions"] == ["bob", "carol"]
    mock_mention.assert_called_once()
    kwargs = mock_mention.call_args.kwargs
    assert kwargs["mentioned_user_ids"] == ["bob", "carol"]
    assert kwargs["sender_user_id"] == "alice"
    assert kwargs["space_id"] == 1


@pytest.mark.asyncio
async def test_send_dedupes_and_caps_mentions(memdb):
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"), \
         patch("app.services.chat_service.fire_mention_notifications"):
        many = [f"u{i}" for i in range(30)] + ["u0"]  # dup at end
        msg, payload = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="hi",
            message_type="text",
            media_url=None,
            media_duration=None,
            mentions=many,
        )
    parsed = json.loads(msg.mentions)
    assert len(parsed) == 20
    # Dedup keeps the first occurrence of u0; cap drops everything past u19.
    assert parsed == [f"u{i}" for i in range(20)]
    assert payload["mentions"] == parsed


@pytest.mark.asyncio
async def test_send_without_mentions(memdb):
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"), \
         patch("app.services.chat_service.fire_mention_notifications") as mock_mention:
        msg, payload = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="hi",
            message_type="text",
            media_url=None,
            media_duration=None,
        )
    assert msg.mentions is None
    assert payload["mentions"] == []
    mock_mention.assert_not_called()


@pytest.mark.asyncio
async def test_send_filters_blank_and_non_string_mentions(memdb):
    """Whitespace-only / non-string entries are dropped silently."""
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"), \
         patch("app.services.chat_service.fire_mention_notifications") as mock_mention:
        msg, payload = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="hi",
            message_type="text",
            media_url=None,
            media_duration=None,
            mentions=["bob", "  ", "", None, 42, "carol"],
        )
    assert json.loads(msg.mentions) == ["bob", "carol"]
    assert payload["mentions"] == ["bob", "carol"]
    mock_mention.assert_called_once()
