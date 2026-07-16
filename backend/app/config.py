from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DOCFLOW_", env_file=".env", extra="ignore")
    secret_key: str = "development-only-change-me"
    database_url: str = "sqlite:///./docflow.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: str = "./data"
    storage_allowed_roots: str = "/data,/storage-data"
    public_base_url: str = "http://localhost:8000"
    web_origin: str = "http://localhost:5173"
    cookie_secure: bool = False
    session_days: int = 14
    # Extension credentials use sliding expiration. Active installations stay
    # connected, while disabled accounts/password changes still revoke them.
    extension_token_days: int = 180
    allow_user_create_team_space: bool = False
    dom_slides_enabled: bool = True
    snapshot_compressed_limit_mb: int = 15
    snapshot_uncompressed_limit_mb: int = 50
    render_web_url: str = "http://web"
    chromium_executable: str = "/usr/bin/chromium"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
