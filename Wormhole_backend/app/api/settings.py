from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from models.space import Space, SpaceMapping, SpaceCode, ShareCode
from models.user import UserAlias
from models.chat import Message
from models.feed import Post
from sqlalchemy import func
import random
import string
from datetime import datetime, timedelta

router = APIRouter()

@router.post("/space/modify-code")
async def modify_space_code(
    space_id: int,
    new_code: str,
    db: AsyncSession = Depends(get_db)
):
    if not new_code.isdigit() or len(new_code) != 6:
        raise HTTPException(status_code=400, detail="空间号必须是6位数字")
    
    # 检查新空间号是否已被使用
    existing_alias = (await db.execute(select(SpaceCode).where(SpaceCode.code == new_code))).scalar_one_or_none()
    if existing_alias:
        raise HTTPException(status_code=400, detail="该空间号已被使用")
    
    # 更新空间号
    space_query = select(Space).where(Space.id == space_id)
    result = await db.execute(space_query)
    space = result.scalar_one_or_none()
    
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    
    space.code = new_code
    await db.commit()
    
    return {"success": True, "message": "空间号修改成功"}

@router.post("/space/delete")
async def delete_space(
    space_id: int,
    db: AsyncSession = Depends(get_db)
):
    # 删除空间及相关数据
    await db.execute(delete(Space).where(Space.id == space_id))
    await db.commit()
    
    return {"success": True, "message": "空间删除成功"}


def is_super_admin(user_id: str) -> bool:
    from app.config import settings
    admin_ids = [i.strip() for i in (settings.SUPER_ADMIN_OPENIDS or '').split(',') if i.strip()]
    return bool(user_id and user_id in admin_ids)


def verify_admin(user_id: str, room_code: str):
    from app.config import settings
    if not (is_super_admin(user_id) and room_code == (settings.SUPER_ADMIN_ROOM_CODE or '')):
        raise HTTPException(status_code=403, detail="无权限")


@router.get("/admin/overview")
async def admin_overview(user_id: str, room_code: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    user_count = (await db.execute(select(func.count(Space.id)))).scalar() or 0
    alias_count = (await db.execute(select(func.count(UserAlias.id)))).scalar() or 0
    space_count = (await db.execute(select(func.count(Space.id)))).scalar() or 0
    message_count = (await db.execute(select(func.count(Message.id)))).scalar() or 0
    post_count = (await db.execute(select(func.count(Post.id)))).scalar() or 0
    return {
        "users": alias_count,
        "spaces": space_count,
        "messages": message_count,
        "posts": post_count,
    }


@router.get("/admin/users")
async def admin_users(user_id: str, room_code: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    res = await db.execute(select(UserAlias))
    users = res.scalars().all()
    return {
        "users": [
            {
                "user_id": u.user_id,
                "space_id": u.space_id,
                "alias": u.alias,
                "avatar_url": u.avatar_url,
            } for u in users
        ]
    }


@router.get("/admin/user-spaces")
async def admin_user_spaces(user_id: str, room_code: str, target_user_id: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    if not target_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    res = await db.execute(select(Space).where(Space.owner_user_id == target_user_id))
    spaces = res.scalars().all()
    return {
        "spaces": [
            {
                "space_id": s.id,
                "code": s.code,
                "created_at": s.created_at,
            } for s in spaces
        ]
    }

@router.post("/space/share")
async def share_space(
    space_id: int,
    operator_user_id: str,
    db: AsyncSession = Depends(get_db)
):
    space_res = await db.execute(select(Space).where(Space.id == space_id))
    space = space_res.scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    if space.owner_user_id != operator_user_id:
        raise HTTPException(status_code=403, detail="无权限")

    # 生成8位随机分享码
    while True:
        share_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))
        exists = await db.execute(select(ShareCode).where(ShareCode.code == share_code))
        if not exists.scalar_one_or_none():
            break

    expires_at = datetime.utcnow() + timedelta(minutes=5)
    db.add(ShareCode(space_id=space_id, code=share_code, expires_at=expires_at, used=False))
    await db.commit()
    return {"share_code": share_code, "expires_in": 300}
