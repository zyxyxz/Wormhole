from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class SpaceBase(BaseModel):
    code: str

class SpaceCreate(SpaceBase):
    pass

class SpaceResponse(SpaceBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class SpaceEnterRequest(BaseModel):
    space_code: str
    user_id: Optional[str] = None
    create_if_missing: bool = False

class SpaceEnterResponse(BaseModel):
    success: bool
    message: str
    space_id: Optional[int] = None
    theme_preference: Optional[str] = None
    admin_entry: bool = False
    requires_creation: bool = False

class MemberResponse(BaseModel):
    user_id: str
    alias: Optional[str] = None
    avatar_url: Optional[str] = None

class MembersListResponse(BaseModel):
    members: list[MemberResponse]

class RemoveMemberRequest(BaseModel):
    space_id: int
    member_user_id: str
    operator_user_id: str

class BlockMemberRequest(RemoveMemberRequest):
    pass

class UnblockMemberRequest(RemoveMemberRequest):
    pass

class BlocksListResponse(BaseModel):
    blocks: list[MemberResponse]
