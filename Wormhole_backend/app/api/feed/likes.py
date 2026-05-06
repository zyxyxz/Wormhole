from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from app.database import get_db
from app.security import verify_request_user, require_space_member
from models.feed import Post, PostLike
from schemas.feed import PostLikeRequest
from app.utils.operation_log import add_operation_log

router = APIRouter()


@router.post("/like")
async def like_post(payload: PostLikeRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not payload.user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    verify_request_user(request, payload.user_id)
    post = (await db.execute(select(Post).where(Post.id == payload.post_id))).scalar_one_or_none()
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在")
    await require_space_member(db, post.space_id, payload.user_id)
    if payload.like:
        exists = (await db.execute(select(PostLike).where(PostLike.post_id == payload.post_id, PostLike.user_id == payload.user_id))).scalar_one_or_none()
        if not exists:
            db.add(PostLike(post_id=payload.post_id, user_id=payload.user_id))
    else:
        await db.execute(delete(PostLike).where(PostLike.post_id == payload.post_id, PostLike.user_id == payload.user_id))
    await db.commit()
    count_row = await db.execute(select(func.count(PostLike.id)).where(PostLike.post_id == payload.post_id))
    like_count = count_row.scalar_one() or 0
    add_operation_log(
        db,
        user_id=payload.user_id,
        action="feed_like",
        space_id=post.space_id,
        detail={"post_id": payload.post_id, "like": bool(payload.like)},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return {"success": True, "like_count": like_count, "liked": payload.like}
