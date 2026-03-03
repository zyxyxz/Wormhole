from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base


class EmojiDiaryEntry(Base):
    __tablename__ = "emoji_diary_entries"
    __table_args__ = (
        UniqueConstraint("space_id", "user_id", "entry_date", name="uq_emoji_diary_space_user_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True, nullable=False)
    user_id = Column(String, index=True, nullable=False)
    entry_date = Column(String, index=True, nullable=False)  # YYYY-MM-DD
    emoji = Column(String, default="", nullable=False)
    note = Column(Text, default="", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
