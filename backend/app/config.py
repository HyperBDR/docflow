from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DOCFLOW_", env_file=".env", extra="ignore")
    secret_key: str = "development-only-change-me"
    database_url: str = "sqlite:///./docflow.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: str = "./data"
    public_base_url: str = "http://localhost:8000"
    web_origin: str = "http://localhost:5173"
    cookie_secure: bool = False
    session_days: int = 14
    extension_token_days: int = 30
    dom_slides_enabled: bool = True
    snapshot_compressed_limit_mb: int = 15
    snapshot_uncompressed_limit_mb: int = 50
    ai_enabled: bool = False
    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: str = ""
    ai_model: str = "gpt-4.1-mini"
    ai_vision_enabled: bool = True
    ai_timeout_seconds: int = 120
    ai_chunk_size: int = 8
    render_web_url: str = "http://web"
    chromium_executable: str = "/usr/bin/chromium"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
