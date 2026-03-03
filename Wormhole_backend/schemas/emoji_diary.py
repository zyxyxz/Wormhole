from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class EmojiDiaryEntryResponse(BaseModel):
    id: int
    space_id: int
    user_id: str
    entry_date: str
    emoji: str
    note: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EmojiDiaryMonthResponse(BaseModel):
    year: int
    month: int
    entries: List[EmojiDiaryEntryResponse] = Field(default_factory=list)


class EmojiDiaryUpsertRequest(BaseModel):
    space_id: int
    user_id: str
    entry_date: str
    emoji: Optional[str] = ""
    note: Optional[str] = ""


class EmojiDiaryUpsertResponse(BaseModel):
    success: bool = True
    removed: bool = False
    entry: Optional[EmojiDiaryEntryResponse] = None
