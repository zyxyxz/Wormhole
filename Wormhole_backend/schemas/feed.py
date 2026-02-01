from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class PostCreate(BaseModel):
    space_id: int
    user_id: str
    content: str = ""
    media_type: str = "none"  # none|image|video
    media_urls: List[str] = []


class CommentResponse(BaseModel):
    id: int
    post_id: int
    user_id: str
    alias: Optional[str] = None
    avatar_url: Optional[str] = None
    content: str
    created_at: datetime
    created_at_ts: Optional[int] = None


class CommentCreate(BaseModel):
    post_id: int
    user_id: str
    content: str


class CommentsListResponse(BaseModel):
    comments: List[CommentResponse]


class PostDeleteRequest(BaseModel):
    post_id: int
    operator_user_id: str


class CommentDeleteRequest(BaseModel):
    comment_id: int
    operator_user_id: str


class PostLikeRequest(BaseModel):
    post_id: int
    user_id: str
    like: bool = True


class LikeEntry(BaseModel):
    user_id: str
    alias: Optional[str] = None
    avatar_url: Optional[str] = None


class PostResponse(BaseModel):
    id: int
    space_id: int
    user_id: str
    alias: Optional[str] = None
    avatar_url: Optional[str] = None
    content: str
    media_type: str
    media_urls: List[str]
    created_at: datetime
    created_at_ts: Optional[int] = None
    comments: List[CommentResponse] = Field(default_factory=list)
    like_count: int = 0
    liked_by_me: bool = False
    likes: List[LikeEntry] = Field(default_factory=list)


class FeedListResponse(BaseModel):
    posts: List[PostResponse]
