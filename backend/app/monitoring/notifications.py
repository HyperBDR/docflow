import json
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

import httpx
from sqlalchemy.orm import Session

from app.models import AlertEvent, NotificationChannel, now
from app.platform_settings import email_runtime_config
from app.secrets import decrypt_secret


SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


def smtp_error_detail(exc: Exception) -> str:
    """Return a safe, stable detail used to localize SMTP failures in the UI."""
    text = str(exc).lower()
    if "main account unavailable" in text or "@ud010102" in text:
        return "SMTP account unavailable"
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "SMTP authentication failed"
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "SMTP sender rejected"
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "SMTP recipient rejected"
    if isinstance(exc, (smtplib.SMTPConnectError, TimeoutError, OSError)):
        return "SMTP connection failed"
    if isinstance(exc, smtplib.SMTPDataError):
        return "SMTP delivery rejected"
    if text == "smtp is not configured":
        return "SMTP is not configured"
    return "SMTP delivery failed"


def _payload(event: AlertEvent, recovered: bool) -> dict:
    return {
        "source": "DocFlow",
        "event": "alert.resolved" if recovered else "alert.triggered",
        "title": event.title,
        "message": event.message,
        "severity": event.severity,
        "status": "resolved" if recovered else event.status,
        "metric_key": event.metric_key,
        "current_value": event.current_value,
        "threshold": event.threshold,
        "started_at": event.started_at.isoformat(),
        "resolved_at": event.resolved_at.isoformat() if event.resolved_at else None,
    }


def _send_webhook(target: str, payload: dict) -> None:
    response = httpx.post(target, json=payload, timeout=8)
    response.raise_for_status()


def _send_email(db: Session, target: str, payload: dict) -> None:
    config = email_runtime_config(db)
    if not config.configured:
        raise RuntimeError("SMTP is not configured")
    message = EmailMessage()
    message["From"] = formataddr((config.from_name, config.from_email))
    message["To"] = target
    message["Subject"] = f"[DocFlow][{payload['severity'].upper()}] {payload['title']}"
    message.set_content(json.dumps(payload, ensure_ascii=False, indent=2))
    client_factory = smtplib.SMTP_SSL if config.security == "ssl" else smtplib.SMTP
    with client_factory(config.host, config.port, timeout=config.timeout_seconds) as client:
        if config.security == "starttls":
            client.starttls()
        if config.username:
            client.login(config.username, config.password)
        client.send_message(message)


def dispatch_notifications(db: Session, event: AlertEvent, recovered: bool = False) -> None:
    payload = _payload(event, recovered)
    channels = db.query(NotificationChannel).filter(NotificationChannel.enabled.is_(True)).all()
    for channel in channels:
        if SEVERITY_RANK.get(event.severity, 0) < SEVERITY_RANK.get(channel.minimum_severity, 1):
            continue
        try:
            target = decrypt_secret(channel.target_encrypted)
            if channel.kind == "webhook":
                _send_webhook(target, payload)
            elif channel.kind == "email":
                _send_email(db, target, payload)
            channel.last_status = "success"
            channel.last_error = ""
        except Exception as exc:
            channel.last_status = "failed"
            channel.last_error = str(exc)[:500]
        channel.last_sent_at = now()
    db.commit()


def test_channel(db: Session, channel: NotificationChannel) -> None:
    target = decrypt_secret(channel.target_encrypted)
    payload = {"source": "DocFlow", "event": "channel.test", "title": "DocFlow notification test", "message": "The monitoring notification channel is working.", "severity": "info", "status": "test"}
    if channel.kind == "webhook":
        _send_webhook(target, payload)
    else:
        _send_email(db, target, payload)


def send_test_email(db: Session, target: str) -> None:
    _send_email(db, target, {
        "source": "DocFlow", "event": "email.test", "title": "DocFlow email service test",
        "message": "The platform email service is configured correctly.", "severity": "info", "status": "test",
    })
