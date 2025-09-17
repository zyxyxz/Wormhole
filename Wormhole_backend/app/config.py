from pydantic import BaseModel
from pathlib import Path

class Settings(BaseModel):
    DATABASE_PATH: str = "wormhole.db"
    COS_SECRET_ID: str = ""
    COS_SECRET_KEY: str = ""
    COS_REGION: str = "ap-guangzhou"
    COS_BUCKET: str = ""
    WECHAT_APP_ID: str = "wxf352f78176ea0dd2"
    WECHAT_APP_SECRET: str = "c4b2a446a0fc75c7f679ece1217be76b"

    class Config:
        env_file = ".env"

settings = Settings() 
