from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class EmailSettingsUpdate(BaseModel):
    enabled: bool
    host: str = Field(default="", max_length=320)
    port: int = Field(default=587, ge=1, le=65535)
    username: str = Field(default="", max_length=320)
    password: str = Field(default="", max_length=1000)
    from_email: str = Field(default="", max_length=320)
    from_name: str = Field(default="DocFlow", max_length=160)
    security: Literal["starttls", "ssl", "none"] = "starttls"
    timeout_seconds: int = Field(default=10, ge=2, le=60)


class EmailSettingsOut(BaseModel):
    enabled: bool
    host: str
    port: int
    username: str
    password_configured: bool
    from_email: str
    from_name: str
    security: Literal["starttls", "ssl", "none"]
    timeout_seconds: int
    configured: bool
    source: Literal["database", "environment", "none"]
    updated_at: datetime | None = None


class EmailTestInput(BaseModel):
    recipient: str = Field(min_length=3, max_length=320)


class MonitoringSettingsOut(BaseModel):
    automatic_collection: bool = True
    interval_seconds: int
    retention_days: int
    raw_ranges: list[str] = Field(default_factory=lambda: ["1h", "6h", "24h", "7d"])


class GeneralSettingsUpdate(BaseModel):
    help_url: str = Field(default="", max_length=1000)
    upgrade_url: str = Field(default="", max_length=1000)


class GeneralSettingsOut(BaseModel):
    help_url: str
    upgrade_url: str
    updated_at: datetime | None = None


class PublicPlatformConfig(BaseModel):
    help_url: str = ""
    upgrade_url: str = ""


class GoogleAuthSettingsUpdate(BaseModel):
    enabled: bool
    client_id: str = Field(default="", max_length=500)
    client_secret: str = Field(default="", max_length=1000)
    allow_registration: bool = False
    allowed_domains: list[str] = Field(default_factory=list, max_length=100)


class GoogleAuthSettingsOut(BaseModel):
    enabled: bool
    client_id: str
    client_secret_configured: bool
    allow_registration: bool
    allowed_domains: list[str]
    configured: bool
    redirect_uri: str
    updated_at: datetime | None = None


class GoogleAuthPublicConfig(BaseModel):
    enabled: bool
    allow_registration: bool = False


class OAuthIdentityOut(BaseModel):
    provider: Literal["google"]
    email: str
    display_name: str = ""
    avatar_url: str = ""
    created_at: datetime
    last_login_at: datetime | None = None
    can_unlink: bool = False
