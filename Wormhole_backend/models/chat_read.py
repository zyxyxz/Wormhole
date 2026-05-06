"""Per-device chat read tracking (Task 32).

The legacy ``SpaceMember.last_read_message_id`` records a single per-user
read pointer, which collapses across devices: if a desktop tab reads up to
message #100 the phone's badge clears, even though the phone hasn't seen
the messages. ``ChatRead`` keeps one row per ``(space_id, user_id, device_id)``
so the unread count for a user can take the MIN across their devices and
the lagging device still sees a badge.

The composite primary key matches the natural identity of a device session:
the small program issues / persists ``device_id`` in storage, and we
attribute reads to that device explicitly.
"""

from sqlalchemy import Column, DateTime, Integer, String, Index
from sqlalchemy.sql import func

from app.database import Base


class ChatRead(Base):
    __tablename__ = "chat_reads"
    __table_args__ = (
        Index("ix_chat_reads_space_user", "space_id", "user_id"),
    )

    space_id = Column(Integer, primary_key=True)
    user_id = Column(String, primary_key=True)
    device_id = Column(String, primary_key=True)
    last_read_message_id = Column(Integer, default=0)
    last_read_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
