from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.security import verify_request_user
from models.system import SystemSetting

router = APIRouter()

REVIEW_MODE_KEY = "review_mode"


class AdminAuth(BaseModel):
    user_id: str
    room_code: str


class ReviewModePayload(AdminAuth):
    review_mode: bool


async def _get_setting(db: AsyncSession, key: str) -> SystemSetting | None:
    return (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()


async def _set_setting(db: AsyncSession, key: str, value: str):
    setting = await _get_setting(db, key)
    if setting:
        setting.value = value
    else:
        db.add(SystemSetting(key=key, value=value))
    await db.commit()


async def _get_review_mode(db: AsyncSession) -> bool:
    setting = await _get_setting(db, REVIEW_MODE_KEY)
    if not setting:
        return False
    return setting.value == "1"


def is_super_admin(user_id: str) -> bool:
    from app.config import settings
    admin_ids = [i.strip() for i in (settings.SUPER_ADMIN_OPENIDS or '').split(',') if i.strip()]
    return bool(user_id and user_id in admin_ids)


def verify_admin(user_id: str, room_code: str):
    from app.config import settings
    if not (is_super_admin(user_id) and room_code == (settings.SUPER_ADMIN_ROOM_CODE or '')):
        raise HTTPException(status_code=403, detail="无权限")


@router.get("/system")
async def public_system_flags(db: AsyncSession = Depends(get_db)):
    return {"review_mode": await _get_review_mode(db)}


@router.post("/admin/system/review-mode")
async def set_review_mode(payload: ReviewModePayload, request: Request, db: AsyncSession = Depends(get_db)):
    verify_request_user(request, payload.user_id)
    verify_admin(payload.user_id, payload.room_code)
    await _set_setting(db, REVIEW_MODE_KEY, "1" if payload.review_mode else "0")
    return {"review_mode": payload.review_mode}
