from fastapi import APIRouter
from . import posts, comments, likes

router = APIRouter()
router.include_router(posts.router)
router.include_router(comments.router)
router.include_router(likes.router)
