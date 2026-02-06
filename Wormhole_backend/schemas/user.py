from pydantic import BaseModel

class AliasSetRequest(BaseModel):
    space_id: int
    user_id: str
    alias: str
    avatar_url: str | None = None
    theme_preference: str | None = None

class AliasResponse(BaseModel):
    space_id: int
    user_id: str
    alias: str
    avatar_url: str | None = None
    theme_preference: str | None = None
