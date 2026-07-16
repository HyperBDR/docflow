import json
import smtplib
from email.message import EmailMessage

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AlertEvent, NotificationChannel, now
from app.secrets import decrypt_secret


SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


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


def _send_email(target: str, payload: dict) -> None:
    if not settings.smtp_host or not settings.smtp_from:
        raise RuntimeError("SMTP is not configured")
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = target
    message["Subject"] = f"[DocFlow][{payload['severity'].upper()}] {payload['title']}"
    message.set_content(json.dumps(payload, ensure_ascii=False, indent=2))
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        if settings.smtp_tls:
            client.starttls()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password)
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
                _send_email(target, payload)
            channel.last_status = "success"
            channel.last_error = ""
        except Exception as exc:
            channel.last_status = "failed"
            channel.last_error = str(exc)[:500]
        channel.last_sent_at = now()
    db.commit()


def test_channel(channel: NotificationChannel) -> None:
    target = decrypt_secret(channel.target_encrypted)
    payload = {"source": "DocFlow", "event": "channel.test", "title": "DocFlow notification test", "message": "The monitoring notification channel is working.", "severity": "info", "status": "test"}
    if channel.kind == "webhook":
        _send_webhook(target, payload)
    else:
        _send_email(target, payload)
