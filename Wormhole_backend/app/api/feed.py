from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from collections import defaultdict
from app.database import get_db
from models.feed import Post, Comment, PostLike
from models.user import UserAlias
from models.space import Space
from schemas.feed import (
    PostCreate,
    PostResponse,
    FeedListResponse,
    CommentCreate,
    CommentResponse,
    CommentsListResponse,
    PostDeleteRequest,
    CommentDeleteRequest,
    PostLikeRequest,
    LikeEntry,
)
import json
from datetime import datetime
from sqlalchemy import func

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
    avatar_url = None
    row = await db.execute(select(UserAlias).where(UserAlias.space_id == post.space_id, UserAlias.user_id == post.user_id))
    ua = row.scalar_one_or_none()
    if ua:
        alias = ua.alias
        avatar_url = ua.avatar_url
    return PostResponse(
        id=post.id,
        space_id=post.space_id,
        user_id=post.user_id,
        alias=alias,
        avatar_url=avatar_url,
        content=post.content,
        media_type=post.media_type,
        media_urls=json.loads(post.media_urls or "[]"),
        created_at=post.created_at,
        comments=[],
        like_count=0,
        liked_by_me=False,
    )


@router.get("/list", response_model=FeedListResponse)
async def list_posts(space_id: int, user_id: str | None = None, db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Post)
        .where(Post.space_id == space_id, Post.deleted_at.is_(None))
        .order_by(Post.created_at.desc())
    )
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
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}
    like_counts = {}
    liked_post_ids = set()
    likes_map: dict[int, list[LikeEntry]] = {pid: [] for pid in post_ids}
    if post_ids:
        like_rows = await db.execute(
            select(PostLike.post_id, func.count(PostLike.id)).where(PostLike.post_id.in_(post_ids)).group_by(PostLike.post_id)
        )
        for post_id, count in like_rows:
            like_counts[post_id] = count
        like_detail_rows = await db.execute(
            select(PostLike.post_id, PostLike.user_id)
            .where(PostLike.post_id.in_(post_ids))
            .order_by(PostLike.created_at.desc())
        )
        for post_id, liked_user in like_detail_rows:
            ua_entry = alias_map.get(liked_user)
            likes_map.setdefault(post_id, [])
            likes_map[post_id].append(
                LikeEntry(
                    user_id=liked_user,
                    alias=ua_entry.alias if ua_entry else None,
                    avatar_url=ua_entry.avatar_url if ua_entry else None
                )
            )
        if user_id:
            liked_rows = await db.execute(select(PostLike.post_id).where(PostLike.post_id.in_(post_ids), PostLike.user_id == user_id))
            liked_post_ids = {post_id for (post_id,) in liked_rows}
    return FeedListResponse(posts=[
        PostResponse(
            id=p.id,
            space_id=p.space_id,
            user_id=p.user_id,
            alias=(alias_map.get(p.user_id).alias if alias_map.get(p.user_id) else None),
            avatar_url=(alias_map.get(p.user_id).avatar_url if alias_map.get(p.user_id) else None),
            content=p.content,
            media_type=p.media_type,
            media_urls=json.loads(p.media_urls or "[]"),
            created_at=p.created_at,
            like_count=like_counts.get(p.id, 0),
            liked_by_me=p.id in liked_post_ids,
            likes=(likes_map.get(p.id) or []),
            comments=[
                CommentResponse(
                    id=c.id,
                    post_id=c.post_id,
                    user_id=c.user_id,
                    alias=(alias_map.get(c.user_id).alias if alias_map.get(c.user_id) else None),
                    avatar_url=(alias_map.get(c.user_id).avatar_url if alias_map.get(c.user_id) else None),
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
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在")
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
    return CommentResponse(
        id=c.id,
        post_id=c.post_id,
        user_id=c.user_id,
        alias=alias,
        avatar_url=avatar_url,
        content=c.content,
        created_at=c.created_at,
    )


@router.get("/comments", response_model=CommentsListResponse)
async def list_comments(post_id: int, db: AsyncSession = Depends(get_db)):
    post = (await db.execute(select(Post).where(Post.id == post_id))).scalar_one_or_none()
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在")
    res = await db.execute(select(Comment).where(Comment.post_id == post_id).order_by(Comment.created_at))
    comments = res.scalars().all()
    alias_rows = await db.execute(select(UserAlias).where(UserAlias.space_id == post.space_id))
    alias_map = {r.user_id: r for r in alias_rows.scalars().all()}
    return CommentsListResponse(comments=[
        CommentResponse(
            id=c.id,
            post_id=c.post_id,
            user_id=c.user_id,
            alias=(alias_map.get(c.user_id).alias if alias_map.get(c.user_id) else None),
            avatar_url=(alias_map.get(c.user_id).avatar_url if alias_map.get(c.user_id) else None),
            content=c.content,
            created_at=c.created_at,
        ) for c in comments
    ])


@router.post("/delete")
async def delete_post(payload: PostDeleteRequest, db: AsyncSession = Depends(get_db)):
    if not payload.operator_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    post = (await db.execute(select(Post).where(Post.id == payload.post_id))).scalar_one_or_none()
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在或已删除")
    space = (await db.execute(select(Space).where(Space.id == post.space_id))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if payload.operator_user_id not in {post.user_id, space.owner_user_id}:
        raise HTTPException(status_code=403, detail="无权限")
    post.deleted_at = datetime.utcnow()
    await db.commit()
    return {"success": True}


@router.post("/comment/delete")
async def delete_comment(payload: CommentDeleteRequest, db: AsyncSession = Depends(get_db)):
    if not payload.operator_user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    comment = (await db.execute(select(Comment).where(Comment.id == payload.comment_id))).scalar_one_or_none()
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
    await db.delete(comment)
    await db.commit()
    return {"success": True}


@router.post("/like")
async def like_post(payload: PostLikeRequest, db: AsyncSession = Depends(get_db)):
    if not payload.user_id:
        raise HTTPException(status_code=400, detail="缺少用户ID")
    post = (await db.execute(select(Post).where(Post.id == payload.post_id))).scalar_one_or_none()
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在")
    if payload.like:
        exists = (await db.execute(select(PostLike).where(PostLike.post_id == payload.post_id, PostLike.user_id == payload.user_id))).scalar_one_or_none()
        if not exists:
            db.add(PostLike(post_id=payload.post_id, user_id=payload.user_id))
    else:
        await db.execute(delete(PostLike).where(PostLike.post_id == payload.post_id, PostLike.user_id == payload.user_id))
    await db.commit()
    count_row = await db.execute(select(func.count(PostLike.id)).where(PostLike.post_id == payload.post_id))
    like_count = count_row.scalar_one() or 0
    return {"success": True, "like_count": like_count, "liked": payload.like}
