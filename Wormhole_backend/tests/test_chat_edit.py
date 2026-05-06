"""Task 27: chat_service.edit_message — 5-minute edit window.

Covers happy path, permission, window, message-type restriction, and
the edit_history accumulation contract.
"""
import json
import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from unittest.mock import patch

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services import chat_service

import models.chat  # noqa: F401
import models.user  # noqa: F401
import models.space  # noqa: F401
import models.logs  # noqa: F401

from models.chat import Message


@pytest_asyncio.fixture()
async def memdb():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


async def _seed_text(memdb, *, user_id="alice", content="hello", space_id=1):
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"):
        msg, _ = await chat_service.send_message(
            memdb,
            space_id=space_id,
            user_id=user_id,
            content=content,
            message_type="text",
            media_url=None,
            media_duration=None,
        )
    return msg


@pytest.mark.asyncio
async def test_edit_own_message_within_window(memdb):
    msg = await _seed_text(memdb, content="hello")
    edited, payload = await chat_service.edit_message(
        memdb, message_id=msg.id, user_id="alice", new_content="hello world",
    )
    assert edited.content == "hello world"
    assert edited.edited_at is not None
    assert payload["event"] == "message_edited"
    assert payload["message_id"] == msg.id
    assert payload["content"] == "hello world"
    assert payload["edited_at"]


@pytest.mark.asyncio
async def test_cannot_edit_others_message(memdb):
    msg = await _seed_text(memdb, user_id="alice", content="hello")
    with pytest.raises(chat_service.ChatEditError) as exc:
        await chat_service.edit_message(
            memdb, message_id=msg.id, user_id="bob", new_content="hacked",
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_cannot_edit_after_window(memdb):
    msg = await _seed_text(memdb, content="hello")
    msg.created_at = datetime.utcnow() - timedelta(minutes=10)
    await memdb.commit()
    with pytest.raises(chat_service.ChatEditError) as exc:
        await chat_service.edit_message(
            memdb, message_id=msg.id, user_id="alice", new_content="too late",
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_cannot_edit_image_message(memdb):
    with patch("app.services.chat_service.fire_room_notification"), \
         patch("app.services.chat_service.event_manager"):
        msg, _ = await chat_service.send_message(
            memdb,
            space_id=1,
            user_id="alice",
            content="",
            message_type="image",
            media_url="https://x/img.jpg",
            media_duration=None,
        )
    with pytest.raises(chat_service.ChatEditError) as exc:
        await chat_service.edit_message(
            memdb, message_id=msg.id, user_id="alice", new_content="text",
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_edit_records_history(memdb):
    msg = await _seed_text(memdb, content="v1")
    await chat_service.edit_message(memdb, message_id=msg.id, user_id="alice", new_content="v2")
    await chat_service.edit_message(memdb, message_id=msg.id, user_id="alice", new_content="v3")
    edited = await memdb.get(Message, msg.id)
    history = json.loads(edited.edit_history)
    assert len(history) == 2
    assert history[0]["content"] == "v1"
    assert history[1]["content"] == "v2"
    assert edited.content == "v3"


@pytest.mark.asyncio
async def test_edit_rejects_empty_content(memdb):
    msg = await _seed_text(memdb, content="hello")
    with pytest.raises(chat_service.ChatEditError) as exc:
        await chat_service.edit_message(
            memdb, message_id=msg.id, user_id="alice", new_content="   ",
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_edit_unchanged_content_is_noop(memdb):
    msg = await _seed_text(memdb, content="hello")
    _, payload = await chat_service.edit_message(
        memdb, message_id=msg.id, user_id="alice", new_content="hello",
    )
    assert payload == {}
    fresh = await memdb.get(Message, msg.id)
    assert fresh.edit_history is None
    assert fresh.edited_at is None


@pytest.mark.asyncio
async def test_edit_missing_message(memdb):
    with pytest.raises(chat_service.ChatEditError) as exc:
        await chat_service.edit_message(
            memdb, message_id=99999, user_id="alice", new_content="x",
        )
    assert exc.value.status_code == 404
