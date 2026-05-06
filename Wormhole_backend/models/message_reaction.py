"""Task 28: emoji reactions on chat messages.

One row per (message_id, user_id, emoji) — the unique constraint enforces
"a user cannot react with the same emoji twice on a message". Deletions
of reactions are hard deletes; soft-deleting the parent message hides
reactions from the UI but does not cascade.
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.sql import func

from app.database import Base


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reactions_unique"),
        Index("ix_message_reactions_message_id", "message_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False)
    user_id = Column(String, nullable=False)
    emoji = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
