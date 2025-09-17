from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from app.api import space, chat, notes, wallet, settings
from app.api import feed as feed_api
from app.api import upload as upload_api
from app.api import user as user_api
from app.api import auth as auth_api
from app.database import create_tables
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker
from app.database import AsyncSessionLocal
from models.chat import Message
from models.user import UserAlias
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
app.include_router(feed_api.router, prefix="/api/feed", tags=["动态"]) 
app.include_router(upload_api.router, prefix="/api", tags=["上传"]) 

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


class ConnectionManager:
    def __init__(self):
        self.active: dict[int, set[WebSocket]] = {}

    async def connect(self, space_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active.setdefault(space_id, set()).add(websocket)

    def disconnect(self, space_id: int, websocket: WebSocket):
        try:
            self.active.get(space_id, set()).discard(websocket)
        except Exception:
            pass

    async def broadcast(self, space_id: int, message: dict):
        for ws in list(self.active.get(space_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(space_id, ws)


manager = ConnectionManager()


@app.websocket("/ws/chat/{space_id}")
async def websocket_endpoint(websocket: WebSocket, space_id: int):
    await manager.connect(space_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            content = data.get("content", "").strip()
            user_id = str(data.get("user_id") or "")
            if not content:
                continue
            async with AsyncSessionLocal() as session:
                msg = Message(space_id=space_id, user_id=user_id, content=content)
                session.add(msg)
                await session.commit()
                await session.refresh(msg)
                # 查找别名
                alias = None
                try:
                    res = await session.execute(select(UserAlias).where(UserAlias.space_id == space_id, UserAlias.user_id == user_id))
                    ua = res.scalar_one_or_none()
                    alias = ua.alias if ua else None
                except Exception:
                    alias = None
                payload = {
                    "id": msg.id,
                    "user_id": msg.user_id,
                    "content": msg.content,
                    "created_at": msg.created_at.isoformat() if msg.created_at else datetime.utcnow().isoformat(),
                    "alias": alias,
                }
                await manager.broadcast(space_id, payload)
    except WebSocketDisconnect:
        manager.disconnect(space_id, websocket)
