from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.models import EmailPlatformSettings, GeneralPlatformSettings, GoogleAuthSettings
from app.secrets import decrypt_secret


@dataclass(frozen=True)
class EmailRuntimeConfig:
    enabled: bool
    host: str
    port: int
    username: str
    password: str
    from_email: str
    from_name: str
    security: str
    timeout_seconds: int
    source: str
    updated_at: object | None = None

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.host and self.from_email)


def email_runtime_config(db: Session) -> EmailRuntimeConfig:
    value = db.get(EmailPlatformSettings, "default")
    if value:
        return EmailRuntimeConfig(
            enabled=value.enabled, host=value.host, port=value.port,
            username=value.username, password=decrypt_secret(value.password_encrypted),
            from_email=value.from_email, from_name=value.from_name,
            security=value.security, timeout_seconds=value.timeout_seconds,
            source="database", updated_at=value.updated_at,
        )
    configured = bool(settings.smtp_host and settings.smtp_from)
    return EmailRuntimeConfig(
        enabled=configured, host=settings.smtp_host, port=settings.smtp_port,
        username=settings.smtp_username, password=settings.smtp_password,
        from_email=settings.smtp_from, from_name="DocFlow",
        security="starttls" if settings.smtp_tls else "none", timeout_seconds=10,
        source="environment" if configured else "none",
    )


@dataclass(frozen=True)
class GeneralRuntimeConfig:
    help_url: str
    upgrade_url: str
    updated_at: object | None = None


def general_runtime_config(db: Session) -> GeneralRuntimeConfig:
    value = db.get(GeneralPlatformSettings, "default")
    return GeneralRuntimeConfig(help_url=value.help_url, upgrade_url=value.upgrade_url, updated_at=value.updated_at) if value else GeneralRuntimeConfig(help_url="", upgrade_url="")


@dataclass(frozen=True)
class GoogleRuntimeConfig:
    enabled: bool
    client_id: str
    client_secret: str
    allow_registration: bool
    allowed_domains: list[str]
    updated_at: object | None = None

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.client_id and self.client_secret)


def google_runtime_config(db: Session) -> GoogleRuntimeConfig:
    value = db.get(GoogleAuthSettings, "default")
    if not value:
        return GoogleRuntimeConfig(False, "", "", False, [])
    return GoogleRuntimeConfig(
        enabled=value.enabled, client_id=value.client_id,
        client_secret=decrypt_secret(value.client_secret_encrypted),
        allow_registration=value.allow_registration,
        allowed_domains=[str(domain).lower() for domain in (value.allowed_domains or [])],
        updated_at=value.updated_at,
    )
