"""User preference endpoints (主题、自动锁).

Reserved for future per-user preference routes such as theme selection
and auto-lock toggles. The router is currently empty but is wired into
the combined settings router so new endpoints land here automatically.
"""
from fastapi import APIRouter

router = APIRouter()
