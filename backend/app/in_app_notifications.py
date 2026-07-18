from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Demo, InAppNotification, Organization, OrganizationMember, User


def create_notification(
    db: Session,
    recipient_id: str,
    event_type: str,
    *,
    scope: str = "user",
    organization_id: str | None = None,
    category: str = "system",
    severity: str = "info",
    title: str = "",
    message: str = "",
    action_url: str = "",
    data: dict | None = None,
    dedupe_key: str | None = None,
    expires_at: datetime | None = None,
) -> InAppNotification | None:
    if dedupe_key and db.scalar(select(InAppNotification.id).where(
        InAppNotification.recipient_id == recipient_id,
        InAppNotification.scope == scope,
        InAppNotification.dedupe_key == dedupe_key,
    )):
        return None
    value = InAppNotification(
        recipient_id=recipient_id, organization_id=organization_id, scope=scope,
        category=category, severity=severity, event_type=event_type,
        title=title[:240], message=message[:1000], action_url=action_url[:1000],
        notification_data=data or {}, dedupe_key=dedupe_key, expires_at=expires_at,
    )
    db.add(value)
    return value


def organization_manager_ids(db: Session, organization: Organization) -> list[str]:
    ids = set(db.scalars(select(OrganizationMember.user_id).join(
        User, User.id == OrganizationMember.user_id,
    ).where(
        OrganizationMember.organization_id == organization.id,
        OrganizationMember.role.in_(["owner", "admin"]),
        User.is_active.is_(True), User.deleted_at.is_(None),
    )).all())
    if organization.personal_owner_id:
        ids.add(organization.personal_owner_id)
    return sorted(ids)


def notify_admins(db: Session, event_type: str, **kwargs) -> int:
    count = 0
    for recipient_id in db.scalars(select(User.id).where(
        User.role == "admin", User.is_active.is_(True), User.deleted_at.is_(None),
    )).all():
        if create_notification(db, recipient_id, event_type, scope="admin", **kwargs):
            count += 1
    return count


def notify_job_result(db: Session, job, job_type: str, succeeded: bool) -> None:
    demo = db.get(Demo, job.demo_id)
    event_type = f"job.{job_type}.{'completed' if succeeded else 'failed'}"
    label = demo.title if demo else ""
    create_notification(
        db, job.owner_id, event_type, organization_id=demo.organization_id if demo else None,
        category="task", severity="success" if succeeded else "critical",
        title=f"{job_type.title()} task {'completed' if succeeded else 'failed'}",
        message=label, action_url="/tasks",
        data={"job_id": job.id, "resource_id": job.demo_id, "resource_title": label, "kind": getattr(job, "kind", job_type)},
        dedupe_key=f"{event_type}:{job.id}",
    )
