from pydantic import BaseModel

class AliasSetRequest(BaseModel):
    space_id: int
    user_id: str
    alias: str

class AliasResponse(BaseModel):
    space_id: int
    user_id: str
    alias: str

