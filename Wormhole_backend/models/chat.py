from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Index
from sqlalchemy.sql import func
from app.database import Base

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_space_id_id", "space_id", "id"),
        Index("ix_messages_space_deleted", "space_id", "deleted_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"))
    user_id = Column(String, index=True)
    content = Column(Text)
    message_type = Column(String, default="text")  # text|image|video|audio|live|sticker
    media_url = Column(String, nullable=True)
    media_duration = Column(Integer, nullable=True)  # 毫秒
    reply_to_id = Column(Integer, nullable=True)
    reply_to_user_id = Column(String, nullable=True, index=True)
    reply_to_content = Column(Text, nullable=True)
    reply_to_type = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edit_history = Column(Text, nullable=True)  # JSON list of prior versions
    mentions = Column(Text, nullable=True)  # Task 29: JSON list of user_id strings
