from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from models.user import UserAlias
from schemas.user import AliasSetRequest, AliasResponse
from app.ws import event_manager

router = APIRouter()

@router.get("/alias", response_model=AliasResponse | None)
async def get_alias(space_id: int, user_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id, UserAlias.user_id == user_id))
    alias = res.scalar_one_or_none()
    if not alias:
        return None
    return AliasResponse(space_id=alias.space_id, user_id=alias.user_id, alias=alias.alias)

@router.post("/set-alias", response_model=AliasResponse)
async def set_alias(payload: AliasSetRequest, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserAlias).where(UserAlias.space_id == payload.space_id, UserAlias.user_id == payload.user_id))
    alias = res.scalar_one_or_none()
    if alias:
        alias.alias = payload.alias
    else:
        alias = UserAlias(space_id=payload.space_id, user_id=payload.user_id, alias=payload.alias)
        db.add(alias)
    await db.commit()
    # 广播别名更新事件
    await event_manager.broadcast(payload.space_id, {
        "type": "alias_update",
        "space_id": payload.space_id,
        "user_id": payload.user_id,
        "alias": payload.alias,
    })
    return AliasResponse(space_id=payload.space_id, user_id=payload.user_id, alias=payload.alias)
