from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8098

    # Database / Storage
    DATABASE_PATH: str = "wormhole.db"
    COS_SECRET_ID: str = ""
    COS_SECRET_KEY: str = ""
    COS_REGION: str = "ap-guangzhou"
    COS_BUCKET: str = ""
    WECHAT_APP_ID: str = "wxf352f78176ea0dd2"
    WECHAT_APP_SECRET: str = "c4b2a446a0fc75c7f679ece1217be76b"
    SUPER_ADMIN_OPENIDS: str = "oeGzH5XJLcl-i9K5XvkBS0g-mbec"
    SUPER_ADMIN_ROOM_CODE: str = "201432"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
