import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import space, chat, notes, wallet, settings
from app.api import auth as auth_api
from app.api import emoji_diary as emoji_diary_api
from app.api import feed as feed_api
from app.api import logs as logs_api
from app.api import notify as notify_api
from app.api import upload as upload_api
from app.api import user as user_api
from app.api import vault as vault_api
from app.api.ws import chat as ws_chat
from app.api.ws import space_events as ws_space_events
from app.config import settings as app_settings
from app.database import create_tables
from app.security import require_jwt_secret_configured
from app.services.log_service import start_log_worker, stop_log_worker
from app.utils.limiter import limiter

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

# WebSocket 端点
app.include_router(ws_chat.router)
app.include_router(ws_space_events.router)


@app.get("/")
async def root():
    return {"message": "欢迎使用虫洞私密共享空间"}
