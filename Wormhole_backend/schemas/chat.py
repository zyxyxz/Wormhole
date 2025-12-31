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

class MessageResponse(MessageBase):
    id: int
    user_id: str
    alias: Optional[str] = None
    message_type: str = "text"
    media_url: Optional[str] = None
    media_duration: Optional[int] = None
    avatar_url: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class ChatHistoryResponse(BaseModel):
    messages: List[MessageResponse]
    last_message_id: Optional[int]
