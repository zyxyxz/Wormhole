import asyncio
import json
import logging
import time
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.security import get_ws_user_id
from app.services import chat_service
from app.ws import chat_manager
from models.chat_read import ChatRead
from models.space import Space, SpaceMember

logger = logging.getLogger("wormhole.ws")

router = APIRouter()

# --- WS 心跳 / idle kick ----------------------------------------------------
# CDN 通常对 WSS 上游设有 ~900s 空闲断连。服务端每 60s 主动发一帧 server_ping
# 保活 TCP；同时若 180s 内未收到客户端任何帧（3 次心跳间隔无回应），主动以
# code=4408（Request Timeout）关闭，避免服务端 hang 在 receive 上、客户端却
# 以为连接还活着。客户端 handleWsEvent 已忽略未知 event，无需改造。
WS_HEARTBEAT_INTERVAL_S = 60
WS_IDLE_KICK_THRESHOLD_S = 180


async def _ws_chat_heartbeat(websocket: WebSocket, manager) -> None:
    """每 60s 发 server_ping；若 180s 无客户端活动则关闭 (code=4408)。"""
    while True:
        try:
            await asyncio.sleep(WS_HEARTBEAT_INTERVAL_S)
        except asyncio.CancelledError:
            return
        if manager.is_idle(websocket, WS_IDLE_KICK_THRESHOLD_S):
            try:
                await websocket.close(code=4408)
            except Exception:
                pass
            return
        try:
            await websocket.send_json({
                "event": "server_ping",
                "ts": int(time.time()),
            })
        except Exception:
            return


@router.websocket("/ws/chat/{space_id}")
async def chat_ws_endpoint(websocket: WebSocket, space_id: int):
    ws_user_id = get_ws_user_id(websocket)
    if not ws_user_id:
        await websocket.close(code=4401)
        return
    async with AsyncSessionLocal() as session:
        space = (await session.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
        if not space:
            await websocket.close(code=4404)
            return
        if ws_user_id != space.owner_user_id:
            mem = (await session.execute(
                select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == ws_user_id)
            )).scalar_one_or_none()
            if not mem:
                await websocket.close(code=4403)
                return
    await chat_manager.connect(space_id, websocket)
    logger.info(
        "WS_CONNECT chat space=%s user=%s query=%s",
        space_id, ws_user_id, dict(websocket.query_params),
    )
    # 连接建立后立即登记在线，避免依赖客户端额外发送 presence 事件
    chat_manager.register_user(space_id, websocket, ws_user_id)
    # 直接给本人单播一次 presence —— 防止客户端在 onOpen 之前错过广播帧
    await chat_manager.send_presence_to(websocket, space_id)
    # 再向全房广播，通知其他成员有人加入
    await chat_manager.broadcast_presence(space_id)
    # 启动服务端心跳（CDN 900s 保活 + 180s idle kick）
    hb_task = asyncio.create_task(_ws_chat_heartbeat(websocket, chat_manager))
    try:
        while True:
            try:
                packet = await websocket.receive()
            except WebSocketDisconnect:
                break
            except RuntimeError:
                break
            except Exception:
                continue
            if packet.get("type") == "websocket.disconnect":
                break
            # 每收到一帧（含 ping/typing/read/普通消息）都视为活动
            chat_manager.touch(websocket)
            raw = packet.get("text")
            if raw is None:
                raw_bytes = packet.get("bytes")
                if not raw_bytes:
                    continue
                try:
                    raw = raw_bytes.decode("utf-8")
                except Exception:
                    continue
            try:
                data = json.loads(raw) if isinstance(raw, str) else {}
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            event = data.get("event")
            if event:
                user_id = ws_user_id
                if event == "presence":
                    chat_manager.register_user(space_id, websocket, user_id)
                    await chat_manager.broadcast_presence(space_id)
                elif event == "ping":
                    chat_manager.register_user(space_id, websocket, user_id)
                    try:
                        await websocket.send_json({
                            "event": "pong",
                            "ts": int(datetime.utcnow().timestamp() * 1000),
                        })
                    except Exception:
                        break
                elif event == "typing":
                    typing = bool(data.get("typing"))
                    chat_manager.register_user(space_id, websocket, user_id)
                    chat_manager.set_typing(space_id, user_id, typing)
                    await chat_manager.broadcast(space_id, {
                        "event": "typing",
                        "user_id": user_id,
                        "typing": typing
                    })
                elif event == "edit":
                    # Task 27: text-only message edit within a 5min window.
                    # Service handles permission/window/type checks; we
                    # silently drop invalid frames per WS conventions.
                    msg_id_raw = data.get("message_id")
                    try:
                        msg_id = int(msg_id_raw)
                    except (TypeError, ValueError):
                        continue
                    new_content = data.get("content", "")
                    chat_manager.register_user(space_id, websocket, user_id)
                    async with AsyncSessionLocal() as session:
                        try:
                            _msg, edit_payload = await chat_service.edit_message(
                                session,
                                message_id=msg_id,
                                user_id=user_id,
                                new_content=new_content,
                            )
                        except chat_service.ChatEditError:
                            continue
                    if edit_payload:
                        await chat_manager.broadcast(space_id, edit_payload)
                elif event in ("reaction_add", "reaction_remove"):
                    # Task 28: add/remove emoji reaction. Service rejects
                    # unknown emojis or soft-deleted messages with
                    # ChatSendError; we silently drop the frame on error
                    # to mirror the existing WS conventions.
                    msg_id_raw = data.get("message_id")
                    try:
                        msg_id = int(msg_id_raw)
                    except (TypeError, ValueError):
                        continue
                    emoji_val = data.get("emoji", "") or ""
                    chat_manager.register_user(space_id, websocket, user_id)
                    async with AsyncSessionLocal() as session:
                        try:
                            if event == "reaction_add":
                                rx_payload = await chat_service.add_reaction(
                                    session,
                                    message_id=msg_id,
                                    user_id=user_id,
                                    emoji=emoji_val,
                                )
                            else:
                                rx_payload = await chat_service.remove_reaction(
                                    session,
                                    message_id=msg_id,
                                    user_id=user_id,
                                    emoji=emoji_val,
                                )
                        except chat_service.ChatSendError:
                            continue
                    if rx_payload and not rx_payload.get("noop"):
                        await chat_manager.broadcast(space_id, rx_payload)
                elif event == "read":
                    last_read_message_id = data.get("last_read_message_id")
                    device_id_raw = data.get("device_id")
                    device_id = str(device_id_raw or "").strip()
                    try:
                        last_read_message_id = int(last_read_message_id or 0)
                    except Exception:
                        last_read_message_id = 0
                    chat_manager.register_user(space_id, websocket, user_id)
                    if user_id and last_read_message_id:
                        async with AsyncSessionLocal() as session:
                            space = (await session.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
                            if space:
                                now = datetime.utcnow()
                                # Task 32: per-device tracking. We only persist a
                                # ChatRead row when the client supplied a
                                # device_id; legacy clients that don't yet send
                                # one fall through to SpaceMember-only updates,
                                # preserving previous semantics until they
                                # upgrade.
                                if device_id:
                                    existing = (await session.execute(
                                        select(ChatRead).where(
                                            ChatRead.space_id == space_id,
                                            ChatRead.user_id == user_id,
                                            ChatRead.device_id == device_id,
                                        )
                                    )).scalar_one_or_none()
                                    if not existing:
                                        session.add(ChatRead(
                                            space_id=space_id,
                                            user_id=user_id,
                                            device_id=device_id,
                                            last_read_message_id=last_read_message_id,
                                            last_read_at=now,
                                        ))
                                    else:
                                        if existing.last_read_message_id is None or last_read_message_id > existing.last_read_message_id:
                                            existing.last_read_message_id = last_read_message_id
                                        existing.last_read_at = now
                                # Keep legacy SpaceMember pointer in sync as the
                                # MAX across devices: any UI that still reads
                                # from SpaceMember sees the same "best read"
                                # high-water-mark it always saw.
                                mem_res = await session.execute(
                                    select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == user_id)
                                )
                                mem = mem_res.scalar_one_or_none()
                                if device_id:
                                    # Flush the new ChatRead row so the MAX
                                    # subquery sees it without a fresh round-trip.
                                    await session.flush()
                                    max_read = (await session.execute(
                                        select(func.max(ChatRead.last_read_message_id)).where(
                                            ChatRead.space_id == space_id,
                                            ChatRead.user_id == user_id,
                                        )
                                    )).scalar() or 0
                                else:
                                    max_read = last_read_message_id
                                if not mem:
                                    mem = SpaceMember(
                                        space_id=space_id,
                                        user_id=user_id,
                                        last_read_message_id=max_read,
                                        last_read_at=now,
                                    )
                                    session.add(mem)
                                else:
                                    if mem.last_read_message_id is None or max_read > mem.last_read_message_id:
                                        mem.last_read_message_id = max_read
                                    mem.last_read_at = now
                                await session.commit()
                                broadcast_payload = {
                                    "event": "read_update",
                                    "user_id": user_id,
                                    "last_read_message_id": last_read_message_id,
                                }
                                if device_id:
                                    broadcast_payload["device_id"] = device_id
                                await chat_manager.broadcast(space_id, broadcast_payload)
                continue
            user_id = ws_user_id
            chat_manager.register_user(space_id, websocket, user_id)
            # Task 29: optional `mentions` (list of user_id strings). Anything
            # other than a list is dropped — the service further filters
            # non-string / blank entries before persisting.
            mentions_raw = data.get("mentions")
            mentions_arg = mentions_raw if isinstance(mentions_raw, list) else None
            async with AsyncSessionLocal() as session:
                try:
                    _msg, payload = await chat_service.send_message(
                        session,
                        space_id=space_id,
                        user_id=user_id,
                        content=data.get("content", ""),
                        message_type=data.get("message_type") or "text",
                        media_url=data.get("media_url"),
                        media_duration=data.get("media_duration"),
                        reply_to_id=data.get("reply_to_id"),
                        reply_to_user_id=data.get("reply_to_user_id"),
                        reply_to_content=data.get("reply_to_content"),
                        reply_to_type=data.get("reply_to_type"),
                        live_cover_url=data.get("live_cover_url"),
                        live_video_url=data.get("live_video_url"),
                        client_id=data.get("client_id"),
                        ip=(websocket.client.host if websocket.client else None),
                        user_agent=websocket.headers.get("user-agent") if hasattr(websocket, "headers") else None,
                        mentions=mentions_arg,
                    )
                except chat_service.ChatSendError:
                    # WS 上下文：静默丢弃非法帧（与既有 `continue` 语义一致）
                    continue
            chat_manager.set_typing(space_id, user_id, False)
            await chat_manager.broadcast(space_id, {
                "event": "typing",
                "user_id": user_id,
                "typing": False,
            })
            await chat_manager.broadcast(space_id, payload)
    finally:
        hb_task.cancel()
        try:
            await hb_task
        except (asyncio.CancelledError, Exception):
            pass
        user_id = chat_manager.disconnect(space_id, websocket)
        if user_id:
            await chat_manager.broadcast(space_id, {
                "event": "typing",
                "user_id": user_id,
                "typing": False
            })
        await chat_manager.broadcast_presence(space_id)
