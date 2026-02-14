from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, time
import json
from app.database import get_db
from models.logs import OperationLog
from models.user import UserAlias
from models.chat import Message
from models.feed import Post, Comment
from schemas.logs import LogCreateRequest, LogListResponse, LogEntry
from app.api.settings import verify_admin
from app.security import verify_request_user, require_space_member

router = APIRouter()


@router.post("/track")
async def track_log(payload: LogCreateRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not payload.user_id or not payload.action:
        raise HTTPException(status_code=400, detail="缺少用户或动作")
    actor_user_id = verify_request_user(request, payload.user_id)
    if payload.space_id is not None:
        await require_space_member(db, payload.space_id, actor_user_id)
    ip = request.client.host if request.client else None
    log = OperationLog(
        user_id=payload.user_id,
        action=payload.action,
        page=payload.page,
        detail=payload.detail,
        space_id=payload.space_id,
        ip=ip,
        user_agent=request.headers.get("user-agent")
    )
    db.add(log)
    return {"success": True}


@router.get("/admin/list", response_model=LogListResponse)
async def admin_list_logs(
    request: Request,
    user_id: str,
    room_code: str,
    target_user_id: str | None = None,
    action: str | None = None,
    page: str | None = None,
    space_id: int | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    verify_request_user(request, user_id)
    verify_admin(user_id, room_code)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    filters = []
    if target_user_id:
        filters.append(OperationLog.user_id == target_user_id)
    if action:
        filters.append(OperationLog.action == action)
    if page:
        filters.append(OperationLog.page == page)
    if space_id is not None:
        filters.append(OperationLog.space_id == space_id)
    if start_time:
        start_dt = _parse_date_param(start_time, start=True)
        if start_dt:
            filters.append(OperationLog.created_at >= start_dt)
    if end_time:
        end_dt = _parse_date_param(end_time, start=False)
        if end_dt:
            filters.append(OperationLog.created_at <= end_dt)

    total = (await db.execute(select(func.count(OperationLog.id)).where(*filters))).scalar() or 0

    rows = await db.execute(
        select(OperationLog)
        .where(*filters)
        .order_by(OperationLog.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    logs = rows.scalars().all()
    detail_map: dict[int, dict] = {}
    alias_map = {}
    fallback_alias_map = {}
    message_map = {}
    post_map = {}
    comment_map = {}
    if logs:
        message_ids = set()
        post_ids = set()
        comment_ids = set()
        for log in logs:
            parsed = _parse_detail(log.detail)
            detail_map[log.id] = parsed
            message_id = _safe_int(parsed.get("message_id"))
            post_id = _safe_int(parsed.get("post_id"))
            comment_id = _safe_int(parsed.get("comment_id"))
            if message_id:
                message_ids.add(message_id)
            if post_id:
                post_ids.add(post_id)
            if comment_id:
                comment_ids.add(comment_id)

        if message_ids:
            message_rows = await db.execute(select(Message).where(Message.id.in_(message_ids)))
            message_map = {item.id: item for item in message_rows.scalars().all()}
        if post_ids:
            post_rows = await db.execute(select(Post).where(Post.id.in_(post_ids)))
            post_map = {item.id: item for item in post_rows.scalars().all()}
        if comment_ids:
            comment_rows = await db.execute(select(Comment).where(Comment.id.in_(comment_ids)))
            comment_map = {item.id: item for item in comment_rows.scalars().all()}

        space_ids = {log.space_id for log in logs if log.space_id is not None}
        user_ids = {log.user_id for log in logs if log.user_id}
        if space_ids and user_ids:
            alias_rows = await db.execute(
                select(UserAlias).where(
                    UserAlias.space_id.in_(space_ids),
                    UserAlias.user_id.in_(user_ids)
                )
            )
            alias_map = {(a.space_id, a.user_id): a for a in alias_rows.scalars().all()}
        if user_ids:
            fallback_rows = await db.execute(
                select(UserAlias)
                .where(UserAlias.user_id.in_(user_ids))
                .order_by(UserAlias.id.desc())
            )
            for a in fallback_rows.scalars().all():
                if a.user_id not in fallback_alias_map:
                    fallback_alias_map[a.user_id] = a

    return LogListResponse(
        logs=[
            LogEntry(
                id=log.id,
                user_id=log.user_id,
                alias=(
                    alias_map.get((log.space_id, log.user_id)).alias
                    if alias_map.get((log.space_id, log.user_id))
                    else (fallback_alias_map.get(log.user_id).alias if fallback_alias_map.get(log.user_id) else None)
                ),
                action=log.action,
                page=log.page,
                detail=log.detail,
                message_content=content["message_content"],
                post_content=content["post_content"],
                comment_content=content["comment_content"],
                content_preview=content["preview"],
                space_id=log.space_id,
                ip=log.ip,
                created_at=log.created_at,
            )
            for log in logs
            for content in [_build_log_content(detail_map.get(log.id, {}), message_map, post_map, comment_map)]
        ],
        total=total,
        limit=limit,
        offset=offset
    )


def _parse_date_param(value: str, *, start: bool) -> datetime | None:
    if not value:
        return None
    try:
        if len(value) <= 10:
            date_obj = datetime.strptime(value, "%Y-%m-%d").date()
            return datetime.combine(date_obj, time.min if start else time.max)
        return datetime.fromisoformat(value)
    except Exception:
        return None


def _parse_detail(detail_value: str | None) -> dict:
    if not detail_value:
        return {}
    if isinstance(detail_value, dict):
        return detail_value
    try:
        parsed = json.loads(detail_value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _safe_int(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def _trim(text: str | None, limit: int = 120) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    return raw if len(raw) <= limit else f"{raw[:limit]}..."


def _format_message_content(message: Message | None) -> str:
    if not message:
        return ""
    if message.message_type == "text":
        return _trim(message.content)
    if message.message_type == "image":
        return "[图片消息]"
    if message.message_type == "video":
        return "[视频消息]"
    if message.message_type == "live":
        return "[Live消息]"
    if message.message_type == "audio":
        return "[语音消息]"
    return f"[{message.message_type or '消息'}]"


def _format_post_content(post: Post | None) -> str:
    if not post:
        return ""
    text = _trim(post.content)
    if text:
        return text
    if post.media_type == "image":
        return "[图片动态]"
    if post.media_type == "video":
        return "[视频动态]"
    if post.media_type == "live":
        return "[Live动态]"
    return "[空动态]"


def _build_log_content(detail: dict, message_map: dict, post_map: dict, comment_map: dict) -> dict:
    message_id = _safe_int(detail.get("message_id"))
    post_id = _safe_int(detail.get("post_id"))
    comment_id = _safe_int(detail.get("comment_id"))

    message_content = _format_message_content(message_map.get(message_id)) if message_id else ""
    post_content = _format_post_content(post_map.get(post_id)) if post_id else ""
    comment_obj = comment_map.get(comment_id) if comment_id else None
    comment_content = _trim(comment_obj.content) if comment_obj else ""

    lines = []
    if message_content:
        lines.append(f"消息: {message_content}")
    if post_content:
        lines.append(f"动态: {post_content}")
    if comment_content:
        lines.append(f"评论: {comment_content}")

    return {
        "message_content": message_content or None,
        "post_content": post_content or None,
        "comment_content": comment_content or None,
        "preview": "\n".join(lines) if lines else None
    }
