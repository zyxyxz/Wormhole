from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.security import require_space_member, verify_request_user
from app.services.notify_dispatcher import (
    build_disguise_text,
    normalize_cooldown_seconds,
    normalize_disguise_type,
    normalize_provider,
    send_channel_message,
)
from models.notify import NotifyChannel
from schemas.notify import (
    NotifyChannelCreateRequest,
    NotifyChannelListResponse,
    NotifyChannelResponse,
    NotifyChannelUpdateRequest,
)

router = APIRouter()


def _trim_text(value: str | None, limit: int = 2000) -> str:
    text = (value or "").strip()
    if len(text) > limit:
        return text[:limit]
    return text


def _to_response(channel: NotifyChannel) -> NotifyChannelResponse:
    return NotifyChannelResponse(
        id=channel.id,
        space_id=channel.space_id,
        user_id=channel.user_id,
        provider=channel.provider,
        target=channel.target,
        remark=channel.remark,
        enabled=bool(channel.enabled),
        notify_chat=bool(channel.notify_chat),
        notify_feed=bool(channel.notify_feed),
        cooldown_seconds=int(channel.cooldown_seconds or 0),
        disguise_type=channel.disguise_type,
        custom_title=channel.custom_title,
        custom_body=channel.custom_body,
        skip_when_online=bool(channel.skip_when_online),
        last_notified_at=channel.last_notified_at,
        created_at=channel.created_at,
        updated_at=channel.updated_at,
    )


@router.get("/channels", response_model=NotifyChannelListResponse)
async def list_channels(space_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request)
    await require_space_member(db, space_id, actor_user_id)
    rows = await db.execute(
        select(NotifyChannel)
        .where(NotifyChannel.space_id == space_id, NotifyChannel.user_id == actor_user_id)
        .order_by(NotifyChannel.id.desc())
    )
    channels = rows.scalars().all()
    return NotifyChannelListResponse(channels=[_to_response(item) for item in channels])


@router.post("/channels", response_model=NotifyChannelResponse)
async def create_channel(payload: NotifyChannelCreateRequest, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request)
    await require_space_member(db, payload.space_id, actor_user_id)
    channel = NotifyChannel(
        space_id=payload.space_id,
        user_id=actor_user_id,
        provider=normalize_provider(payload.provider),
        target=_trim_text(payload.target, 5000),
        remark=_trim_text(payload.remark, 120) or None,
        enabled=bool(payload.enabled),
        notify_chat=bool(payload.notify_chat),
        notify_feed=bool(payload.notify_feed),
        cooldown_seconds=normalize_cooldown_seconds(payload.cooldown_seconds),
        disguise_type=normalize_disguise_type(payload.disguise_type),
        custom_title=_trim_text(payload.custom_title, 120) or None,
        custom_body=_trim_text(payload.custom_body, 500) or None,
        skip_when_online=bool(payload.skip_when_online),
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    return _to_response(channel)


@router.put("/channels/{channel_id}", response_model=NotifyChannelResponse)
async def update_channel(
    channel_id: int,
    payload: NotifyChannelUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    actor_user_id = verify_request_user(request)
    row = await db.execute(select(NotifyChannel).where(NotifyChannel.id == channel_id))
    channel = row.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="通知渠道不存在")
    await require_space_member(db, channel.space_id, actor_user_id)
    if channel.user_id != actor_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    channel.provider = normalize_provider(payload.provider)
    channel.target = _trim_text(payload.target, 5000)
    channel.remark = _trim_text(payload.remark, 120) or None
    channel.enabled = bool(payload.enabled)
    channel.notify_chat = bool(payload.notify_chat)
    channel.notify_feed = bool(payload.notify_feed)
    channel.cooldown_seconds = normalize_cooldown_seconds(payload.cooldown_seconds)
    channel.disguise_type = normalize_disguise_type(payload.disguise_type)
    channel.custom_title = _trim_text(payload.custom_title, 120) or None
    channel.custom_body = _trim_text(payload.custom_body, 500) or None
    channel.skip_when_online = bool(payload.skip_when_online)
    channel.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(channel)
    return _to_response(channel)


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request)
    row = await db.execute(select(NotifyChannel).where(NotifyChannel.id == channel_id))
    channel = row.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="通知渠道不存在")
    await require_space_member(db, channel.space_id, actor_user_id)
    if channel.user_id != actor_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    await db.delete(channel)
    await db.commit()
    return {"success": True}


@router.post("/channels/{channel_id}/test")
async def test_channel(channel_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request)
    row = await db.execute(select(NotifyChannel).where(NotifyChannel.id == channel_id))
    channel = row.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="通知渠道不存在")
    await require_space_member(db, channel.space_id, actor_user_id)
    if channel.user_id != actor_user_id:
        raise HTTPException(status_code=403, detail="无权限")
    title, body = build_disguise_text(channel, "chat", sender_alias="测试")
    ok = await send_channel_message(channel, title, body, event_type="test")
    if not ok:
        raise HTTPException(status_code=400, detail="发送失败，请检查渠道配置")
    return {"success": True}
