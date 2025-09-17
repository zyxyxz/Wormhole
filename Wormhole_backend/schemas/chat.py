from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class MessageBase(BaseModel):
    content: str

class MessageCreate(MessageBase):
    space_id: int
    user_id: str

class MessageResponse(MessageBase):
    id: int
    user_id: str
    alias: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class ChatHistoryResponse(BaseModel):
    messages: List[MessageResponse]
    last_message_id: Optional[int]
