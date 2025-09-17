from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.database import Base

class Space(Base):
    __tablename__ = "spaces"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True)  # 空间号
    owner_user_id = Column(String, index=True, nullable=True)  # 房主openid
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class SpaceMapping(Base):
    __tablename__ = "space_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)  # 用户ID
    space_id = Column(Integer, ForeignKey("spaces.id"))
    space_code = Column(String, index=True)  # 用户的专属空间号
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SpaceCode(Base):
    __tablename__ = "space_codes"

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True)
    code = Column(String, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ShareCode(Base):
    __tablename__ = "share_codes"

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True)
    code = Column(String, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class SpaceMember(Base):
    __tablename__ = "space_members"
    __table_args__ = (
        UniqueConstraint('space_id', 'user_id', name='uq_space_member'),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True)
    user_id = Column(String, index=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

class SpaceBlock(Base):
    __tablename__ = "space_blocks"
    __table_args__ = (
        UniqueConstraint('space_id', 'user_id', name='uq_space_block'),
    )

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True)
    user_id = Column(String, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
