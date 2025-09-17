from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from models.chat import Message
from models.user import UserAlias
from schemas.chat import MessageCreate, ChatHistoryResponse, MessageResponse
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
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}

    resp_msgs = [
        MessageResponse(
            id=m.id,
            user_id=m.user_id,
            alias=alias_map.get(m.user_id),
            content=m.content,
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
    db_message = Message(
        space_id=message.space_id,
        user_id=message.user_id,
        content=message.content
    )
    db.add(db_message)
    await db.commit()
    await db.refresh(db_message)
    return {"success": True, "message": "发送成功"} 
