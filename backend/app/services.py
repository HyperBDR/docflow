import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi import HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.ai_models import active_model
from app.defaults import DEFAULT_PLAYBACK, DEFAULT_THEME, DEFAULT_TOOLTIP, DEFAULT_HOTSPOT_STYLE, navigation_defaults
from app.models import AuditLog, Demo, Organization, OrganizationMember, PublishedRevision, ShareToken, Step, User
from app.schemas import DemoOut, HotspotOut, StepOut


def organization_membership(db: Session, user: User, organization_id: str | None = None) -> OrganizationMember | None:
    organization_id = organization_id or user.current_organization_id
    if not organization_id:
        return None
    return db.scalar(select(OrganizationMember).where(
        OrganizationMember.organization_id == organization_id, OrganizationMember.user_id == user.id
    ))


def current_organization_id(db: Session, user: User) -> str:
    active_id = getattr(user, "_active_organization_id", None) or user.current_organization_id
    organization = db.get(Organization, active_id) if active_id else None
    if organization and organization.status == "active" and (user.role == "admin" or organization_membership(db, user, organization.id)):
        return organization.id
    membership = organization_membership(db, user)
    if membership and db.get(Organization, membership.organization_id).status != "active":
        membership = None
    if not membership:
        membership = db.scalar(select(OrganizationMember).join(
            Organization, Organization.id == OrganizationMember.organization_id
        ).where(OrganizationMember.user_id == user.id, Organization.status == "active").order_by(
            (Organization.kind == "personal").desc(), OrganizationMember.created_at
        ))
        if not membership:
            raise HTTPException(status_code=403, detail="organization access required")
        user.current_organization_id = membership.organization_id
        db.flush()
    return membership.organization_id


def require_organization_role(db: Session, user: User, organization_id: str, roles: set[str]) -> OrganizationMember:
    organization = db.get(Organization, organization_id)
    if not organization or organization.status != "active":
        raise HTTPException(status_code=403, detail="organization is archived")
    membership = organization_membership(db, user, organization_id)
    # Platform administrators govern every team space without being inserted
    # into its member list. Personal spaces remain private to their owner;
    # administrators use the dedicated governance APIs for account resources.
    if not membership and user.role == "admin" and organization.kind == "team":
        return SimpleNamespace(role="admin", organization_id=organization_id, user_id=user.id)
    if not membership or membership.role not in roles:
        raise HTTPException(status_code=403, detail="organization permission denied")
    return membership


def create_personal_organization(db: Session, user: User) -> Organization:
    base = re.sub(r"[^a-z0-9]+", "-", (user.name or user.email.split("@", 1)[0]).lower()).strip("-") or "workspace"
    organization = Organization(
        name=f"{user.name or user.email.split('@', 1)[0]}'s Space",
        slug=f"{base}-{user.id[:8]}-{uuid.uuid4().hex[:4]}", created_by_id=user.id,
        kind="personal", status="active", personal_owner_id=user.id,
    )
    db.add(organization); db.flush()
    db.add(OrganizationMember(organization_id=organization.id, user_id=user.id, role="owner"))
    user.current_organization_id = organization.id
    db.flush()
    return organization


def write_audit(
    db: Session, actor: User | None, action: str, target_type: str, target_id: str,
    target_label: str = "", organization_id: str | None = None,
    before: dict | None = None, after: dict | None = None, request: Request | None = None,
    source: str = "web", outcome: str = "success",
) -> AuditLog:
    if source == "web" and request and request.url.path.startswith("/api/admin/"):
        source = "admin"
    log = AuditLog(
        actor_id=actor.id if actor else None, organization_id=organization_id,
        action=action, target_type=target_type, target_id=target_id, target_label=target_label,
        before=before or {}, after=after or {},
        ip_address=(request.client.host if request and request.client else "")[:80],
        user_agent=(request.headers.get("user-agent", "") if request else "")[:500],
        source=source[:30], outcome=outcome[:20],
    )
    db.add(log)
    return log


def viewable_demo(db: Session, demo_id: str, user: User) -> Demo:
    demo = db.get(Demo, demo_id)
    organization = db.get(Organization, demo.organization_id) if demo else None
    if not demo or demo.deleted_at or not organization or organization.status != "active" or (user.role != "admin" and not organization_membership(db, user, demo.organization_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="demo not found")
    return demo


def owned_demo(db: Session, demo_id: str, user: User) -> Demo:
    demo = viewable_demo(db, demo_id, user)
    require_organization_role(db, user, demo.organization_id, {"owner", "admin", "editor"})
    return demo


def active_share(db: Session, demo_id: str) -> ShareToken | None:
    return db.scalar(
        select(ShareToken)
        .where(
            ShareToken.demo_id == demo_id, ShareToken.revoked.is_(False),
            or_(ShareToken.expires_at.is_(None), ShareToken.expires_at > datetime.now(timezone.utc)),
        )
        .order_by(ShareToken.created_at.desc())
    )


def step_out(step: Step, demo_id: str) -> StepOut:
    result = StepOut.model_validate(step)
    result.image_url = f"{settings.public_base_url}/api/demos/{demo_id}/steps/{step.id}/image"
    result.snapshot_url = (
        f"{settings.public_base_url}/api/demos/{demo_id}/steps/{step.id}/snapshot"
        if step.dom_snapshot_key else None
    )
    result.hotspots = [HotspotOut.model_validate(item) for item in step.hotspots]
    if not result.hotspots and step.hotspot:
        result.hotspots = [HotspotOut(
            id=f"legacy-{step.id}", position=0, selector={}, fallback_rect=step.hotspot,
            trigger="click", action={"type": "next"}, tooltip=DEFAULT_TOOLTIP,
            style=DEFAULT_HOTSPOT_STYLE,
        )]
    return result


def demo_out(db: Session, demo: Demo, include_steps: bool = True) -> DemoOut:
    share = active_share(db, demo.id)
    first_step = min(demo.steps, key=lambda item: item.position, default=None)
    creator = db.get(User, demo.owner_id)
    return DemoOut(
        id=demo.id,
        organization_id=demo.organization_id,
        title=demo.title,
        description=demo.description,
        ai_context=demo.ai_context or "",
        content_locale=demo.content_locale or "zh-CN",
        status=demo.status.value,
        created_at=demo.created_at,
        updated_at=demo.updated_at,
        created_by={"id": creator.id, "name": creator.name or "", "email": creator.email} if creator else {"id": demo.owner_id, "name": "", "email": ""},
        steps=[step_out(step, demo.id) for step in demo.steps] if include_steps else [],
        thumbnail_url=(
            f"{settings.public_base_url}/api/demos/{demo.id}/steps/{first_step.id}/image"
            if first_step else None
        ),
        share_url=f"{settings.web_origin}/p/{share.token}" if share else None,
        theme={**DEFAULT_THEME, **(demo.theme or {})},
        navigation={**navigation_defaults(demo.content_locale), **(demo.navigation or {})},
        playback={**DEFAULT_PLAYBACK, **(demo.playback or {})},
        manual_fields=demo.manual_fields or [],
        ai_enabled=bool(active_model(db)),
        category_id=demo.category_id,
        tags=demo.tags,
    )


def next_revision_number(db: Session, demo_id: str) -> int:
    value = db.scalar(select(func.max(PublishedRevision.number)).where(PublishedRevision.demo_id == demo_id))
    return (value or 0) + 1
