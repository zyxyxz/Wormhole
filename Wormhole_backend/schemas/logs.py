from datetime import datetime
from pydantic import BaseModel


class LogCreateRequest(BaseModel):
    user_id: str
    action: str
    page: str | None = None
    detail: str | None = None
    space_id: int | None = None


class LogEntry(BaseModel):
    id: int
    user_id: str | None = None
    alias: str | None = None
    action: str
    page: str | None = None
    detail: str | None = None
    space_id: int | None = None
    ip: str | None = None
    created_at: datetime | None = None


class LogListResponse(BaseModel):
    logs: list[LogEntry]
    total: int
    limit: int
    offset: int
