from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.database import get_db
from models.space import Space, SpaceMapping, SpaceCode, ShareCode, SpaceMember
from models.user import UserAlias
from models.chat import Message
from models.feed import Post
from models.notes import Note
from sqlalchemy import func
import random
import string
from datetime import datetime, timedelta
from pydantic import BaseModel

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


@router.post("/admin/cleanup-spaces")
class AdminAuth(BaseModel):
    user_id: str
    room_code: str


@router.post("/admin/cleanup-spaces")
async def admin_cleanup_spaces(
    payload: AdminAuth | None = None,
    user_id: str | None = None,
    room_code: str | None = None,
    db: AsyncSession = Depends(get_db)
):
    auth_user = payload.user_id if payload else user_id
    auth_room = payload.room_code if payload else room_code
    if not auth_user or not auth_room:
        raise HTTPException(status_code=400, detail="缺少管理员凭据")
    verify_admin(auth_user, auth_room)
    # 找出无任何数据痕迹的空间
    subquery = select(Space.id).select_from(Space)
    subquery = subquery.outerjoin(Message, Message.space_id == Space.id)
    subquery = subquery.outerjoin(Post, Post.space_id == Space.id)
    subquery = subquery.outerjoin(Note, Note.space_id == Space.id)
    subquery = subquery.outerjoin(UserAlias, UserAlias.space_id == Space.id)
    subquery = subquery.outerjoin(ShareCode, ShareCode.space_id == Space.id)
    subquery = subquery.where(
        Message.id.is_(None),
        Post.id.is_(None),
        Note.id.is_(None),
        UserAlias.id.is_(None),
        ShareCode.id.is_(None)
    )
    idle_space_ids = [row[0] for row in (await db.execute(subquery)).fetchall()]
    deleted = 0
    for sid in idle_space_ids:
        await db.execute(delete(Space).where(Space.id == sid))
        deleted += 1
    await db.commit()
    return {"deleted": deleted}


def is_super_admin(user_id: str) -> bool:
    from app.config import settings
    admin_ids = [i.strip() for i in (settings.SUPER_ADMIN_OPENIDS or '').split(',') if i.strip()]
    return bool(user_id and user_id in admin_ids)


def verify_admin(user_id: str, room_code: str):
    from app.config import settings
    if not (is_super_admin(user_id) and room_code == (settings.SUPER_ADMIN_ROOM_CODE or '')):
        raise HTTPException(status_code=403, detail="无权限")


async def aggregate_counts(db: AsyncSession, model, space_ids: list[int]):
    if not space_ids:
        return {}
    rows = await db.execute(
        select(model.space_id, func.count(model.id))
        .where(model.space_id.in_(space_ids))
        .group_by(model.space_id)
    )
    return {space_id: count for space_id, count in rows}


@router.get("/admin/overview")
async def admin_overview(user_id: str, room_code: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
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


@router.get("/admin/spaces")
async def admin_spaces(user_id: str, room_code: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    res = await db.execute(select(Space).order_by(Space.created_at.desc()))
    spaces = res.scalars().all()
    space_ids = [s.id for s in spaces]
    member_counts = await aggregate_counts(db, SpaceMember, space_ids)
    message_counts = await aggregate_counts(db, Message, space_ids)
    post_counts = await aggregate_counts(db, Post, space_ids)
    note_counts = await aggregate_counts(db, Note, space_ids)
    return {
        "spaces": [
            {
                "space_id": s.id,
                "code": s.code,
                "owner_user_id": s.owner_user_id,
                "created_at": s.created_at,
                "member_count": member_counts.get(s.id, 0),
                "message_count": message_counts.get(s.id, 0),
                "post_count": post_counts.get(s.id, 0),
                "note_count": note_counts.get(s.id, 0),
            } for s in spaces
        ]
    }


@router.get("/admin/space-detail")
async def admin_space_detail(user_id: str, room_code: str, space_id: int, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    space = (await db.execute(select(Space).where(Space.id == space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    member_rows = await db.execute(select(SpaceMember).where(SpaceMember.space_id == space_id))
    members = member_rows.scalars().all()
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {a.user_id: a for a in alias_rows.scalars().all()}
    member_payload = [
        {
            "user_id": m.user_id,
            "alias": alias_map.get(m.user_id).alias if alias_map.get(m.user_id) else None,
            "avatar_url": alias_map.get(m.user_id).avatar_url if alias_map.get(m.user_id) else None,
            "joined_at": m.joined_at,
        } for m in members
    ]
    recent_posts_res = await db.execute(
        select(Post).where(Post.space_id == space_id).order_by(Post.created_at.desc()).limit(5)
    )
    posts = recent_posts_res.scalars().all()
    recent_messages_res = await db.execute(
        select(Message).where(Message.space_id == space_id).order_by(Message.created_at.desc()).limit(5)
    )
    messages = recent_messages_res.scalars().all()
    message_count = (await db.execute(select(func.count(Message.id)).where(Message.space_id == space_id))).scalar() or 0
    post_count = (await db.execute(select(func.count(Post.id)).where(Post.space_id == space_id))).scalar() or 0
    member_count = len(member_payload)
    note_count = (await db.execute(select(func.count(Note.id)).where(Note.space_id == space_id))).scalar() or 0
    return {
        "space": {
            "space_id": space.id,
            "code": space.code,
            "owner_user_id": space.owner_user_id,
            "created_at": space.created_at,
            "member_count": member_count,
            "message_count": message_count,
            "post_count": post_count,
            "note_count": note_count,
        },
        "members": member_payload,
        "recent_posts": [
            {
                "id": p.id,
                "user_id": p.user_id,
                "alias": alias_map.get(p.user_id).alias if alias_map.get(p.user_id) else None,
                "content": p.content,
                "media_type": p.media_type,
                "created_at": p.created_at,
            } for p in posts
        ],
        "recent_messages": [
            {
                "id": msg.id,
                "user_id": msg.user_id,
                "alias": alias_map.get(msg.user_id).alias if alias_map.get(msg.user_id) else None,
                "content": msg.content,
                "message_type": msg.message_type,
                "created_at": msg.created_at,
            } for msg in messages
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
