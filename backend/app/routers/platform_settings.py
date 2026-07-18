from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import admin_user
from app.models import EmailPlatformSettings, GeneralPlatformSettings, GoogleAuthSettings, User
from app.monitoring.notifications import send_test_email, smtp_error_detail
from app.oauth.google import redirect_uri, validate_connectivity
from app.platform_settings import email_runtime_config, general_runtime_config, google_runtime_config
from app.platform_settings_schemas import EmailSettingsOut, EmailSettingsUpdate, EmailTestInput, GeneralSettingsOut, GeneralSettingsUpdate, GoogleAuthSettingsOut, GoogleAuthSettingsUpdate, MonitoringSettingsOut
from app.secrets import encrypt_secret
from app.services import write_audit


router = APIRouter(prefix="/api/admin/settings", tags=["admin-platform-settings"])


def _valid_email(value: str) -> bool:
    name, separator, domain = value.rpartition("@")
    return bool(name and separator and "." in domain and " " not in value)


def _valid_public_url(value: str) -> bool:
    if not value:
        return True
    if any(character.isspace() for character in value):
        return False
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.hostname) and not parsed.username and not parsed.password


def _general_out(db: Session) -> GeneralSettingsOut:
    config = general_runtime_config(db)
    return GeneralSettingsOut(help_url=config.help_url, upgrade_url=config.upgrade_url, updated_at=config.updated_at)


@router.get("/general", response_model=GeneralSettingsOut)
def get_general_settings(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return _general_out(db)


@router.patch("/general", response_model=GeneralSettingsOut)
def update_general_settings(payload: GeneralSettingsUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    help_url = payload.help_url.strip()
    upgrade_url = payload.upgrade_url.strip()
    if not _valid_public_url(help_url) or not _valid_public_url(upgrade_url):
        raise HTTPException(status_code=422, detail="product links must be valid HTTP or HTTPS URLs")
    value = db.get(GeneralPlatformSettings, "default")
    if not value:
        value = GeneralPlatformSettings(id="default")
        db.add(value)
    before = {"help_url": value.help_url, "upgrade_url": value.upgrade_url}
    value.help_url = help_url
    value.upgrade_url = upgrade_url
    value.updated_by_id = actor.id
    db.flush()
    write_audit(db, actor, "platform_general.updated", "platform_settings", value.id, "General settings",
                before=before, after={"help_url": help_url, "upgrade_url": upgrade_url}, request=request)
    db.commit()
    return _general_out(db)


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
        raise HTTPException(status_code=422, detail=smtp_error_detail(exc)) from exc
    return {"status": "sent"}


@router.get("/monitoring", response_model=MonitoringSettingsOut)
def get_monitoring_settings(_: User = Depends(admin_user)):
    return MonitoringSettingsOut(interval_seconds=max(30, settings.monitoring_interval_seconds), retention_days=settings.monitoring_retention_days)


def _google_out(db: Session) -> GoogleAuthSettingsOut:
    config = google_runtime_config(db)
    return GoogleAuthSettingsOut(
        enabled=config.enabled, client_id=config.client_id,
        client_secret_configured=bool(config.client_secret),
        allow_registration=config.allow_registration, allowed_domains=config.allowed_domains,
        configured=config.configured, redirect_uri=redirect_uri(), updated_at=config.updated_at,
    )


@router.get("/google", response_model=GoogleAuthSettingsOut)
def get_google_settings(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return _google_out(db)


@router.patch("/google", response_model=GoogleAuthSettingsOut)
def update_google_settings(payload: GoogleAuthSettingsUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    domains = sorted({domain.strip().lower().lstrip("@") for domain in payload.allowed_domains if domain.strip()})
    if any("@" in domain or "." not in domain or " " in domain for domain in domains):
        raise HTTPException(status_code=422, detail="invalid allowed email domain")
    value = db.get(GoogleAuthSettings, "default")
    if not value:
        value = GoogleAuthSettings(id="default")
        db.add(value)
    if payload.enabled and (not payload.client_id or not (payload.client_secret or value.client_secret_encrypted)):
        raise HTTPException(status_code=422, detail="Google client ID and client secret are required")
    before = {"enabled": value.enabled, "client_id": value.client_id, "client_secret_configured": bool(value.client_secret_encrypted),
              "allow_registration": value.allow_registration, "allowed_domains": value.allowed_domains}
    value.enabled, value.client_id = payload.enabled, payload.client_id.strip()
    value.allow_registration, value.allowed_domains = payload.allow_registration, domains
    if payload.client_secret:
        value.client_secret_encrypted = encrypt_secret(payload.client_secret)
    value.updated_by_id = actor.id
    db.flush()
    after = {"enabled": value.enabled, "client_id": value.client_id, "client_secret_configured": bool(value.client_secret_encrypted),
             "allow_registration": value.allow_registration, "allowed_domains": domains}
    write_audit(db, actor, "platform_google_auth.updated", "platform_settings", value.id, "Google sign-in",
                before=before, after=after, request=request)
    db.commit()
    return _google_out(db)


@router.post("/google/test")
def test_google_settings(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    config = google_runtime_config(db)
    if not config.configured:
        raise HTTPException(status_code=422, detail="Google sign-in is not configured")
    try:
        validate_connectivity()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)[:500]) from exc
    return {"status": "ok"}
