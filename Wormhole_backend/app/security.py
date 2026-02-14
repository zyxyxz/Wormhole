from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.space import Space, SpaceMember


def get_header_user_id(request: Request) -> str | None:
    if not request:
        return None
    return (
        request.headers.get("x-user-id")
        or request.headers.get("x-openid")
        or request.headers.get("x-userid")
    )


def verify_request_user(
    request: Request,
    claimed_user_id: str | None = None,
    *,
    required: bool = True,
) -> str | None:
    header_user_id = get_header_user_id(request)
    # iOS 真机网络调试里有时看不到（或网关丢失）自定义头，这里兼容回退到已声明的 user_id。
    # 若同时存在 header 与 declared user_id，仍严格比对防止串号。
    if not header_user_id and claimed_user_id:
        return claimed_user_id
    if required and not header_user_id:
        raise HTTPException(status_code=401, detail="缺少用户身份")
    if claimed_user_id and header_user_id and claimed_user_id != header_user_id:
        raise HTTPException(status_code=403, detail="用户身份不匹配")
    return claimed_user_id or header_user_id


async def require_space_member(
    db: AsyncSession,
    space_id: int,
    user_id: str,
    *,
    allow_owner: bool = True,
) -> Space:
    if not user_id:
        raise HTTPException(status_code=401, detail="缺少用户身份")
    space = (await db.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if allow_owner and space.owner_user_id == user_id:
        return space
    member = (await db.execute(
        select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == user_id)
    )).scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="无权限访问该空间")
    return space


async def require_space_owner(db: AsyncSession, space_id: int, user_id: str) -> Space:
    space = await require_space_member(db, space_id, user_id, allow_owner=True)
    if space.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="仅房主可操作")
    return space
