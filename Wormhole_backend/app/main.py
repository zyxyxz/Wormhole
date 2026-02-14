from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.api import space, chat, notes, wallet, settings
from app.api import feed as feed_api
from app.api import upload as upload_api
from app.api import user as user_api
from app.api import auth as auth_api
from app.api import logs as logs_api
from app.api import notify as notify_api
from app.database import create_tables
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker
from app.database import AsyncSessionLocal
from models.chat import Message
from models.space import SpaceMember, Space
from models.user import UserAlias
from app.ws import chat_manager, event_manager
from app.utils.media import (
    encode_live_media,
    process_avatar_url,
    process_live_media_urls,
    process_message_media_url,
    strip_url,
)
from app.utils.operation_log import add_operation_log
from app.security import get_header_user_id
from app.services.notify_dispatcher import fire_room_notification
from sqlalchemy import select
from datetime import datetime

app = FastAPI(title="虫洞私密共享空间")

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

@app.on_event("startup")
async def startup():
    await create_tables()
    # 静态资源（媒体文件）
    try:
        from fastapi.staticfiles import StaticFiles
        app.mount("/static", StaticFiles(directory="static"), name="static")
    except Exception:
        pass

@app.get("/")
async def root():
    return {"message": "欢迎使用虫洞私密共享空间"}


@app.websocket("/ws/chat/{space_id}")
async def websocket_endpoint(websocket: WebSocket, space_id: int):
    ws_user_id = websocket.query_params.get("user_id") or get_header_user_id(websocket)
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
    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            if event:
                user_id = ws_user_id
                if event == "presence":
                    chat_manager.register_user(space_id, websocket, user_id)
                    await chat_manager.broadcast_presence(space_id)
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
            content = data.get("content", "")
            user_id = ws_user_id
            message_type = (data.get("message_type") or "text").lower()
            media_url = strip_url(data.get("media_url"))
            live_cover_url = data.get("live_cover_url")
            live_video_url = data.get("live_video_url")
            media_duration = data.get("media_duration")
            client_id = data.get("client_id")
            reply_to_id = data.get("reply_to_id")
            reply_to_user_id = data.get("reply_to_user_id")
            reply_to_content = data.get("reply_to_content")
            reply_to_type = data.get("reply_to_type")
            try:
                media_duration = int(media_duration) if media_duration is not None else None
            except Exception:
                media_duration = None
            try:
                reply_to_id = int(reply_to_id) if reply_to_id is not None else None
            except Exception:
                reply_to_id = None
            chat_manager.register_user(space_id, websocket, user_id)
            if message_type == "text":
                content = (content or "").strip()
                if not content:
                    continue
            elif message_type == "live":
                media_url = encode_live_media(live_cover_url, live_video_url)
                if not media_url:
                    continue
            elif not media_url:
                # 非文本消息必须有媒体地址
                continue
            async with AsyncSessionLocal() as session:
                msg = Message(
                    space_id=space_id,
                    user_id=user_id,
                    content=content or "",
                    message_type=message_type,
                    media_url=media_url,
                    media_duration=media_duration,
                    reply_to_id=reply_to_id,
                    reply_to_user_id=reply_to_user_id,
                    reply_to_content=reply_to_content,
                    reply_to_type=reply_to_type,
                )
                session.add(msg)
                await session.commit()
                await session.refresh(msg)
                add_operation_log(
                    session,
                    user_id=user_id,
                    action="chat_send",
                    space_id=space_id,
                    detail={"message_id": msg.id, "message_type": msg.message_type},
                    ip=(websocket.client.host if websocket.client else None),
                    user_agent=websocket.headers.get("user-agent") if hasattr(websocket, "headers") else None
                )
                await session.commit()
                # 查找别名
                alias = None
                avatar_url = None
                reply_alias = None
                reply_avatar_url = None
                try:
                    alias_targets = [user_id]
                    if reply_to_user_id:
                        alias_targets.append(reply_to_user_id)
                    res = await session.execute(
                        select(UserAlias).where(UserAlias.space_id == space_id, UserAlias.user_id.in_(alias_targets))
                    )
                    alias_map = {r.user_id: r for r in res.scalars().all()}
                    ua = alias_map.get(user_id)
                    if ua:
                        alias = ua.alias
                        avatar_url = ua.avatar_url
                    reply_ua = alias_map.get(reply_to_user_id) if reply_to_user_id else None
                    if reply_ua:
                        reply_alias = reply_ua.alias
                        reply_avatar_url = reply_ua.avatar_url
                except Exception:
                    alias = None
                    avatar_url = None
                live_cover_payload = None
                live_video_payload = None
                media_url_payload = process_message_media_url(msg.media_url, msg.message_type)
                if (msg.message_type or "").lower() == "live":
                    live_cover_payload, live_video_payload = process_live_media_urls(msg.media_url)
                    media_url_payload = live_cover_payload
                fire_room_notification(
                    space_id=space_id,
                    event_type="chat",
                    sender_user_id=user_id,
                    sender_alias=alias,
                )
                payload = {
                    "id": msg.id,
                    "user_id": msg.user_id,
                    "content": msg.content,
                    "message_type": msg.message_type,
                    "media_url": media_url_payload,
                    "live_cover_url": live_cover_payload,
                    "live_video_url": live_video_payload,
                    "media_duration": msg.media_duration,
                    "created_at": msg.created_at.isoformat() if msg.created_at else datetime.utcnow().isoformat(),
                    "created_at_ts": int(msg.created_at.timestamp() * 1000) if msg.created_at else None,
                    "client_id": client_id,
                    "alias": alias,
                    "avatar_url": process_avatar_url(avatar_url),
                    "reply_to_id": msg.reply_to_id,
                    "reply_to_user_id": msg.reply_to_user_id,
                    "reply_to_content": msg.reply_to_content,
                    "reply_to_type": msg.reply_to_type,
                    "reply_to_alias": reply_alias,
                    "reply_to_avatar_url": process_avatar_url(reply_avatar_url),
                }
                chat_manager.set_typing(space_id, user_id, False)
                await chat_manager.broadcast(space_id, {
                    "event": "typing",
                    "user_id": user_id,
                    "typing": False
                })
                await chat_manager.broadcast(space_id, payload)
    except WebSocketDisconnect:
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
    ws_user_id = websocket.query_params.get("user_id") or get_header_user_id(websocket)
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
    try:
        while True:
            try:
                await websocket.receive_text()
            except Exception:
                # 忽略非文本帧或无意义数据
                pass
    except WebSocketDisconnect:
        event_manager.disconnect(space_id, websocket)
