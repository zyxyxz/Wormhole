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
    OSS_ACCESS_KEY_ID: str = ""
    OSS_ACCESS_KEY_SECRET: str = ""
    OSS_ENDPOINT: str = ""
    OSS_BUCKET: str = ""
    OSS_BASE_URL: str = ""
    OSS_PREFIX: str = ""
    OSS_PRIVATE_ENABLED: bool = True
    OSS_SIGN_EXPIRE_SECONDS: int = 1800
    OSS_IMAGE_PROCESS_CHAT: str = "image/resize,m_lfit,w_1080/quality,q_80"
    OSS_IMAGE_PROCESS_FEED: str = "image/resize,m_lfit,w_1280/quality,q_80"
    OSS_IMAGE_PROCESS_AVATAR: str = "image/resize,m_lfit,w_256/quality,q_80"
    WECHAT_APP_ID: str = "wxf352f78176ea0dd2"
    WECHAT_APP_SECRET: str = "c4b2a446a0fc75c7f679ece1217be76b"
    SUPER_ADMIN_OPENIDS: str = "oeGzH5XJLcl-i9K5XvkBS0g-mbec"
    SUPER_ADMIN_ROOM_CODE: str = "201432"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
