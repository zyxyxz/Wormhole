from pydantic import BaseModel
from pathlib import Path

class Settings(BaseModel):
    DATABASE_PATH: str = "wormhole.db"
    COS_SECRET_ID: str = ""
    COS_SECRET_KEY: str = ""
    COS_REGION: str = "ap-guangzhou"
    COS_BUCKET: str = ""
    WECHAT_APP_ID: str = ""
    WECHAT_APP_SECRET: str = ""

    class Config:
        env_file = ".env"

settings = Settings() 
