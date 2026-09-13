import base64, os, secrets
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "development"
    host: str = "127.0.0.1"
    port: int = 8000
    database_url: str = "sqlite:///../data/zhishu.db"
    data_encryption_key: str | None = None
    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: str = ""
    ai_model: str = ""
    ai_timeout_ms: int = 60000
    ai_allowed_hosts: str = ""
    web_dist: str = "../apps/web/dist"
    ai_provider: str = "openai"
    ai_allow_private_hosts: bool = False

    def key(self):
        if self.data_encryption_key:
            key = base64.b64decode(self.data_encryption_key)
            if len(key) != 32:
                raise ValueError("DATA_ENCRYPTION_KEY must encode exactly 32 bytes")
            return key
        if self.app_env == "production":
            return None
        return _development_key

    def production(self):
        return self.app_env == "production"


_development_key = secrets.token_bytes(32)
settings = Settings()
