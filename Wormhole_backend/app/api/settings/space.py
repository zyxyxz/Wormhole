from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime, timedelta
import random
import string
from app.database import get_db
from app.security import verify_request_user
from models.space import Space, SpaceCode, ShareCode
from models.chat import Message
from models.feed import Post, Comment
from models.notes import Note
from app.utils.operation_log import add_operation_log

router = APIRouter()


@router.post("/space/modify-code")
async def modify_space_code(
    space_id: int,
    new_code: str,
    request: Request,
    operator_user_id: str | None = None,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request, operator_user_id, required=True)
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
    if space.owner_user_id != actor_user_id:
        raise HTTPException(status_code=403, detail="无权限")

    space.code = new_code
    add_operation_log(
        db,
        user_id=actor_user_id,
        action="space_modify_code",
        space_id=space_id,
        detail={"new_code": new_code},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    await db.commit()

    return {"success": True, "message": "空间号修改成功"}


@router.post("/space/delete")
async def delete_space(
    space_id: int,
    request: Request,
    operator_user_id: str | None = None,
    db: AsyncSession = Depends(get_db)
):
    actor_user_id = verify_request_user(request, operator_user_id, required=True)
    space = (await db.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if space.owner_user_id != actor_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    now = datetime.utcnow()
    space.deleted_at = now
    await db.execute(update(Message).where(Message.space_id == space_id, Message.deleted_at.is_(None)).values(deleted_at=now))
    await db.execute(update(Post).where(Post.space_id == space_id, Post.deleted_at.is_(None)).values(deleted_at=now))
    await db.execute(update(Note).where(Note.space_id == space_id, Note.deleted_at.is_(None)).values(deleted_at=now))
    await db.execute(
        update(Comment)
        .where(Comment.post_id.in_(select(Post.id).where(Post.space_id == space_id)), Comment.deleted_at.is_(None))
        .values(deleted_at=now)
    )
    await db.commit()
    return {"success": True, "message": "空间删除成功"}


@router.post("/space/share")
async def share_space(
    space_id: int,
    operator_user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    verify_request_user(request, operator_user_id)
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
    add_operation_log(
        db,
        user_id=operator_user_id,
        action="space_share",
        space_id=space_id,
        detail={"share_code": share_code},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return {"share_code": share_code, "expires_in": 300}
