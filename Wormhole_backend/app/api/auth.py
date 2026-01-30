from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from app.config import settings
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from models.logs import OperationLog

router = APIRouter()

class LoginRequest(BaseModel):
    code: str

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
        return {"openid": openid}

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
        return {"openid": openid}
    return {"error": data}
