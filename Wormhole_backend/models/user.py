from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.database import Base

class UserAlias(Base):
    __tablename__ = "user_aliases"
    __table_args__ = (
        UniqueConstraint('space_id', 'user_id', name='uq_space_user'),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True)
    user_id = Column(String, index=True)  # wechat openid
    alias = Column(String, default="")
    avatar_url = Column(String, nullable=True)
    theme_preference = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
