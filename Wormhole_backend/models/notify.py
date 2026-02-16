from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.database import Base


class NotifyChannel(Base):
    __tablename__ = "notify_channels"

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True, nullable=False)
    user_id = Column(String, index=True, nullable=False)
    provider = Column(String, nullable=False, default="feishu")  # feishu|pushbear|pushdeer|webhook
    target = Column(Text, nullable=False)  # webhook url / sendkey / pushdeer pushkey
    remark = Column(String, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    notify_chat = Column(Boolean, nullable=False, default=True)
    notify_feed = Column(Boolean, nullable=False, default=True)
    cooldown_seconds = Column(Integer, nullable=False, default=600)
    disguise_type = Column(String, nullable=False, default="market")  # market|ops|security|custom
    custom_title = Column(String, nullable=True)
    custom_body = Column(Text, nullable=True)
    skip_when_online = Column(Boolean, nullable=False, default=True)
    last_notified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
