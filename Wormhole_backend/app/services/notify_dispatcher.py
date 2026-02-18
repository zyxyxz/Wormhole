import asyncio
from urllib.parse import parse_qs, urlparse
from datetime import datetime
from typing import Tuple

import httpx
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.utils.operation_log import add_operation_log
from app.ws import chat_manager
from models.notify import NotifyChannel


PROVIDERS = {"feishu", "pushbear", "pushdeer", "webhook"}
DISGUISE_TYPES = {"market", "ops", "security", "custom"}
EVENT_TYPES = {"chat", "feed"}

_DISGUISE_PRESETS = {
    "market": ("价格波动监控", "监控策略触发，请及时查看。"),
    "ops": ("系统巡检提醒", "检测到新的巡检事件，请及时处理。"),
    "security": ("安全策略告警", "检测到异常访问行为，请及时确认。"),
}


def _extract_pushdeer_key(target: str) -> str:
    value = (target or "").strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        query = parse_qs(parsed.query or "")
        key = (query.get("pushkey") or [""])[0]
        return (key or "").strip()
    return value


def normalize_provider(value: str | None) -> str:
    provider = (value or "").strip().lower()
    return provider if provider in PROVIDERS else "feishu"


def normalize_disguise_type(value: str | None) -> str:
    disguise = (value or "").strip().lower()
    return disguise if disguise in DISGUISE_TYPES else "market"


def normalize_cooldown_seconds(value: int | None) -> int:
    try:
        seconds = int(value or 0)
    except Exception:
        seconds = 0
    if seconds < 0:
        return 0
    return min(seconds, 86400)


def build_disguise_text(channel: NotifyChannel, event_type: str, sender_alias: str | None = None) -> Tuple[str, str]:
    disguise_type = normalize_disguise_type(channel.disguise_type)
    if disguise_type == "custom":
        title = (channel.custom_title or "").strip() or "监控提醒"
        body = (channel.custom_body or "").strip() or "检测到新的监控事件，请及时处理。"
        return title, body
    title, body = _DISGUISE_PRESETS.get(disguise_type, _DISGUISE_PRESETS["market"])
    actor = (sender_alias or "").strip()
    if actor:
        body = f"{body}\n来源: {actor}"
    return title, body


async def send_channel_message(channel: NotifyChannel, title: str, body: str, *, event_type: str) -> bool:
    provider = normalize_provider(channel.provider)
    target = (channel.target or "").strip()
    if not target:
        return False
    timeout = httpx.Timeout(8.0, connect=5.0)
    content = f"{title}\n{body}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if provider == "feishu":
                payload = {"msg_type": "text", "content": {"text": content}}
                resp = await client.post(target, json=payload)
                return resp.status_code < 400
            if provider == "pushbear":
                if target.startswith("http://") or target.startswith("https://"):
                    resp = await client.post(target, data={"text": title, "desp": body})
                    return resp.status_code < 400
                resp = await client.get(
                    "https://pushbear.ftqq.com/sub",
                    params={"sendkey": target, "text": title, "desp": body},
                )
                return resp.status_code < 400
            if provider == "pushdeer":
                pushkey = _extract_pushdeer_key(target)
                if not pushkey:
                    return False
                resp = await client.get(
                    "https://api2.pushdeer.com/message/push",
                    params={
                        "pushkey": pushkey,
                        "type": "markdown",
                        "text": title,
                        "desp": body,
                    },
                )
                if resp.status_code >= 400:
                    return False
                try:
                    payload = resp.json()
                    code = payload.get("code")
                    return code in (0, "0", None)
                except Exception:
                    return True
            payload = {
                "title": title,
                "content": body,
                "event_type": event_type,
                "timestamp": int(datetime.utcnow().timestamp()),
            }
            resp = await client.post(target, json=payload)
            return resp.status_code < 400
    except Exception:
        return False


async def dispatch_room_notification(
    *,
    space_id: int,
    event_type: str,
    sender_user_id: str | None = None,
    sender_alias: str | None = None,
    force_send: bool = False,
) -> None:
    if event_type not in EVENT_TYPES:
        return
    async with AsyncSessionLocal() as db:
        filters = [NotifyChannel.space_id == space_id, NotifyChannel.enabled.is_(True)]
        if event_type == "chat":
            filters.append(NotifyChannel.notify_chat.is_(True))
        elif event_type == "feed":
            filters.append(NotifyChannel.notify_feed.is_(True))
        rows = await db.execute(select(NotifyChannel).where(*filters))
        channels = rows.scalars().all()
        if not channels:
            return
        now = datetime.utcnow()
        online_users = set(chat_manager.get_online_users(space_id))
        for channel in channels:
            if sender_user_id and channel.user_id == sender_user_id:
                continue
            if not force_send and channel.skip_when_online and channel.user_id in online_users:
                continue
            cooldown_seconds = normalize_cooldown_seconds(channel.cooldown_seconds)
            if not force_send and cooldown_seconds and channel.last_notified_at:
                delta = (now - channel.last_notified_at).total_seconds()
                if delta < cooldown_seconds:
                    continue
            title, body = build_disguise_text(channel, event_type, sender_alias=sender_alias)
            success = await send_channel_message(channel, title, body, event_type=event_type)
            if not success:
                continue
            channel.last_notified_at = now
            add_operation_log(
                db,
                user_id=channel.user_id,
                action="notify_send",
                space_id=space_id,
                detail={
                    "provider": channel.provider,
                    "event_type": event_type,
                    "channel_id": channel.id,
                },
            )
        await db.commit()


def fire_room_notification(
    *,
    space_id: int,
    event_type: str,
    sender_user_id: str | None = None,
    sender_alias: str | None = None,
    force_send: bool = False,
) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(
            dispatch_room_notification(
                space_id=space_id,
                event_type=event_type,
                sender_user_id=sender_user_id,
                sender_alias=sender_alias,
                force_send=force_send,
            )
        )
    except Exception:
        return
