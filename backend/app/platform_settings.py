from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.models import EmailPlatformSettings
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
