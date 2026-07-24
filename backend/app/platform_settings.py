from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.models import EmailPlatformSettings, ExtensionCaptureSettings, GeneralPlatformSettings, GoogleAuthSettings, MonitoringPlatformSettings
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


DEFAULT_EXTENSION_CAPTURE_FEEDBACK_MS = 1100
MIN_EXTENSION_CAPTURE_FEEDBACK_MS = 500
MAX_EXTENSION_CAPTURE_FEEDBACK_MS = 3000


@dataclass(frozen=True)
class ExtensionCaptureRuntimeConfig:
    feedback_duration_ms: int
    updated_at: object | None = None


def extension_capture_runtime_config(db: Session) -> ExtensionCaptureRuntimeConfig:
    value = db.get(ExtensionCaptureSettings, "default")
    duration = value.feedback_duration_ms if value else DEFAULT_EXTENSION_CAPTURE_FEEDBACK_MS
    return ExtensionCaptureRuntimeConfig(
        feedback_duration_ms=max(MIN_EXTENSION_CAPTURE_FEEDBACK_MS, min(MAX_EXTENSION_CAPTURE_FEEDBACK_MS, duration)),
        updated_at=value.updated_at if value else None,
    )


SUPPORTED_MONITORING_RANGES = ("1h", "6h", "24h", "7d")


@dataclass(frozen=True)
class MonitoringRuntimeConfig:
    monitoring_enabled: bool
    monitoring_interval_seconds: int
    quota_enabled: bool
    quota_interval_seconds: int
    retention_days: int
    raw_ranges: list[str]
    updated_at: object | None = None


def monitoring_runtime_config(db: Session) -> MonitoringRuntimeConfig:
    value = db.get(MonitoringPlatformSettings, "default")
    if value:
        ranges = [item for item in SUPPORTED_MONITORING_RANGES if item in (value.raw_ranges or [])]
        return MonitoringRuntimeConfig(
            monitoring_enabled=value.monitoring_enabled,
            monitoring_interval_seconds=max(30, min(86400, value.monitoring_interval_seconds)),
            quota_enabled=value.quota_enabled,
            quota_interval_seconds=max(30, min(86400, value.quota_interval_seconds)),
            retention_days=max(1, min(365, value.retention_days)),
            raw_ranges=ranges or list(SUPPORTED_MONITORING_RANGES),
            updated_at=value.updated_at,
        )
    return MonitoringRuntimeConfig(
        monitoring_enabled=True,
        monitoring_interval_seconds=max(30, min(86400, settings.monitoring_interval_seconds)),
        quota_enabled=True,
        quota_interval_seconds=300,
        retention_days=max(1, min(365, settings.monitoring_retention_days)),
        raw_ranges=list(SUPPORTED_MONITORING_RANGES),
    )


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
