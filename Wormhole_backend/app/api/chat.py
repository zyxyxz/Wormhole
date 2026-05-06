from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from models.chat import Message
from models.chat_sticker import ChatSticker
from models.space import Space, SpaceMember
from models.user import UserAlias
from schemas.chat import (
    ChatHistoryResponse,
    MessageResponse,
    ReactionGroup,
    ReadUpdateRequest,
    ChatReadStatusResponse,
    ReaderStatus,
    MessageDeleteRequest,
    ChatStickerAddRequest,
    ChatStickerAddResponse,
    ChatStickerListResponse,
    ChatStickerResponse,
)
from app.services import chat_service
from app.ws import chat_manager
from app.utils.media import (
    process_avatar_url,
    process_live_media_urls,
    process_message_media_url,
    strip_url,
)
from app.utils.operation_log import add_operation_log
from app.security import verify_request_user, require_space_member
from datetime import datetime
import json

router = APIRouter()


def _build_sticker_response(row: ChatSticker) -> ChatStickerResponse:
    return ChatStickerResponse(
        id=row.id,
        user_id=row.user_id,
        media_url=process_message_media_url(row.media_url, "sticker") or "",
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/stickers", response_model=ChatStickerListResponse)
async def list_chat_stickers(
    user_id: str,
    request: Request,
    limit: int = 120,
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request, user_id)
    limit = max(1, min(limit, 300))
    rows = (
        await db.execute(
            select(ChatSticker)
            .where(ChatSticker.user_id == actor_user_id)
            .order_by(ChatSticker.id.desc())
            .limit(limit)
        )
    ).scalars().all()
    return ChatStickerListResponse(stickers=[_build_sticker_response(row) for row in rows])


@router.post("/stickers/add", response_model=ChatStickerAddResponse)
async def add_chat_sticker(
    payload: ChatStickerAddRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request, payload.user_id)
    media_url = strip_url(payload.media_url)
    if not media_url:
        raise HTTPException(status_code=400, detail="表情地址不能为空")
    existing = (
        await db.execute(
            select(ChatSticker).where(
                ChatSticker.user_id == actor_user_id,
                ChatSticker.media_url == media_url,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return ChatStickerAddResponse(success=True, existed=True, sticker=_build_sticker_response(existing))
    row = ChatSticker(
        user_id=actor_user_id,
        media_url=media_url,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ChatStickerAddResponse(success=True, existed=False, sticker=_build_sticker_response(row))

@router.get("/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    space_id: int,
    request: Request,
    limit: int = 50,
    before_id: int | None = None,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request)
    await require_space_member(db, space_id, actor_user_id)
    limit = max(1, min(limit, 100))
    query = select(Message).where(Message.space_id == space_id, Message.deleted_at.is_(None))
    if before_id:
        query = query.where(Message.id < before_id)
    query = query.order_by(Message.id.desc()).limit(limit + 1)
    result = await db.execute(query)
    rows = result.scalars().all()
    has_more = len(rows) > limit
    messages = rows[:limit]
    messages = list(reversed(messages))

    # 拉取别名字典
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}

    # Task 28: batch-fetch reactions for the visible window in one round-trip.
    reactions_by_msg = await chat_service.get_reactions_for_messages(
        db, message_ids=[m.id for m in messages]
    )

    resp_msgs = []
    for m in messages:
        msg_type = (m.message_type or "text").lower()
        live_cover_url = None
        live_video_url = None
        media_url = process_message_media_url(m.media_url, m.message_type)
        if msg_type == "live":
            live_cover_url, live_video_url = process_live_media_urls(m.media_url)
            media_url = live_cover_url
        # Task 29: surface stored @mentions to history readers so the UI
        # can highlight them on first paint.
        m_mentions: list[str] = []
        if m.mentions:
            try:
                parsed = json.loads(m.mentions)
                if isinstance(parsed, list):
                    m_mentions = [str(x) for x in parsed if isinstance(x, str)]
            except Exception:
                m_mentions = []
        resp_msgs.append(
            MessageResponse(
                id=m.id,
                user_id=m.user_id,
                alias=(alias_map.get(m.user_id).alias if alias_map.get(m.user_id) else None),
                avatar_url=process_avatar_url(alias_map.get(m.user_id).avatar_url if alias_map.get(m.user_id) else None),
                content=m.content,
                message_type=m.message_type or "text",
                media_url=media_url,
                live_cover_url=live_cover_url,
                live_video_url=live_video_url,
                media_duration=int(m.media_duration) if m.media_duration is not None else None,
                created_at_ts=int(m.created_at.timestamp() * 1000) if m.created_at else None,
                reply_to_id=m.reply_to_id,
                reply_to_user_id=m.reply_to_user_id,
                reply_to_content=m.reply_to_content,
                reply_to_type=m.reply_to_type,
                reply_to_alias=(alias_map.get(m.reply_to_user_id).alias if alias_map.get(m.reply_to_user_id) else None),
                reply_to_avatar_url=process_avatar_url(alias_map.get(m.reply_to_user_id).avatar_url if alias_map.get(m.reply_to_user_id) else None),
                created_at=m.created_at,
                edited_at=m.edited_at,
                reactions=[
                    ReactionGroup(emoji=g["emoji"], user_ids=g["user_ids"])
                    for g in reactions_by_msg.get(m.id, [])
                ],
                mentions=m_mentions,
            )
        )

    return ChatHistoryResponse(
        messages=resp_msgs,
        last_message_id=resp_msgs[-1].id if resp_msgs else None,
        has_more=has_more,
        next_before_id=resp_msgs[0].id if has_more and resp_msgs else None
    )

@router.post("/send", deprecated=True)
async def send_message_deprecated():
    """Deprecated. Use WebSocket ``/ws/chat/{space_id}`` for sending messages.

    Retired in Task 10 in favor of WS-only sends. The route stays in OpenAPI as
    ``deprecated=True`` for at least one release cycle so clients see the 410
    rather than a silent 404.
    """
    raise HTTPException(
        status_code=410,
        detail="Use WebSocket /ws/chat/{space_id} for chat sends. HTTP /api/chat/send is retired.",
    )


@router.get("/readers", response_model=ChatReadStatusResponse)
async def get_chat_readers(space_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request)
    await require_space_member(db, space_id, actor_user_id)
    rows = await db.execute(
        select(SpaceMember, UserAlias)
        .outerjoin(UserAlias, (UserAlias.space_id == SpaceMember.space_id) & (UserAlias.user_id == SpaceMember.user_id))
        .where(SpaceMember.space_id == space_id)
    )
    readers = []
    for mem, alias in rows.all():
        readers.append(ReaderStatus(
            user_id=mem.user_id,
            alias=alias.alias if alias else None,
            avatar_url=process_avatar_url(alias.avatar_url if alias else None),
            last_read_message_id=mem.last_read_message_id,
            last_read_at=mem.last_read_at,
        ))
    return ChatReadStatusResponse(readers=readers)


@router.post("/read")
async def update_chat_read_state(payload: ReadUpdateRequest, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request, payload.user_id)
    await require_space_member(db, payload.space_id, actor_user_id)
    if not payload.user_id:
        raise HTTPException(status_code=400, detail="用户信息缺失")
    try:
        last_id = int(payload.last_read_message_id or 0)
    except Exception:
        last_id = 0
    mem_res = await db.execute(select(SpaceMember).where(SpaceMember.space_id == payload.space_id, SpaceMember.user_id == payload.user_id))
    mem = mem_res.scalar_one_or_none()
    now = datetime.utcnow()
    if not mem:
        mem = SpaceMember(space_id=payload.space_id, user_id=payload.user_id, last_read_message_id=last_id, last_read_at=now)
        db.add(mem)
    else:
        if mem.last_read_message_id is None or last_id > mem.last_read_message_id:
            mem.last_read_message_id = last_id
        mem.last_read_at = now
    await db.commit()
    await chat_manager.broadcast(payload.space_id, {
        "event": "read_update",
        "user_id": payload.user_id,
        "last_read_message_id": mem.last_read_message_id,
    })
    return {"success": True}


@router.post("/delete")
async def delete_message(payload: MessageDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not payload.operator_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    verify_request_user(request, payload.operator_user_id)
    msg = (await db.execute(select(Message).where(Message.id == payload.message_id, Message.deleted_at.is_(None)))).scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")
    await require_space_member(db, msg.space_id, payload.operator_user_id)
    space = (await db.execute(select(Space).where(Space.id == msg.space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if payload.operator_user_id not in {msg.user_id, space.owner_user_id}:
        raise HTTPException(status_code=403, detail="无权限")
    msg.deleted_at = datetime.utcnow()
    add_operation_log(
        db,
        user_id=payload.operator_user_id,
        action="chat_delete",
        space_id=msg.space_id,
        detail={"message_id": msg.id}
    )
    await db.commit()
    await chat_manager.broadcast(msg.space_id, {
        "event": "message_deleted",
        "message_id": msg.id
    })
    return {"success": True}


@router.get("/unread-count")
async def unread_count(space_id: int, user_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    if not user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    verify_request_user(request, user_id, required=False)
    await require_space_member(db, space_id, user_id)
    mem_res = await db.execute(select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == user_id))
    mem = mem_res.scalar_one_or_none()
    last_read_id = mem.last_read_message_id if mem and mem.last_read_message_id else 0
    count_row = await db.execute(
        select(func.count(Message.id)).where(
            Message.space_id == space_id,
            Message.deleted_at.is_(None),
            Message.id > last_read_id,
            Message.user_id != user_id
        )
    )
    count = count_row.scalar_one() or 0
    return {"count": count, "last_read_id": last_read_id}
