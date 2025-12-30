from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from collections import defaultdict
from app.database import get_db
from models.feed import Post, Comment
from models.user import UserAlias
from schemas.feed import PostCreate, PostResponse, FeedListResponse, CommentCreate, CommentResponse, CommentsListResponse
import json

router = APIRouter()


@router.post("/create", response_model=PostResponse)
async def create_post(payload: PostCreate, db: AsyncSession = Depends(get_db)):
    media_urls_json = json.dumps(payload.media_urls or [])
    post = Post(
        space_id=payload.space_id,
        user_id=payload.user_id,
        content=payload.content or "",
        media_type=payload.media_type or "none",
        media_urls=media_urls_json,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    alias = None
    row = await db.execute(select(UserAlias).where(UserAlias.space_id == post.space_id, UserAlias.user_id == post.user_id))
    ua = row.scalar_one_or_none()
    alias = ua.alias if ua else None
    return PostResponse(
        id=post.id,
        space_id=post.space_id,
        user_id=post.user_id,
        alias=alias,
        content=post.content,
        media_type=post.media_type,
        media_urls=json.loads(post.media_urls or "[]"),
        created_at=post.created_at,
        comments=[],
    )


@router.get("/list", response_model=FeedListResponse)
async def list_posts(space_id: int, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Post).where(Post.space_id == space_id).order_by(Post.created_at.desc()))
    posts = res.scalars().all()
    post_ids = [p.id for p in posts]
    comments_map: dict[int, list[Comment]] = defaultdict(list)
    if post_ids:
        comment_rows = await db.execute(
            select(Comment).where(Comment.post_id.in_(post_ids)).order_by(Comment.created_at)
        )
        for c in comment_rows.scalars().all():
            comments_map[c.post_id].append(c)
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == space_id))
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}
    return FeedListResponse(posts=[
        PostResponse(
            id=p.id,
            space_id=p.space_id,
            user_id=p.user_id,
            alias=alias_map.get(p.user_id),
            content=p.content,
            media_type=p.media_type,
            media_urls=json.loads(p.media_urls or "[]"),
            created_at=p.created_at,
            comments=[
                CommentResponse(
                    id=c.id,
                    post_id=c.post_id,
                    user_id=c.user_id,
                    alias=alias_map.get(c.user_id),
                    content=c.content,
                    created_at=c.created_at,
                ) for c in comments_map.get(p.id, [])
            ]
        ) for p in posts
    ])


@router.post("/comment", response_model=CommentResponse)
async def add_comment(payload: CommentCreate, db: AsyncSession = Depends(get_db)):
    # 确认post存在
    post = (await db.execute(select(Post).where(Post.id == payload.post_id))).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="动态不存在")
    c = Comment(post_id=payload.post_id, user_id=payload.user_id, content=payload.content)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    alias = None
    row = await db.execute(select(UserAlias).where(UserAlias.space_id == post.space_id, UserAlias.user_id == c.user_id))
    ua = row.scalar_one_or_none()
    alias = ua.alias if ua else None
    return CommentResponse(
        id=c.id,
        post_id=c.post_id,
        user_id=c.user_id,
        alias=alias,
        content=c.content,
        created_at=c.created_at,
    )


@router.get("/comments", response_model=CommentsListResponse)
async def list_comments(post_id: int, db: AsyncSession = Depends(get_db)):
    post = (await db.execute(select(Post).where(Post.id == post_id))).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="动态不存在")
    res = await db.execute(select(Comment).where(Comment.post_id == post_id).order_by(Comment.created_at))
    comments = res.scalars().all()
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == post.space_id))
    alias_map = {r.user_id: r.alias for r in alias_rows.scalars().all()}
    return CommentsListResponse(comments=[
        CommentResponse(
            id=c.id,
            post_id=c.post_id,
            user_id=c.user_id,
            alias=alias_map.get(c.user_id),
            content=c.content,
            created_at=c.created_at,
        ) for c in comments
    ])
