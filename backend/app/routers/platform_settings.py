from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import admin_user
from app.models import EmailPlatformSettings, User
from app.monitoring.notifications import send_test_email
from app.platform_settings import email_runtime_config
from app.platform_settings_schemas import EmailSettingsOut, EmailSettingsUpdate, EmailTestInput, MonitoringSettingsOut
from app.secrets import encrypt_secret
from app.services import write_audit


router = APIRouter(prefix="/api/admin/settings", tags=["admin-platform-settings"])


def _valid_email(value: str) -> bool:
    name, separator, domain = value.rpartition("@")
    return bool(name and separator and "." in domain and " " not in value)


def _email_out(db: Session) -> EmailSettingsOut:
    config = email_runtime_config(db)
    return EmailSettingsOut(
        enabled=config.enabled, host=config.host, port=config.port,
        username=config.username, password_configured=bool(config.password),
        from_email=config.from_email, from_name=config.from_name,
        security=config.security, timeout_seconds=config.timeout_seconds,
        configured=config.configured, source=config.source,
        updated_at=config.updated_at,
    )


@router.get("/email", response_model=EmailSettingsOut)
def get_email_settings(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return _email_out(db)


@router.patch("/email", response_model=EmailSettingsOut)
def update_email_settings(payload: EmailSettingsUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    if payload.enabled and (not payload.host or not _valid_email(payload.from_email)):
        raise HTTPException(status_code=422, detail="host and a valid sender email are required")
    value = db.get(EmailPlatformSettings, "default")
    if not value:
        value = EmailPlatformSettings(id="default")
        if not payload.password and settings.smtp_password:
            value.password_encrypted = encrypt_secret(settings.smtp_password)
        db.add(value)
    before = {"enabled": value.enabled, "host": value.host, "port": value.port, "username": value.username,
              "from_email": value.from_email, "from_name": value.from_name, "security": value.security,
              "timeout_seconds": value.timeout_seconds, "password_configured": bool(value.password_encrypted)}
    for key in ("enabled", "host", "port", "username", "from_email", "from_name", "security", "timeout_seconds"):
        setattr(value, key, getattr(payload, key))
    if payload.password:
        value.password_encrypted = encrypt_secret(payload.password)
    value.updated_by_id = actor.id
    after = {key: getattr(value, key) for key in ("enabled", "host", "port", "username", "from_email", "from_name", "security", "timeout_seconds")}
    after["password_configured"] = bool(value.password_encrypted)
    db.flush()
    write_audit(db, actor, "platform_email.updated", "platform_settings", value.id, "Email service", before=before, after=after, request=request)
    db.commit()
    return _email_out(db)


@router.post("/email/test")
def test_email_settings(payload: EmailTestInput, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    if not _valid_email(payload.recipient):
        raise HTTPException(status_code=422, detail="invalid recipient email")
    try:
        send_test_email(db, payload.recipient)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)[:500]) from exc
    return {"status": "sent"}


@router.get("/monitoring", response_model=MonitoringSettingsOut)
def get_monitoring_settings(_: User = Depends(admin_user)):
    return MonitoringSettingsOut(interval_seconds=max(30, settings.monitoring_interval_seconds), retention_days=settings.monitoring_retention_days)
