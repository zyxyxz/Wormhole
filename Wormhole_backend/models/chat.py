from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from app.database import Base

class Message(Base):
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"))
    user_id = Column(String, index=True)
    content = Column(Text)
    message_type = Column(String, default="text")  # text|image|audio
    media_url = Column(String, nullable=True)
    media_duration = Column(Integer, nullable=True)  # 毫秒
    reply_to_id = Column(Integer, nullable=True)
    reply_to_user_id = Column(String, nullable=True, index=True)
    reply_to_content = Column(Text, nullable=True)
    reply_to_type = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now()) 
    deleted_at = Column(DateTime(timezone=True), nullable=True)
