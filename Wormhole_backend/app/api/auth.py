from fastapi import APIRouter
from pydantic import BaseModel
from app.config import settings
import httpx

router = APIRouter()

class LoginRequest(BaseModel):
    code: str

@router.post("/login")
async def login(payload: LoginRequest):
    appid = settings.WECHAT_APP_ID
    secret = settings.WECHAT_APP_SECRET
    if not appid or not secret:
        # 开发模式：没有配置则返回伪openId，便于本地联调
        return {"openid": f"dev_{payload.code}"}

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
        return {"openid": data["openid"]}
    return {"error": data}

