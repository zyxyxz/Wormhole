from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from app.database import get_db
from app.security import verify_request_user, require_space_member
from models.feed import Post, Comment
from models.user import UserAlias
from models.space import Space
from schemas.feed import (
    CommentCreate,
    CommentResponse,
    CommentsListResponse,
    CommentDeleteRequest,
)
from app.utils.media import process_avatar_url
from app.utils.operation_log import add_operation_log

router = APIRouter()


@router.post("/comment", response_model=CommentResponse)
async def add_comment(payload: CommentCreate, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request, payload.user_id)
    # 确认post存在
    post = (await db.execute(select(Post).where(Post.id == payload.post_id))).scalar_one_or_none()
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在")
    await require_space_member(db, post.space_id, actor_user_id)
    c = Comment(post_id=payload.post_id, user_id=payload.user_id, content=payload.content)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    alias = None
    avatar_url = None
    row = await db.execute(select(UserAlias).where(UserAlias.space_id == post.space_id, UserAlias.user_id == c.user_id))
    ua = row.scalar_one_or_none()
    if ua:
        alias = ua.alias
        avatar_url = ua.avatar_url
    add_operation_log(
        db,
        user_id=c.user_id,
        action="feed_comment",
        space_id=post.space_id,
        detail={"comment_id": c.id, "post_id": c.post_id},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return CommentResponse(
        id=c.id,
        post_id=c.post_id,
        user_id=c.user_id,
        alias=alias,
        avatar_url=process_avatar_url(avatar_url),
        content=c.content,
        created_at=c.created_at,
        created_at_ts=int(c.created_at.timestamp() * 1000) if c.created_at else None,
    )


@router.get("/comments", response_model=CommentsListResponse)
async def list_comments(post_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    actor_user_id = verify_request_user(request)
    post = (await db.execute(select(Post).where(Post.id == post_id))).scalar_one_or_none()
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在")
    await require_space_member(db, post.space_id, actor_user_id)
    res = await db.execute(
        select(Comment)
        .where(Comment.post_id == post_id, Comment.deleted_at.is_(None))
        .order_by(Comment.created_at)
    )
    comments = res.scalars().all()
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == post.space_id))
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}
    return CommentsListResponse(comments=[
        CommentResponse(
            id=c.id,
            post_id=c.post_id,
            user_id=c.user_id,
            alias=(alias_map.get(c.user_id).alias if alias_map.get(c.user_id) else None),
            avatar_url=process_avatar_url(alias_map.get(c.user_id).avatar_url if alias_map.get(c.user_id) else None),
            content=c.content,
            created_at=c.created_at,
            created_at_ts=int(c.created_at.timestamp() * 1000) if c.created_at else None,
        ) for c in comments
    ])


@router.post("/comment/delete")
async def delete_comment(payload: CommentDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not payload.operator_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    verify_request_user(request, payload.operator_user_id)
    comment = (await db.execute(select(Comment).where(Comment.id == payload.comment_id, Comment.deleted_at.is_(None)))).scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")
    post = (await db.execute(select(Post).where(Post.id == comment.post_id))).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="动态不存在")
    space = (await db.execute(select(Space).where(Space.id == post.space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if payload.operator_user_id not in {comment.user_id, space.owner_user_id}:
        raise HTTPException(status_code=403, detail="无权限")
    comment.deleted_at = datetime.utcnow()
    await db.commit()
    return {"success": True}
