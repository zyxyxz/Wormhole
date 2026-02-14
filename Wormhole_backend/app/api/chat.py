from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from models.chat import Message
from models.space import Space, SpaceMember
from models.user import UserAlias
from schemas.chat import (
    MessageCreate,
    ChatHistoryResponse,
    MessageResponse,
    ReadUpdateRequest,
    ChatReadStatusResponse,
    ReaderStatus,
    MessageDeleteRequest,
)
from app.ws import chat_manager
from app.utils.media import (
    encode_live_media,
    process_avatar_url,
    process_live_media_urls,
    process_message_media_url,
    strip_url,
)
from app.utils.operation_log import add_operation_log
from app.security import verify_request_user, require_space_member
from app.services.notify_dispatcher import fire_room_notification
from datetime import datetime

router = APIRouter()

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

    resp_msgs = []
    for m in messages:
        msg_type = (m.message_type or "text").lower()
        live_cover_url = None
        live_video_url = None
        media_url = process_message_media_url(m.media_url, m.message_type)
        if msg_type == "live":
            live_cover_url, live_video_url = process_live_media_urls(m.media_url)
            media_url = live_cover_url
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
            )
        )

    return ChatHistoryResponse(
        messages=resp_msgs,
        last_message_id=resp_msgs[-1].id if resp_msgs else None,
        has_more=has_more,
        next_before_id=resp_msgs[0].id if has_more and resp_msgs else None
    )

@router.post("/send")
async def send_message(
    message: MessageCreate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request, message.user_id)
    await require_space_member(db, message.space_id, actor_user_id)
    message_type = (message.message_type or "text").lower()
    duration = message.media_duration
    if duration is not None:
        try:
            duration = int(duration)
        except Exception:
            duration = None
    media_url = strip_url(message.media_url)
    if message_type == "live":
        media_url = encode_live_media(message.live_cover_url, message.live_video_url)
        if not media_url:
            raise HTTPException(status_code=400, detail="Live消息缺少封面或视频")
    reply_to_id = message.reply_to_id
    reply_to_user_id = message.reply_to_user_id
    reply_to_content = message.reply_to_content
    reply_to_type = message.reply_to_type
    db_message = Message(
        space_id=message.space_id,
        user_id=message.user_id,
        content=message.content or "",
        message_type=message_type,
        media_url=media_url,
        media_duration=duration,
        reply_to_id=reply_to_id,
        reply_to_user_id=reply_to_user_id,
        reply_to_content=reply_to_content,
        reply_to_type=reply_to_type,
    )
    db.add(db_message)
    await db.commit()
    await db.refresh(db_message)
    # 附带别名并广播
    alias_targets = [message.user_id]
    if reply_to_user_id:
        alias_targets.append(reply_to_user_id)
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == message.space_id, UserAlias.user_id.in_(alias_targets)))
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}
    ua = alias_map.get(message.user_id)
    reply_ua = alias_map.get(reply_to_user_id) if reply_to_user_id else None
    add_operation_log(
        db,
        user_id=message.user_id,
        action="chat_send",
        space_id=message.space_id,
        detail={"message_id": db_message.id, "message_type": db_message.message_type},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    fire_room_notification(
        space_id=message.space_id,
        event_type="chat",
        sender_user_id=message.user_id,
        sender_alias=ua.alias if ua else None,
    )
    live_cover_url = None
    live_video_url = None
    media_url_payload = process_message_media_url(db_message.media_url, db_message.message_type)
    if (db_message.message_type or "").lower() == "live":
        live_cover_url, live_video_url = process_live_media_urls(db_message.media_url)
        media_url_payload = live_cover_url
    payload = {
        "id": db_message.id,
        "user_id": db_message.user_id,
        "content": db_message.content,
        "message_type": db_message.message_type,
        "media_url": media_url_payload,
        "live_cover_url": live_cover_url,
        "live_video_url": live_video_url,
        "media_duration": db_message.media_duration,
        "created_at": db_message.created_at,
        "created_at_ts": int(db_message.created_at.timestamp() * 1000) if db_message.created_at else None,
        "client_id": message.client_id,
        "alias": ua.alias if ua else None,
        "avatar_url": process_avatar_url(ua.avatar_url if ua else None),
        "reply_to_id": db_message.reply_to_id,
        "reply_to_user_id": db_message.reply_to_user_id,
        "reply_to_content": db_message.reply_to_content,
        "reply_to_type": db_message.reply_to_type,
        "reply_to_alias": reply_ua.alias if reply_ua else None,
        "reply_to_avatar_url": process_avatar_url(reply_ua.avatar_url if reply_ua else None),
    }
    await chat_manager.broadcast(message.space_id, {
        "id": payload["id"],
        "user_id": payload["user_id"],
        "content": payload["content"],
        "message_type": payload["message_type"],
        "media_url": payload["media_url"],
        "live_cover_url": payload["live_cover_url"],
        "live_video_url": payload["live_video_url"],
        "media_duration": payload["media_duration"],
        "created_at": payload["created_at"].isoformat() if payload["created_at"] else None,
        "created_at_ts": payload["created_at_ts"],
        "client_id": payload["client_id"],
        "alias": payload["alias"],
        "avatar_url": payload["avatar_url"],
        "reply_to_id": payload["reply_to_id"],
        "reply_to_user_id": payload["reply_to_user_id"],
        "reply_to_content": payload["reply_to_content"],
        "reply_to_type": payload["reply_to_type"],
        "reply_to_alias": payload["reply_to_alias"],
        "reply_to_avatar_url": payload["reply_to_avatar_url"],
    })
    return {"success": True, "message": "发送成功"}


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
    verify_request_user(request, user_id)
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
