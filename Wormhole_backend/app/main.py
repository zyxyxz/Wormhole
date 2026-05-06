import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.api import space, chat, notes, wallet, settings
from app.config import settings as app_settings
from app.utils.limiter import limiter
from app.api import feed as feed_api
from app.api import upload as upload_api
from app.api import user as user_api
from app.api import auth as auth_api
from app.api import logs as logs_api
from app.api import notify as notify_api
from app.api import emoji_diary as emoji_diary_api
from app.api import vault as vault_api
from app.database import create_tables
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker
from app.database import AsyncSessionLocal
from models.space import SpaceMember, Space
from app.ws import chat_manager, event_manager
from app.security import require_jwt_secret_configured, get_ws_user_id
from app.services import chat_service
from app.services.log_service import start_log_worker, stop_log_worker
from sqlalchemy import select
from datetime import datetime

logger = logging.getLogger("wormhole.ws")
app_logger = logging.getLogger("wormhole.app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    require_jwt_secret_configured()
    await create_tables()
    # 静态资源（媒体文件）
    try:
        from fastapi.staticfiles import StaticFiles
        app.mount("/static", StaticFiles(directory="static"), name="static")
    except Exception as e:
        app_logger.error("static mount failed: %s", e)
    # Background writer that batches operation_log inserts off the request path.
    start_log_worker()
    yield
    # Shutdown: drain in-flight log entries before exiting.
    await stop_log_worker()


app = FastAPI(title="虫洞私密共享空间", lifespan=lifespan)

# 限流（slowapi）：路由使用 @limiter.limit(...) 装饰；超限抛 RateLimitExceeded -> 429
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# 配置CORS
allowed = [o.strip() for o in app_settings.ALLOWED_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed,
    allow_credentials=False,  # 小程序不携带 cookie
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "X-Auth-Token", "X-User-Id", "X-Openid", "Content-Type"],
)

# 注册路由
app.include_router(space.router, prefix="/api/space", tags=["空间"])
app.include_router(chat.router, prefix="/api/chat", tags=["聊天"])
app.include_router(notes.router, prefix="/api/notes", tags=["笔记"])
app.include_router(wallet.router, prefix="/api/wallet", tags=["钱包"])
app.include_router(settings.router, prefix="/api/settings", tags=["设置"])
app.include_router(user_api.router, prefix="/api/user", tags=["用户"])
app.include_router(auth_api.router, prefix="/api/auth", tags=["认证"]) 
app.include_router(logs_api.router, prefix="/api/logs", tags=["日志"])
app.include_router(feed_api.router, prefix="/api/feed", tags=["动态"]) 
app.include_router(upload_api.router, prefix="/api", tags=["上传"]) 
app.include_router(notify_api.router, prefix="/api/notify", tags=["通知"])
app.include_router(emoji_diary_api.router, prefix="/api/emoji-diary", tags=["Emoji日记"])
app.include_router(vault_api.router, prefix="/api/vault", tags=["保密柜"])

@app.get("/")
async def root():
    return {"message": "欢迎使用虫洞私密共享空间"}


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


async def _ws_space_heartbeat(websocket: WebSocket) -> None:
    """事件通道无活动追踪，仅做 60s 保活。"""
    while True:
        try:
            await asyncio.sleep(WS_HEARTBEAT_INTERVAL_S)
        except asyncio.CancelledError:
            return
        try:
            await websocket.send_json({
                "event": "server_ping",
                "ts": int(time.time()),
            })
        except Exception:
            return


@app.websocket("/ws/chat/{space_id}")
async def websocket_endpoint(websocket: WebSocket, space_id: int):
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
                elif event == "read":
                    last_read_message_id = data.get("last_read_message_id")
                    try:
                        last_read_message_id = int(last_read_message_id or 0)
                    except Exception:
                        last_read_message_id = 0
                    chat_manager.register_user(space_id, websocket, user_id)
                    if user_id and last_read_message_id:
                        async with AsyncSessionLocal() as session:
                            space = (await session.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
                            if space:
                                mem_res = await session.execute(
                                    select(SpaceMember).where(SpaceMember.space_id == space_id, SpaceMember.user_id == user_id)
                                )
                                mem = mem_res.scalar_one_or_none()
                                now = datetime.utcnow()
                                if not mem:
                                    mem = SpaceMember(space_id=space_id, user_id=user_id, last_read_message_id=last_read_message_id, last_read_at=now)
                                    session.add(mem)
                                else:
                                    if mem.last_read_message_id is None or last_read_message_id > mem.last_read_message_id:
                                        mem.last_read_message_id = last_read_message_id
                                    mem.last_read_at = now
                                await session.commit()
                                await chat_manager.broadcast(space_id, {
                                    "event": "read_update",
                                    "user_id": user_id,
                                    "last_read_message_id": mem.last_read_message_id,
                                })
                continue
            user_id = ws_user_id
            chat_manager.register_user(space_id, websocket, user_id)
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


@app.websocket("/ws/space/{space_id}")
async def websocket_space_events(websocket: WebSocket, space_id: int):
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
    # 仅用于事件广播（钱包、别名等），客户端可选择发送心跳，服务端忽略内容
    await event_manager.connect(space_id, websocket)
    logger.info(
        "WS_CONNECT space space=%s user=%s query=%s",
        space_id, ws_user_id, dict(websocket.query_params),
    )
    hb_task = asyncio.create_task(_ws_space_heartbeat(websocket))
    try:
        while True:
            try:
                await websocket.receive_text()
            except Exception:
                # 忽略非文本帧或无意义数据
                pass
    except WebSocketDisconnect:
        pass
    finally:
        hb_task.cancel()
        try:
            await hb_task
        except (asyncio.CancelledError, Exception):
            pass
        event_manager.disconnect(space_id, websocket)
