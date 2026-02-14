from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from jose import jwt
from pydantic import BaseModel
from app.config import settings
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from models.logs import OperationLog

router = APIRouter()

class LoginRequest(BaseModel):
    code: str


def build_access_token(user_id: str) -> str:
    secret = settings.AUTH_JWT_SECRET or settings.WECHAT_APP_SECRET or "wormhole-dev-secret"
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=max(1, int(settings.AUTH_TOKEN_EXPIRE_DAYS or 30)))
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=settings.AUTH_JWT_ALGORITHM or "HS256")


def build_login_response(openid: str) -> dict:
    token = build_access_token(openid)
    return {
        "openid": openid,
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": max(1, int(settings.AUTH_TOKEN_EXPIRE_DAYS or 30)) * 24 * 3600,
    }


@router.post("/login")
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    appid = settings.WECHAT_APP_ID
    secret = settings.WECHAT_APP_SECRET
    if not appid or not secret:
        # 开发模式：没有配置则返回伪openId，便于本地联调
        openid = f"dev_{payload.code}"
        db.add(OperationLog(
            user_id=openid,
            action="login",
            detail="dev",
            ip=(request.client.host if request.client else None),
            user_agent=request.headers.get("user-agent")
        ))
        return build_login_response(openid)

    url = "https://api.weixin.qq.com/sns/jscode2session"
    params = {
        "appid": appid,
        "secret": secret,
        "js_code": payload.code,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params=params)
        data = resp.json()
    if "openid" in data:
        openid = data["openid"]
        db.add(OperationLog(
            user_id=openid,
            action="login",
            detail="wechat",
            ip=(request.client.host if request.client else None),
            user_agent=request.headers.get("user-agent")
        ))
        return build_login_response(openid)
    return {"error": data}
