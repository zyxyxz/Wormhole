from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

class NoteBase(BaseModel):
    title: str
    content: str

class NoteCreate(NoteBase):
    space_id: int
    user_id: str
    editable_by_others: bool = True

class NoteResponse(NoteBase):
    id: int
    user_id: str
    alias: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class NoteListResponse(BaseModel):
    notes: List[NoteResponse]

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    user_id: str
    editable_by_others: Optional[bool] = None
