from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from models.user import UserAlias
from schemas.user import AliasSetRequest, AliasResponse
from app.ws import event_manager
from app.utils.media import process_avatar_url, strip_url

router = APIRouter()

@router.get("/alias", response_model=AliasResponse | None)
async def get_alias(space_id: int, user_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id, UserAlias.user_id == user_id))
    alias = res.scalar_one_or_none()
    if not alias:
        return None
    return AliasResponse(
        space_id=alias.space_id,
        user_id=alias.user_id,
        alias=alias.alias or "",
        avatar_url=process_avatar_url(alias.avatar_url),
    )

@router.post("/set-alias", response_model=AliasResponse)
async def set_alias(payload: AliasSetRequest, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserAlias).where(UserAlias.space_id == payload.space_id, UserAlias.user_id == payload.user_id))
    alias = res.scalar_one_or_none()
    avatar_url = strip_url(payload.avatar_url)
    if alias:
        alias.alias = payload.alias
        if avatar_url is not None:
            alias.avatar_url = avatar_url
    else:
        alias = UserAlias(space_id=payload.space_id, user_id=payload.user_id, alias=payload.alias, avatar_url=avatar_url)
        db.add(alias)
    await db.commit()
    # 广播别名更新事件
    await event_manager.broadcast(payload.space_id, {
        "type": "alias_update",
        "space_id": payload.space_id,
        "user_id": payload.user_id,
        "alias": payload.alias,
        "avatar_url": process_avatar_url(avatar_url),
    })
    return AliasResponse(
        space_id=payload.space_id,
        user_id=payload.user_id,
        alias=payload.alias,
        avatar_url=process_avatar_url(avatar_url),
    )
