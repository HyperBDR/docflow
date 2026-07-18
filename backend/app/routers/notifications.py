from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import InAppNotification, User, now
from app.services import current_organization_id


router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _scope(value: str, user: User) -> str:
    if value not in {"user", "admin"}:
        raise HTTPException(422, "invalid notification scope")
    if value == "admin" and user.role != "admin":
        raise HTTPException(403, "administrator access required")
    return value


def _statement(db: Session, user: User, scope: str):
    statement = select(InAppNotification).where(InAppNotification.recipient_id == user.id, InAppNotification.scope == scope)
    if scope == "user":
        organization_id = current_organization_id(db, user)
        statement = statement.where(or_(InAppNotification.organization_id.is_(None), InAppNotification.organization_id == organization_id))
    return statement.where(or_(InAppNotification.expires_at.is_(None), InAppNotification.expires_at > datetime.now(timezone.utc)))


def _out(value: InAppNotification) -> dict:
    return {
        "id": value.id, "scope": value.scope, "organization_id": value.organization_id,
        "category": value.category, "severity": value.severity, "event_type": value.event_type,
        "title": value.title, "message": value.message, "action_url": value.action_url,
        "data": value.notification_data or {}, "read_at": value.read_at,
        "created_at": value.created_at, "expires_at": value.expires_at,
    }


@router.get("")
def notifications(
    scope: str = "user", category: str = "", unread_only: bool = False,
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    scope = _scope(scope, user)
    statement = _statement(db, user, scope)
    if category:
        statement = statement.where(InAppNotification.category == category)
    if unread_only:
        statement = statement.where(InAppNotification.read_at.is_(None))
    count_statement = select(func.count()).select_from(statement.order_by(None).subquery())
    total = int(db.scalar(count_statement) or 0)
    unread = int(db.scalar(select(func.count()).select_from(
        _statement(db, user, scope).where(InAppNotification.read_at.is_(None)).order_by(None).subquery()
    )) or 0)
    items = db.scalars(statement.order_by(InAppNotification.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_out(item) for item in items], "total": total, "unread": unread, "page": page, "page_size": page_size}


@router.patch("/{notification_id}/read")
def mark_read(notification_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    value = db.get(InAppNotification, notification_id)
    if not value or value.recipient_id != user.id:
        raise HTTPException(404, "notification not found")
    _scope(value.scope, user)
    if not value.read_at:
        value.read_at = now(); db.commit(); db.refresh(value)
    return _out(value)


@router.post("/read-all")
def mark_all_read(scope: str = "user", db: Session = Depends(get_db), user: User = Depends(current_user)):
    scope = _scope(scope, user)
    notification_ids = [item.id for item in db.scalars(_statement(db, user, scope).where(InAppNotification.read_at.is_(None))).all()]
    if notification_ids:
        db.execute(update(InAppNotification).where(InAppNotification.id.in_(notification_ids)).values(read_at=now()))
        db.commit()
    return {"updated": len(notification_ids)}
