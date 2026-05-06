"""Single source of truth for sending chat messages.

Used by both the HTTP send route (`app/api/chat.py`) and the WebSocket message
handler (`app/main.py`). Validates input, persists the row, writes the
operation log, fires the notification dispatcher, resolves aliases, and
returns the structured broadcast payload that callers should publish through
`chat_manager.broadcast`.
"""
import json
from datetime import datetime, timedelta
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.notify_dispatcher import fire_room_notification
from app.ws import event_manager
from app.utils.media import (
    encode_live_media,
    process_avatar_url,
    process_live_media_urls,
    process_message_media_url,
    strip_url,
)
from app.utils.operation_log import add_operation_log
from models.chat import Message
from models.user import UserAlias


ALLOWED_MESSAGE_TYPES = {"text", "image", "video", "audio", "live", "system", "sticker"}

# Task 27: only the original sender can edit, only within this window.
# 5 minutes mirrors WeChat / Telegram semantics — long enough for typo
# fixes, short enough that history readers see a stable transcript.
EDIT_WINDOW_MINUTES = 5


class ChatSendError(Exception):
    """Validation failure when preparing a chat message.

    Carries an HTTP-style ``status_code`` so HTTP callers can re-raise as
    ``HTTPException`` while WS callers can drop the frame silently.
    """

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


class ChatEditError(Exception):
    """Validation/permission failure when editing a chat message.

    Same status_code convention as ``ChatSendError`` so HTTP callers can
    re-raise as ``HTTPException`` while WS callers drop the frame silently.
    """

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


async def send_message(
    db: AsyncSession,
    *,
    space_id: int,
    user_id: str,
    content: Optional[str],
    message_type: str,
    media_url: Optional[str],
    media_duration: Optional[int],
    reply_to_id: Optional[int] = None,
    reply_to_user_id: Optional[str] = None,
    reply_to_content: Optional[str] = None,
    reply_to_type: Optional[str] = None,
    live_cover_url: Optional[str] = None,
    live_video_url: Optional[str] = None,
    client_id: Optional[str] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Tuple[Message, dict]:
    """Persist a chat message, log it, fire notifications, and return the
    broadcast payload.

    Raises ``ChatSendError`` on validation failure. The caller is responsible
    for actually broadcasting the returned payload (so test code can inspect
    the result without side effects, and the WS handler can interleave
    typing-state broadcasts).
    """
    msg_type = (message_type or "text").lower()
    if msg_type not in ALLOWED_MESSAGE_TYPES:
        raise ChatSendError(400, "不支持的消息类型")

    cleaned_content = (content or "").strip()
    cleaned_media_url = strip_url(media_url)
    cleaned_duration: Optional[int] = None
    if media_duration is not None:
        try:
            cleaned_duration = int(media_duration)
        except (TypeError, ValueError):
            cleaned_duration = None
    cleaned_reply_to_id: Optional[int] = None
    if reply_to_id is not None:
        try:
            cleaned_reply_to_id = int(reply_to_id)
        except (TypeError, ValueError):
            cleaned_reply_to_id = None

    if msg_type in {"text", "system"}:
        if not cleaned_content:
            raise ChatSendError(400, "消息内容不能为空")
    elif msg_type == "live":
        cleaned_media_url = encode_live_media(live_cover_url, live_video_url)
        if not cleaned_media_url:
            raise ChatSendError(400, "Live消息缺少封面或视频")
    elif not cleaned_media_url:
        raise ChatSendError(400, "媒体消息缺少资源地址")

    db_message = Message(
        space_id=space_id,
        user_id=user_id,
        content=cleaned_content,
        message_type=msg_type,
        media_url=cleaned_media_url,
        media_duration=cleaned_duration,
        reply_to_id=cleaned_reply_to_id,
        reply_to_user_id=reply_to_user_id,
        reply_to_content=reply_to_content,
        reply_to_type=reply_to_type,
    )
    db.add(db_message)
    await db.commit()
    await db.refresh(db_message)

    add_operation_log(
        db,
        user_id=user_id,
        action="chat_send",
        space_id=space_id,
        detail={"message_id": db_message.id, "message_type": db_message.message_type},
        ip=ip,
        user_agent=user_agent,
    )
    await db.commit()

    sender_alias = None
    reply_alias = None
    try:
        alias_targets = [user_id]
        if reply_to_user_id:
            alias_targets.append(reply_to_user_id)
        alias_rows = await db.execute(
            select(UserAlias).where(
                UserAlias.space_id == space_id,
                UserAlias.user_id.in_(alias_targets),
            )
        )
        alias_map = {r.user_id: r for r in alias_rows.scalars().all()}
        sender_alias = alias_map.get(user_id)
        reply_alias = alias_map.get(reply_to_user_id) if reply_to_user_id else None
    except Exception:
        sender_alias = None
        reply_alias = None

    fire_room_notification(
        space_id=space_id,
        event_type="chat",
        sender_user_id=user_id,
        sender_alias=sender_alias.alias if sender_alias else None,
        force_send=msg_type == "system",
    )

    media_url_payload = process_message_media_url(db_message.media_url, db_message.message_type)
    live_cover_payload = None
    live_video_payload = None
    if (db_message.message_type or "").lower() == "live":
        live_cover_payload, live_video_payload = process_live_media_urls(db_message.media_url)
        media_url_payload = live_cover_payload

    created_at_iso = (
        db_message.created_at.isoformat()
        if db_message.created_at
        else datetime.utcnow().isoformat()
    )
    created_at_ts = (
        int(db_message.created_at.timestamp() * 1000) if db_message.created_at else None
    )

    payload = {
        "id": db_message.id,
        "user_id": db_message.user_id,
        "content": db_message.content,
        "message_type": db_message.message_type,
        "media_url": media_url_payload,
        "live_cover_url": live_cover_payload,
        "live_video_url": live_video_payload,
        "media_duration": db_message.media_duration,
        "created_at": created_at_iso,
        "created_at_ts": created_at_ts,
        "client_id": client_id,
        "alias": sender_alias.alias if sender_alias else None,
        "avatar_url": process_avatar_url(sender_alias.avatar_url if sender_alias else None),
        "reply_to_id": db_message.reply_to_id,
        "reply_to_user_id": db_message.reply_to_user_id,
        "reply_to_content": db_message.reply_to_content,
        "reply_to_type": db_message.reply_to_type,
        "reply_to_alias": reply_alias.alias if reply_alias else None,
        "reply_to_avatar_url": process_avatar_url(reply_alias.avatar_url if reply_alias else None),
    }

    # Push an unread-bump event over the room's event_manager channel so any
    # client connected to /ws/space/{space_id} (the global app.js listener
    # used while NOT on the chat page) can increment its tab-bar badge
    # without polling. Chat-page subscribers use chat_manager and ignore
    # this stream — see app.js spaceEventSocket lifecycle.
    try:
        await event_manager.broadcast(space_id, {
            "event": "unread_inc",
            "from_user_id": user_id,
            "message_id": db_message.id,
        })
    except Exception:
        # Broadcast failures must never break the send; the message is
        # already persisted and the chat_manager broadcast is the SSOT.
        pass

    return db_message, payload


async def edit_message(
    db: AsyncSession,
    *,
    message_id: int,
    user_id: str,
    new_content: str,
) -> Tuple[Message, dict]:
    """Edit own text message within ``EDIT_WINDOW_MINUTES``.

    Constraints (Task 27):
      * Only the original sender can edit.
      * Only TEXT messages are editable (not images / voice / live / sticker).
      * Must be within the 5-minute window from ``created_at``.
      * Empty content is rejected; unchanged content is a no-op.

    Returns ``(msg, payload)`` where ``payload`` is the broadcast frame the
    caller should publish via ``chat_manager.broadcast``. If the new content
    matches the existing content, ``payload`` is ``{}`` and no DB write
    occurs — the WS handler treats this as a silent no-op.

    Raises ``ChatEditError`` on validation/permission failure.
    """
    cleaned = (new_content or "").strip()
    if not cleaned:
        raise ChatEditError(400, "消息内容不能为空")

    msg = (
        await db.execute(
            select(Message).where(
                Message.id == message_id,
                Message.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not msg:
        raise ChatEditError(404, "消息不存在")
    if msg.user_id != user_id:
        raise ChatEditError(403, "只能编辑自己的消息")
    if (msg.message_type or "text").lower() != "text":
        raise ChatEditError(400, "仅可编辑文本消息")
    if not msg.created_at:
        raise ChatEditError(400, "消息无时间戳")

    # created_at may be tz-aware (Postgres) or naive (SQLite); normalise
    # both sides to naive UTC for the window comparison.
    created_naive = msg.created_at.replace(tzinfo=None) if msg.created_at.tzinfo else msg.created_at
    age = datetime.utcnow() - created_naive
    if age > timedelta(minutes=EDIT_WINDOW_MINUTES):
        raise ChatEditError(403, f"超过 {EDIT_WINDOW_MINUTES} 分钟编辑窗口")

    if cleaned == (msg.content or ""):
        # No-op edit: skip the write and skip the broadcast.
        return msg, {}

    # Append the previous version to edit_history. The latest content
    # always lives in messages.content so we never store it in history.
    history: list = []
    if msg.edit_history:
        try:
            parsed = json.loads(msg.edit_history)
            if isinstance(parsed, list):
                history = parsed
        except Exception:
            history = []
    prev_edited_at = msg.edited_at or msg.created_at
    history.append({
        "content": msg.content or "",
        "edited_at": prev_edited_at.isoformat() if prev_edited_at else None,
    })

    msg.content = cleaned
    msg.edited_at = datetime.utcnow()
    msg.edit_history = json.dumps(history, ensure_ascii=False)
    await db.commit()
    await db.refresh(msg)

    payload = {
        "event": "message_edited",
        "message_id": msg.id,
        "content": msg.content,
        "edited_at": msg.edited_at.isoformat() if msg.edited_at else None,
    }
    return msg, payload
