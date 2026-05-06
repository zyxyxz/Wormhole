from fastapi import APIRouter
from . import space, member, system, preferences
from .system import verify_admin, is_super_admin  # re-export for app.api.logs

router = APIRouter()
router.include_router(system.router)
router.include_router(space.router)
router.include_router(member.router)
router.include_router(preferences.router)

__all__ = ["router", "verify_admin", "is_super_admin"]
