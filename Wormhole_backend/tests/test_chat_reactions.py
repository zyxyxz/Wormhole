"""Task 28: chat_service emoji reactions.

Covers happy path add, dup-add no-op, remove, invalid emoji rejection,
and batch fetch grouping.
"""
import pytest
import pytest_asyncio
from unittest.mock import patch

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services import chat_service

import models.chat  # noqa: F401
import models.user  # noqa: F401
import models.space  # noqa: F401
import models.logs  # noqa: F401
import models.message_reaction  # noqa: F401  - registers metadata


@pytest_asyncio.fixture()
async def memdb():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


async def _seed_text(memdb, *, content="hi", user_id="alice", space_id=1):
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
async def test_add_reaction_happy_path(memdb):
    msg = await _seed_text(memdb)
    payload = await chat_service.add_reaction(
        memdb, message_id=msg.id, user_id="bob", emoji="👍",
    )
    assert payload["event"] == "reaction_add"
    assert payload["emoji"] == "👍"
    assert payload["message_id"] == msg.id
    assert payload["user_id"] == "bob"
    assert payload["space_id"] == 1
    assert not payload.get("noop")


@pytest.mark.asyncio
async def test_duplicate_add_is_noop(memdb):
    msg = await _seed_text(memdb)
    await chat_service.add_reaction(memdb, message_id=msg.id, user_id="bob", emoji="👍")
    payload = await chat_service.add_reaction(memdb, message_id=msg.id, user_id="bob", emoji="👍")
    assert payload.get("noop") is True


@pytest.mark.asyncio
async def test_remove_reaction(memdb):
    msg = await _seed_text(memdb)
    await chat_service.add_reaction(memdb, message_id=msg.id, user_id="bob", emoji="👍")
    payload = await chat_service.remove_reaction(memdb, message_id=msg.id, user_id="bob", emoji="👍")
    assert payload["event"] == "reaction_remove"
    # Subsequent fetch should not include this reaction.
    grouped = await chat_service.get_reactions_for_messages(memdb, message_ids=[msg.id])
    assert grouped == {}


@pytest.mark.asyncio
async def test_invalid_emoji_rejected(memdb):
    msg = await _seed_text(memdb)
    with pytest.raises(chat_service.ChatSendError) as exc:
        await chat_service.add_reaction(memdb, message_id=msg.id, user_id="bob", emoji="invalid")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_get_reactions_for_messages_groups_by_emoji(memdb):
    msg1 = await _seed_text(memdb, content="msg1")
    msg2 = await _seed_text(memdb, content="msg2")
    await chat_service.add_reaction(memdb, message_id=msg1.id, user_id="alice", emoji="👍")
    await chat_service.add_reaction(memdb, message_id=msg1.id, user_id="bob", emoji="👍")
    await chat_service.add_reaction(memdb, message_id=msg1.id, user_id="bob", emoji="❤️")
    await chat_service.add_reaction(memdb, message_id=msg2.id, user_id="bob", emoji="👍")

    result = await chat_service.get_reactions_for_messages(
        memdb, message_ids=[msg1.id, msg2.id]
    )
    assert msg1.id in result
    assert msg2.id in result
    msg1_groups = {g["emoji"]: set(g["user_ids"]) for g in result[msg1.id]}
    assert msg1_groups["👍"] == {"alice", "bob"}
    assert msg1_groups["❤️"] == {"bob"}
    msg2_groups = {g["emoji"]: set(g["user_ids"]) for g in result[msg2.id]}
    assert msg2_groups["👍"] == {"bob"}
