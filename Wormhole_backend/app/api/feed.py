from fastapi import APIRouter, Depends, HTTPException, Request
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
from app.utils.media import process_avatar_url, process_feed_media_urls, strip_urls
from app.utils.operation_log import add_operation_log

router = APIRouter()


@router.post("/create", response_model=PostResponse)
async def create_post(payload: PostCreate, request: Request, db: AsyncSession = Depends(get_db)):
    clean_media_urls = strip_urls(payload.media_urls or [])
    media_urls_json = json.dumps(clean_media_urls)
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
    add_operation_log(
        db,
        user_id=post.user_id,
        action="feed_post",
        space_id=post.space_id,
        detail={"post_id": post.id, "media_type": post.media_type},
        ip=(request.client.host if request.client else None),
        user_agent=request.headers.get("user-agent")
    )
    return PostResponse(
        id=post.id,
        space_id=post.space_id,
        user_id=post.user_id,
        alias=alias,
        avatar_url=process_avatar_url(avatar_url),
        content=post.content,
        media_type=post.media_type,
        media_urls=process_feed_media_urls(json.loads(post.media_urls or "[]"), post.media_type),
        created_at=post.created_at,
        created_at_ts=int(post.created_at.timestamp() * 1000) if post.created_at else None,
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
            select(Comment)
            .where(Comment.post_id.in_(post_ids), Comment.deleted_at.is_(None))
            .order_by(Comment.created_at)
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
                    avatar_url=process_avatar_url(ua_entry.avatar_url if ua_entry else None)
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
            avatar_url=process_avatar_url(alias_map.get(p.user_id).avatar_url if alias_map.get(p.user_id) else None),
            content=p.content,
            media_type=p.media_type,
            media_urls=process_feed_media_urls(json.loads(p.media_urls or "[]"), p.media_type),
            created_at=p.created_at,
            created_at_ts=int(p.created_at.timestamp() * 1000) if p.created_at else None,
            like_count=like_counts.get(p.id, 0),
            liked_by_me=p.id in liked_post_ids,
            likes=(likes_map.get(p.id) or []),
            comments=[
                CommentResponse(
                    id=c.id,
                    post_id=c.post_id,
                    user_id=c.user_id,
                    alias=(alias_map.get(c.user_id).alias if alias_map.get(c.user_id) else None),
                    avatar_url=process_avatar_url(alias_map.get(c.user_id).avatar_url if alias_map.get(c.user_id) else None),
                    content=c.content,
                    created_at=c.created_at,
                    created_at_ts=int(c.created_at.timestamp() * 1000) if c.created_at else None,
                ) for c in comments_map.get(p.id, [])
            ]
        ) for p in posts
    ])


@router.post("/comment", response_model=CommentResponse)
async def add_comment(payload: CommentCreate, request: Request, db: AsyncSession = Depends(get_db)):
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
async def list_comments(post_id: int, db: AsyncSession = Depends(get_db)):
    post = (await db.execute(select(Post).where(Post.id == post_id))).scalar_one_or_none()
    if not post or post.deleted_at:
        raise HTTPException(status_code=404, detail="动态不存在")
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


@router.post("/like")
async def like_post(payload: PostLikeRequest, request: Request, db: AsyncSession = Depends(get_db)):
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


@router.get("/unread-count")
async def unread_count(space_id: int, since_ts: int | None = None, user_id: str | None = None, db: AsyncSession = Depends(get_db)):
    space = (await db.execute(select(Space).where(Space.id == space_id, Space.deleted_at.is_(None)))).scalar_one_or_none()
    if not space:
        raise HTTPException(status_code=404, detail="空间不存在")
    if not since_ts:
        return {"count": 0}
    try:
        since_ts = int(since_ts)
    except Exception:
        return {"count": 0}
    since_dt = datetime.utcfromtimestamp(since_ts / 1000)
    post_query = select(func.count(Post.id)).where(
        Post.space_id == space_id,
        Post.deleted_at.is_(None),
        Post.created_at > since_dt
    )
    if user_id:
        post_query = post_query.where(Post.user_id != user_id)
    post_count = (await db.execute(post_query)).scalar_one() or 0

    comment_query = (
        select(func.count(Comment.id))
        .select_from(Comment)
        .join(Post, Comment.post_id == Post.id)
        .where(
            Post.space_id == space_id,
            Post.deleted_at.is_(None),
            Comment.deleted_at.is_(None),
            Comment.created_at > since_dt
        )
    )
    if user_id:
        comment_query = comment_query.where(Comment.user_id != user_id)
    comment_count = (await db.execute(comment_query)).scalar_one() or 0

    like_query = (
        select(func.count(PostLike.id))
        .select_from(PostLike)
        .join(Post, PostLike.post_id == Post.id)
        .where(
            Post.space_id == space_id,
            Post.deleted_at.is_(None),
            PostLike.created_at > since_dt
        )
    )
    if user_id:
        like_query = like_query.where(PostLike.user_id != user_id)
    like_count = (await db.execute(like_query)).scalar_one() or 0

    return {"count": post_count + comment_count + like_count}
