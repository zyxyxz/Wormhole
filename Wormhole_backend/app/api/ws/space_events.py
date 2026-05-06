import asyncio
import logging
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.api.ws.chat import WS_HEARTBEAT_FIRST_S, WS_HEARTBEAT_INTERVAL_S
from app.database import AsyncSessionLocal
from app.security import get_ws_user_id
from app.ws import event_manager
from models.space import Space, SpaceMember

logger = logging.getLogger("wormhole.ws")

router = APIRouter()


async def _ws_space_heartbeat(websocket: WebSocket) -> None:
    """First ping ~1s after handshake, then every WS_HEARTBEAT_INTERVAL_S.

    Mirrors the chat heartbeat shape so the CDN sees regular frames; without
    this the event_manager channel was getting torn down at ~900ms idle.
    """
    try:
        await asyncio.sleep(WS_HEARTBEAT_FIRST_S)
    except asyncio.CancelledError:
        return
    while True:
        try:
            await websocket.send_json({
                "event": "server_ping",
                "ts": int(time.time()),
            })
        except Exception:
            return
        try:
            await asyncio.sleep(WS_HEARTBEAT_INTERVAL_S)
        except asyncio.CancelledError:
            return


@router.websocket("/ws/space/{space_id}")
async def space_events_ws_endpoint(websocket: WebSocket, space_id: int):
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
