from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class MessageBase(BaseModel):
    content: str

class MessageCreate(MessageBase):
    space_id: int
    user_id: str
    message_type: str = "text"
    media_url: Optional[str] = None
    media_duration: Optional[int] = None
    reply_to_id: Optional[int] = None
    reply_to_user_id: Optional[str] = None
    reply_to_content: Optional[str] = None
    reply_to_type: Optional[str] = None

class MessageResponse(MessageBase):
    id: int
    user_id: str
    alias: Optional[str] = None
    message_type: str = "text"
    media_url: Optional[str] = None
    media_duration: Optional[int] = None
    avatar_url: Optional[str] = None
    created_at_ts: Optional[int] = None
    reply_to_id: Optional[int] = None
    reply_to_user_id: Optional[str] = None
    reply_to_content: Optional[str] = None
    reply_to_type: Optional[str] = None
    reply_to_alias: Optional[str] = None
    reply_to_avatar_url: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class ChatHistoryResponse(BaseModel):
    messages: List[MessageResponse]
    last_message_id: Optional[int]
    has_more: Optional[bool] = None
    next_before_id: Optional[int] = None


class ReadUpdateRequest(BaseModel):
    space_id: int
    user_id: str
    last_read_message_id: int


class ReaderStatus(BaseModel):
    user_id: str
    alias: Optional[str] = None
    avatar_url: Optional[str] = None
    last_read_message_id: Optional[int] = None
    last_read_at: Optional[datetime] = None


class ChatReadStatusResponse(BaseModel):
    readers: List[ReaderStatus]
