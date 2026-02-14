from datetime import datetime

from pydantic import BaseModel


class NotifyChannelBase(BaseModel):
    provider: str
    target: str
    remark: str | None = None
    enabled: bool = True
    notify_chat: bool = True
    notify_feed: bool = True
    cooldown_seconds: int = 600
    disguise_type: str = "market"
    custom_title: str | None = None
    custom_body: str | None = None
    skip_when_online: bool = True


class NotifyChannelCreateRequest(NotifyChannelBase):
    space_id: int


class NotifyChannelUpdateRequest(NotifyChannelBase):
    pass


class NotifyChannelResponse(NotifyChannelBase):
    id: int
    space_id: int
    user_id: str
    last_notified_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class NotifyChannelListResponse(BaseModel):
    channels: list[NotifyChannelResponse]


class NotifyChannelTestRequest(BaseModel):
    channel_id: int
