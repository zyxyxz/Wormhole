from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from models.chat import Message
from models.user import UserAlias
from schemas.chat import MessageCreate, ChatHistoryResponse, MessageResponse
from app.ws import chat_manager
from typing import List

router = APIRouter()

@router.get("/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    space_id: int,
    db: AsyncSession = Depends(get_db)
):
    query = select(Message).where(Message.space_id == space_id).order_by(Message.created_at)
    result = await db.execute(query)
    messages = result.scalars().all()

    # 拉取别名字典
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}

    resp_msgs = [
        MessageResponse(
            id=m.id,
            user_id=m.user_id,
            alias=(alias_map.get(m.user_id).alias if alias_map.get(m.user_id) else None),
            avatar_url=(alias_map.get(m.user_id).avatar_url if alias_map.get(m.user_id) else None),
            content=m.content,
            message_type=m.message_type or "text",
            media_url=m.media_url,
            media_duration=int(m.media_duration) if m.media_duration is not None else None,
            created_at=m.created_at,
        ) for m in messages
    ]

    return ChatHistoryResponse(
        messages=resp_msgs,
        last_message_id=resp_msgs[-1].id if resp_msgs else None
    )

@router.post("/send")
async def send_message(
    message: MessageCreate,
    db: AsyncSession = Depends(get_db)
):
    duration = message.media_duration
    if duration is not None:
        try:
            duration = int(duration)
        except Exception:
            duration = None
    db_message = Message(
        space_id=message.space_id,
        user_id=message.user_id,
        content=message.content or "",
        message_type=message.message_type or "text",
        media_url=message.media_url,
        media_duration=duration,
    )
    db.add(db_message)
    await db.commit()
    await db.refresh(db_message)
    # 附带别名并广播
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == message.space_id, UserAlias.user_id == message.user_id))
    ua = alias_rows.scalar_one_or_none()
    payload = {
        "id": db_message.id,
        "user_id": db_message.user_id,
        "content": db_message.content,
        "message_type": db_message.message_type,
        "media_url": db_message.media_url,
        "media_duration": db_message.media_duration,
        "created_at": db_message.created_at,
        "alias": ua.alias if ua else None,
        "avatar_url": ua.avatar_url if ua else None,
    }
    await chat_manager.broadcast(message.space_id, {
        "id": payload["id"],
        "user_id": payload["user_id"],
        "content": payload["content"],
        "message_type": payload["message_type"],
        "media_url": payload["media_url"],
        "media_duration": payload["media_duration"],
        "created_at": payload["created_at"].isoformat() if payload["created_at"] else None,
        "alias": payload["alias"],
        "avatar_url": payload["avatar_url"],
    })
    return {"success": True, "message": "发送成功"}
