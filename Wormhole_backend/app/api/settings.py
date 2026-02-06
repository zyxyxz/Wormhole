from fastapi import APIRouter, Depends, HTTPException, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete
from app.database import get_db
from models.space import Space, SpaceMapping, SpaceCode, ShareCode, SpaceMember
from models.user import UserAlias
from models.logs import OperationLog
from models.chat import Message
from models.feed import Post, Comment
from models.notes import Note
from models.system import SystemSetting
from sqlalchemy import func, or_, and_
import random
import string
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from app.utils.media import process_avatar_url, process_feed_media_urls, process_message_media_url
from app.utils.operation_log import add_operation_log
import json

router = APIRouter()

REVIEW_MODE_KEY = "review_mode"


async def _get_setting(db: AsyncSession, key: str) -> SystemSetting | None:
    return (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()


async def _set_setting(db: AsyncSession, key: str, value: str):
    setting = await _get_setting(db, key)
    if setting:
        setting.value = value
    else:
        db.add(SystemSetting(key=key, value=value))
    await db.commit()


async def _get_review_mode(db: AsyncSession) -> bool:
    setting = await _get_setting(db, REVIEW_MODE_KEY)
    if not setting:
        return False
    return setting.value == "1"

@router.post("/space/modify-code")
async def modify_space_code(
    space_id: int,
    new_code: str,
    request: Request,
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
    add_operation_log(
        db,
        user_id=space.owner_user_id,
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
    db: AsyncSession = Depends(get_db)
):
    space = (await db.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
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


class AdminAuth(BaseModel):
    user_id: str
    room_code: str


class ReviewModePayload(AdminAuth):
    review_mode: bool


class CleanupSpacesPayload(AdminAuth):
    preview: bool = False
    space_ids: list[int] | None = Field(default=None)


@router.post("/admin/cleanup-spaces")
async def admin_cleanup_spaces(
    payload: CleanupSpacesPayload | None = Body(default=None),
    user_id: str | None = None,
    room_code: str | None = None,
    preview: bool | None = None,
    db: AsyncSession = Depends(get_db)
):
    auth_user = payload.user_id if payload and payload.user_id else user_id
    auth_room = payload.room_code if payload and payload.room_code else room_code
    preview_flag = payload.preview if payload else (preview if preview is not None else False)
    space_ids = payload.space_ids if payload else None
    if not auth_user or not auth_room:
        raise HTTPException(status_code=400, detail="缺少管理员凭据")
    verify_admin(auth_user, auth_room)
    # 找出无任何有效数据痕迹的空间（仅允许房主进入产生的日志）
    now = datetime.utcnow()
    space_rows = await db.execute(
        select(Space.id, Space.code, Space.owner_user_id, Space.created_at)
        .where(Space.deleted_at.is_(None))
    )
    spaces = space_rows.all()
    space_ids_all = [row.id for row in spaces]
    space_id_set = set(space_ids_all)

    msg_ids = set((await db.execute(select(Message.space_id).distinct())).scalars().all())
    post_ids = set((await db.execute(select(Post.space_id).distinct())).scalars().all())
    note_ids = set((await db.execute(select(Note.space_id).distinct())).scalars().all())
    comment_space_ids = set(
        (await db.execute(
            select(Post.space_id).distinct()
            .join(Comment, Comment.post_id == Post.id)
        )).scalars().all()
    )
    member_ids = set(
        (await db.execute(
            select(SpaceMember.space_id).distinct()
            .join(Space, SpaceMember.space_id == Space.id)
            .where(SpaceMember.user_id != Space.owner_user_id)
        )).scalars().all()
    )
    share_ids = set(
        (await db.execute(
            select(ShareCode.space_id).distinct().where(
                ShareCode.used.is_(False),
                or_(ShareCode.expires_at.is_(None), ShareCode.expires_at >= now)
            )
        )).scalars().all()
    )
    alias_ids = set(
        (await db.execute(
            select(UserAlias.space_id).distinct().where(
                or_(
                    and_(UserAlias.alias.is_not(None), UserAlias.alias != ""),
                    and_(UserAlias.avatar_url.is_not(None), UserAlias.avatar_url != "")
                )
            )
        )).scalars().all()
    )

    blocked_ids = msg_ids | post_ids | note_ids | comment_space_ids | member_ids | share_ids | alias_ids
    idle_space_ids = [sid for sid in space_ids_all if sid in (space_id_set - blocked_ids)]
    if space_ids:
        allow_set = {int(sid) for sid in space_ids if sid}
        idle_space_ids = [sid for sid in idle_space_ids if sid in allow_set]

    if preview_flag:
        spaces = []
        log_counts = {}
        if idle_space_ids:
            rows = await db.execute(
                select(OperationLog.space_id, func.count(OperationLog.id))
                .where(OperationLog.space_id.in_(idle_space_ids))
                .group_by(OperationLog.space_id)
            )
            for sid, count in rows:
                log_counts[sid] = count
            space_rows = await db.execute(select(Space).where(Space.id.in_(idle_space_ids)))
            for sp in space_rows.scalars().all():
                spaces.append({
                    "space_id": sp.id,
                    "code": sp.code,
                    "owner_user_id": sp.owner_user_id,
                    "created_at": sp.created_at,
                    "log_count": log_counts.get(sp.id, 0)
                })
        return {
            "spaces": spaces,
            "total": len(idle_space_ids),
            "diagnostics": {
                "spaces_total": len(space_ids_all),
                "blocked_messages": len(msg_ids),
                "blocked_posts": len(post_ids),
                "blocked_notes": len(note_ids),
                "blocked_comments": len(comment_space_ids),
                "blocked_members": len(member_ids),
                "blocked_share_codes": len(share_ids),
                "blocked_aliases": len(alias_ids)
            }
        }
    deleted = 0
    for sid in idle_space_ids:
        await db.execute(delete(SpaceMember).where(SpaceMember.space_id == sid))
        await db.execute(delete(SpaceMapping).where(SpaceMapping.space_id == sid))
        await db.execute(delete(SpaceCode).where(SpaceCode.space_id == sid))
        await db.execute(delete(ShareCode).where(ShareCode.space_id == sid))
        await db.execute(delete(UserAlias).where(UserAlias.space_id == sid))
        await db.execute(delete(OperationLog).where(OperationLog.space_id == sid))
        await db.execute(delete(Space).where(Space.id == sid))
        deleted += 1
    await db.commit()
    return {"deleted": deleted}


@router.get("/system")
async def public_system_flags(db: AsyncSession = Depends(get_db)):
    return {"review_mode": await _get_review_mode(db)}


@router.post("/admin/system/review-mode")
async def set_review_mode(payload: ReviewModePayload, db: AsyncSession = Depends(get_db)):
    verify_admin(payload.user_id, payload.room_code)
    await _set_setting(db, REVIEW_MODE_KEY, "1" if payload.review_mode else "0")
    return {"review_mode": payload.review_mode}


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
    query = select(model.space_id, func.count(model.id)).where(model.space_id.in_(space_ids))
    if hasattr(model, "deleted_at"):
        query = query.where(model.deleted_at.is_(None))
    rows = await db.execute(query.group_by(model.space_id))
    return {space_id: count for space_id, count in rows}


@router.get("/admin/overview")
async def admin_overview(user_id: str, room_code: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    alias_count = (await db.execute(
        select(func.count(UserAlias.id))
        .select_from(UserAlias)
        .join(Space, UserAlias.space_id == Space.id)
        .where(Space.deleted_at.is_(None))
    )).scalar() or 0
    space_count = (await db.execute(select(func.count(Space.id)).where(Space.deleted_at.is_(None)))).scalar() or 0
    message_count = (await db.execute(select(func.count(Message.id)).where(Message.deleted_at.is_(None)))).scalar() or 0
    post_count = (await db.execute(select(func.count(Post.id)).where(Post.deleted_at.is_(None)))).scalar() or 0
    return {
        "users": alias_count,
        "spaces": space_count,
        "messages": message_count,
        "posts": post_count,
    }


@router.get("/admin/recent-messages")
async def admin_recent_messages(
    user_id: str,
    room_code: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    verify_admin(user_id, room_code)
    limit = max(1, min(limit, 50))
    rows = await db.execute(
        select(Message)
        .where(Message.deleted_at.is_(None))
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages = rows.scalars().all()
    space_ids = {m.space_id for m in messages}
    spaces_map = {}
    if space_ids:
        space_rows = await db.execute(select(Space).where(Space.id.in_(space_ids), Space.deleted_at.is_(None)))
        spaces_map = {s.id: s for s in space_rows.scalars().all()}
    owner_alias_map = {}
    if spaces_map:
        owner_pairs = {(s.id, s.owner_user_id) for s in spaces_map.values() if s.owner_user_id}
        if owner_pairs:
            alias_rows = await db.execute(
                select(UserAlias).where(
                    UserAlias.space_id.in_([sid for sid, _ in owner_pairs]),
                    UserAlias.user_id.in_([uid for _, uid in owner_pairs])
                )
            )
            owner_alias_map = {(a.space_id, a.user_id): a.alias for a in alias_rows.scalars().all()}
    alias_map = {}
    if messages:
        alias_filters = [
            and_(UserAlias.space_id == m.space_id, UserAlias.user_id == m.user_id)
            for m in messages
        ]
        if alias_filters:
            alias_rows = await db.execute(select(UserAlias).where(or_(*alias_filters)))
            alias_map = {(a.space_id, a.user_id): a for a in alias_rows.scalars().all()}
    return {
        "messages": [
            {
                "id": m.id,
                "space_id": m.space_id,
                "space_code": spaces_map.get(m.space_id).code if spaces_map.get(m.space_id) else None,
                "space_owner_id": spaces_map.get(m.space_id).owner_user_id if spaces_map.get(m.space_id) else None,
                "space_owner_alias": owner_alias_map.get((m.space_id, spaces_map.get(m.space_id).owner_user_id)) if spaces_map.get(m.space_id) and spaces_map.get(m.space_id).owner_user_id else None,
                "user_id": m.user_id,
                "alias": alias_map.get((m.space_id, m.user_id)).alias if alias_map.get((m.space_id, m.user_id)) else None,
                "content": m.content,
                "message_type": m.message_type,
                "created_at": m.created_at,
            } for m in messages
        ]
    }


@router.get("/admin/recent-posts")
async def admin_recent_posts(
    user_id: str,
    room_code: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    verify_admin(user_id, room_code)
    limit = max(1, min(limit, 50))
    rows = await db.execute(
        select(Post)
        .where(Post.deleted_at.is_(None))
        .order_by(Post.created_at.desc())
        .limit(limit)
    )
    posts = rows.scalars().all()
    space_ids = {p.space_id for p in posts}
    spaces_map = {}
    if space_ids:
        space_rows = await db.execute(select(Space).where(Space.id.in_(space_ids), Space.deleted_at.is_(None)))
        spaces_map = {s.id: s for s in space_rows.scalars().all()}
    owner_alias_map = {}
    if spaces_map:
        owner_pairs = {(s.id, s.owner_user_id) for s in spaces_map.values() if s.owner_user_id}
        if owner_pairs:
            alias_rows = await db.execute(
                select(UserAlias).where(
                    UserAlias.space_id.in_([sid for sid, _ in owner_pairs]),
                    UserAlias.user_id.in_([uid for _, uid in owner_pairs])
                )
            )
            owner_alias_map = {(a.space_id, a.user_id): a.alias for a in alias_rows.scalars().all()}
    alias_map = {}
    if posts:
        alias_filters = [
            and_(UserAlias.space_id == p.space_id, UserAlias.user_id == p.user_id)
            for p in posts
        ]
        if alias_filters:
            alias_rows = await db.execute(select(UserAlias).where(or_(*alias_filters)))
            alias_map = {(a.space_id, a.user_id): a for a in alias_rows.scalars().all()}
    return {
        "posts": [
            {
                "id": p.id,
                "space_id": p.space_id,
                "space_code": spaces_map.get(p.space_id).code if spaces_map.get(p.space_id) else None,
                "space_owner_id": spaces_map.get(p.space_id).owner_user_id if spaces_map.get(p.space_id) else None,
                "space_owner_alias": owner_alias_map.get((p.space_id, spaces_map.get(p.space_id).owner_user_id)) if spaces_map.get(p.space_id) and spaces_map.get(p.space_id).owner_user_id else None,
                "user_id": p.user_id,
                "alias": alias_map.get((p.space_id, p.user_id)).alias if alias_map.get((p.space_id, p.user_id)) else None,
                "content": p.content,
                "media_type": p.media_type,
                "created_at": p.created_at,
            } for p in posts
        ]
    }


@router.get("/admin/users")
async def admin_users(user_id: str, room_code: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    res = await db.execute(
        select(UserAlias)
        .join(Space, UserAlias.space_id == Space.id)
        .where(Space.deleted_at.is_(None))
    )
    users = res.scalars().all()
    return {
        "users": [
            {
                "user_id": u.user_id,
                "space_id": u.space_id,
                "alias": u.alias,
                "avatar_url": process_avatar_url(u.avatar_url),
            } for u in users
        ]
    }


@router.get("/admin/user-spaces")
async def admin_user_spaces(user_id: str, room_code: str, target_user_id: str, db: AsyncSession = Depends(get_db)):
    verify_admin(user_id, room_code)
    if not target_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    res = await db.execute(select(Space).where(Space.owner_user_id == target_user_id, Space.deleted_at.is_(None)))
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
    res = await db.execute(select(Space).where(Space.deleted_at.is_(None)).order_by(Space.created_at.desc()))
    spaces = res.scalars().all()
    space_ids = [s.id for s in spaces]
    owner_ids = [s.owner_user_id for s in spaces if s.owner_user_id]
    member_counts = await aggregate_counts(db, SpaceMember, space_ids)
    message_counts = await aggregate_counts(db, Message, space_ids)
    post_counts = await aggregate_counts(db, Post, space_ids)
    note_counts = await aggregate_counts(db, Note, space_ids)
    owner_alias_map = {}
    if space_ids and owner_ids:
        alias_rows = await db.execute(
            select(UserAlias).where(
                UserAlias.space_id.in_(space_ids),
                UserAlias.user_id.in_(owner_ids)
            )
        )
        owner_alias_map = {
            (a.space_id, a.user_id): a.alias
            for a in alias_rows.scalars().all()
        }
    return {
        "spaces": [
            {
                "space_id": s.id,
                "code": s.code,
                "owner_user_id": s.owner_user_id,
                "owner_alias": owner_alias_map.get((s.id, s.owner_user_id)) if s.owner_user_id else None,
                "created_at": s.created_at,
                "member_count": member_counts.get(s.id, 0),
                "message_count": message_counts.get(s.id, 0),
                "post_count": post_counts.get(s.id, 0),
                "note_count": note_counts.get(s.id, 0),
            } for s in spaces
        ]
    }


@router.get("/admin/space-detail")
async def admin_space_detail(
    user_id: str,
    room_code: str,
    space_id: int,
    include_deleted: bool = False,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    verify_admin(user_id, room_code)
    space = (await db.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    limit = max(1, min(int(limit or 20), 200))
    member_rows = await db.execute(select(SpaceMember).where(SpaceMember.space_id == space_id))
    members = member_rows.scalars().all()
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {a.user_id: a for a in alias_rows.scalars().all()}
    owner_alias = alias_map.get(space.owner_user_id).alias if alias_map.get(space.owner_user_id) else None
    member_payload = [
        {
            "user_id": m.user_id,
            "alias": alias_map.get(m.user_id).alias if alias_map.get(m.user_id) else None,
            "avatar_url": process_avatar_url(alias_map.get(m.user_id).avatar_url if alias_map.get(m.user_id) else None),
            "joined_at": m.joined_at,
        } for m in members
    ]
    post_filters = [Post.space_id == space_id]
    if not include_deleted:
        post_filters.append(Post.deleted_at.is_(None))
    recent_posts_res = await db.execute(
        select(Post)
        .where(*post_filters)
        .order_by(Post.created_at.desc())
        .limit(limit)
    )
    posts = recent_posts_res.scalars().all()
    message_filters = [Message.space_id == space_id]
    if not include_deleted:
        message_filters.append(Message.deleted_at.is_(None))
    recent_messages_res = await db.execute(
        select(Message)
        .where(*message_filters)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages = recent_messages_res.scalars().all()
    note_filters = [Note.space_id == space_id]
    if not include_deleted:
        note_filters.append(Note.deleted_at.is_(None))
    recent_notes_res = await db.execute(
        select(Note)
        .where(*note_filters)
        .order_by(Note.created_at.desc())
        .limit(limit)
    )
    notes = recent_notes_res.scalars().all()
    message_count = (await db.execute(select(func.count(Message.id)).where(Message.space_id == space_id, Message.deleted_at.is_(None)))).scalar() or 0
    post_count = (await db.execute(select(func.count(Post.id)).where(Post.space_id == space_id, Post.deleted_at.is_(None)))).scalar() or 0
    member_count = len(member_payload)
    note_count = (await db.execute(select(func.count(Note.id)).where(Note.space_id == space_id, Note.deleted_at.is_(None)))).scalar() or 0
    return {
        "space": {
            "space_id": space.id,
            "code": space.code,
            "owner_user_id": space.owner_user_id,
            "owner_alias": owner_alias,
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
                "media_urls": process_feed_media_urls(json.loads(p.media_urls or "[]"), p.media_type),
                "created_at": p.created_at,
                "deleted_at": p.deleted_at,
            } for p in posts
        ],
        "recent_messages": [
            {
                "id": msg.id,
                "user_id": msg.user_id,
                "alias": alias_map.get(msg.user_id).alias if alias_map.get(msg.user_id) else None,
                "content": msg.content,
                "message_type": msg.message_type,
                "media_url": process_message_media_url(msg.media_url, msg.message_type),
                "media_duration": msg.media_duration,
                "created_at": msg.created_at,
                "deleted_at": msg.deleted_at,
            } for msg in messages
        ],
        "recent_notes": [
            {
                "id": n.id,
                "user_id": n.user_id,
                "alias": alias_map.get(n.user_id).alias if alias_map.get(n.user_id) else None,
                "title": n.title,
                "content": n.content,
                "created_at": n.created_at,
                "deleted_at": n.deleted_at,
            } for n in notes
        ]
    }

@router.post("/space/share")
async def share_space(
    space_id: int,
    operator_user_id: str,
    request: Request,
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
