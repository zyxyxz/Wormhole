from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class PostCreate(BaseModel):
    space_id: int
    user_id: str
    content: str = ""
    media_type: str = "none"  # none|image|video
    media_urls: List[str] = []


class PostResponse(BaseModel):
    id: int
    space_id: int
    user_id: str
    alias: Optional[str] = None
    content: str
    media_type: str
    media_urls: List[str]
    created_at: datetime


class FeedListResponse(BaseModel):
    posts: List[PostResponse]


class CommentCreate(BaseModel):
    post_id: int
    user_id: str
    content: str


class CommentResponse(BaseModel):
    id: int
    post_id: int
    user_id: str
    alias: Optional[str] = None
    content: str
    created_at: datetime


class CommentsListResponse(BaseModel):
    comments: List[CommentResponse]

