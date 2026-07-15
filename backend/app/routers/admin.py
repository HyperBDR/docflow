import io
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import case, delete, distinct, func, or_, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import admin_user
from app.models import (
    AnalyticsEvent,
    AIJob,
    AuditLog,
    Category,
    Demo,
    DemoStatus,
    ExportJob,
    ExtensionPair,
    ExtensionToken,
    Organization,
    OrganizationInvitation,
    OrganizationMember,
    PublishedRevision,
    Session as UserSession,
    ShareToken,
    Step,
    StepComment,
    Tag,
    User,
    demo_tags,
)
from app.schemas import (
    AdminOverview,
    AdminMembershipCreate,
    AdminMembershipOut,
    AdminMembershipUpdate,
    AdminPasswordReset,
    AdminOrganizationOut,
    AuditLogOut,
    AuditLogPage,
    AdminResourceDetail,
    AdminResourceOut,
    AdminResourceOwner,
    AdminResourcePage,
    AdminUserOut,
    AdminUserPage,
    AdminUserUpdate,
    RecycleItemOut,
    UserStats,
)
from app.security import hash_password
from app.services import demo_out, write_audit
from app.security import utcnow
from app.storage import storage

router = APIRouter(prefix="/api/admin", tags=["admin"])


def get_user_or_404(db: Session, user_id: str) -> User:
    target = db.get(User, user_id)
    if not target or target.deleted_at:
        raise HTTPException(status_code=404, detail="user not found")
    return target


def revoke_credentials(db: Session, user_id: str) -> None:
    db.execute(delete(UserSession).where(UserSession.user_id == user_id))
    db.execute(delete(ExtensionPair).where(ExtensionPair.user_id == user_id))
    db.execute(delete(ExtensionToken).where(ExtensionToken.user_id == user_id))


def admin_count(db: Session) -> int:
    return db.scalar(select(func.count(User.id)).where(User.role == "admin", User.deleted_at.is_(None))) or 0


def ensure_admin_remains(db: Session, target: User, next_role: str | None = None, next_active: bool | None = None) -> None:
    role = next_role if next_role is not None else target.role
    active = next_active if next_active is not None else target.is_active
    if target.role == "admin" and (role != "admin" or not active) and admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="at least one administrator is required")


def user_stats_map(db: Session, user_ids: list[str]) -> dict[str, UserStats]:
    """Load all user usage summaries in a fixed number of queries."""
    result = {user_id: UserStats() for user_id in user_ids}
    if not user_ids:
        return result
    for owner_id, demos, published in db.execute(select(
        Demo.owner_id,
        func.count(Demo.id),
        func.sum(case((Demo.status == DemoStatus.published, 1), else_=0)),
    ).where(Demo.owner_id.in_(user_ids), Demo.deleted_at.is_(None)).group_by(Demo.owner_id)):
        result[owner_id].demos = demos or 0
        result[owner_id].published_demos = published or 0
    for owner_id, steps in db.execute(select(Demo.owner_id, func.count(Step.id)).join(
        Step, Step.demo_id == Demo.id
    ).where(Demo.owner_id.in_(user_ids), Demo.deleted_at.is_(None)).group_by(Demo.owner_id)):
        result[owner_id].steps = steps or 0
    for owner_id, views, viewers in db.execute(select(
        Demo.owner_id,
        func.count(distinct(AnalyticsEvent.session_id)),
        func.count(distinct(AnalyticsEvent.visitor_id)),
    ).join(AnalyticsEvent, AnalyticsEvent.demo_id == Demo.id).where(
        Demo.owner_id.in_(user_ids), Demo.deleted_at.is_(None)
    ).group_by(Demo.owner_id)):
        result[owner_id].views = views or 0
        result[owner_id].unique_viewers = viewers or 0
    for owner_id, exports in db.execute(select(ExportJob.owner_id, func.count(ExportJob.id)).where(
        ExportJob.owner_id.in_(user_ids)
    ).group_by(ExportJob.owner_id)):
        result[owner_id].exports = exports or 0

    keys: dict[str, set[str]] = {user_id: set() for user_id in user_ids}
    for owner_id, asset_key, snapshot_key in db.execute(select(
        Demo.owner_id, Step.asset_key, Step.dom_snapshot_key
    ).join(Step, Step.demo_id == Demo.id).where(Demo.owner_id.in_(user_ids), Demo.deleted_at.is_(None))):
        if asset_key:
            keys[owner_id].add(asset_key)
        if snapshot_key:
            keys[owner_id].add(snapshot_key)
    for owner_id, result_key in db.execute(select(ExportJob.owner_id, ExportJob.result_key).where(
        ExportJob.owner_id.in_(user_ids), ExportJob.result_key.is_not(None)
    )):
        if result_key:
            keys[owner_id].add(result_key)
    for owner_id, values in keys.items():
        result[owner_id].storage_bytes = sum(storage.size(key) for key in values)
    return result


def user_stats(db: Session, user_id: str) -> UserStats:
    return user_stats_map(db, [user_id])[user_id]


def membership_out(user: User, membership: OrganizationMember, organization: Organization) -> AdminMembershipOut:
    return AdminMembershipOut(
        id=membership.id, organization_id=organization.id, organization_name=organization.name,
        organization_slug=organization.slug, organization_kind=organization.kind, role=membership.role,
        is_current=user.current_organization_id == organization.id, created_at=membership.created_at,
    )


def user_memberships_map(db: Session, users: list[User]) -> dict[str, list[AdminMembershipOut]]:
    result = {user.id: [] for user in users}
    if not users:
        return result
    users_by_id = {user.id: user for user in users}
    rows = db.execute(select(OrganizationMember, Organization).join(
        Organization, Organization.id == OrganizationMember.organization_id
    ).where(OrganizationMember.user_id.in_(users_by_id)).order_by(Organization.name)).all()
    for membership, organization in rows:
        result[membership.user_id].append(membership_out(users_by_id[membership.user_id], membership, organization))
    return result


def user_out(
    db: Session, user: User, stats: UserStats | None = None,
    memberships: list[AdminMembershipOut] | None = None,
) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        name=user.name or "",
        role=user.role,
        is_active=user.is_active,
        ui_locale=user.ui_locale,
        current_organization_id=user.current_organization_id,
        active_organization_id=user.current_organization_id,
        created_at=user.created_at,
        stats=stats or user_stats(db, user.id),
        memberships=memberships if memberships is not None else user_memberships_map(db, [user])[user.id],
    )


@router.get("/overview", response_model=AdminOverview)
def overview(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    users = db.scalars(select(User).where(User.deleted_at.is_(None))).all()
    stats = list(user_stats_map(db, [user.id for user in users]).values())
    return AdminOverview(
        users=len(users),
        active_users=sum(1 for user in users if user.is_active),
        admins=sum(1 for user in users if user.role == "admin"),
        demos=sum(item.demos for item in stats),
        views=sum(item.views for item in stats),
        storage_bytes=sum(item.storage_bytes for item in stats),
    )


@router.get("/users", response_model=AdminUserPage)
def list_users(
    query: str = Query(default="", max_length=200),
    role: str | None = Query(default=None, pattern="^(user|admin)$"),
    active: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(admin_user),
):
    statement = select(User).where(User.deleted_at.is_(None))
    if query.strip():
        value = f"%{query.strip().lower()}%"
        statement = statement.where(or_(func.lower(User.name).like(value), func.lower(User.email).like(value)))
    if role:
        statement = statement.where(User.role == role)
    if active is not None:
        statement = statement.where(User.is_active == active)
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    users = db.scalars(statement.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    stats = user_stats_map(db, [user.id for user in users])
    memberships = user_memberships_map(db, users)
    return AdminUserPage(
        items=[user_out(db, user, stats[user.id], memberships[user.id]) for user in users],
        total=total, page=page, page_size=page_size,
    )


@router.get("/users/{user_id}", response_model=AdminUserOut)
def get_user(user_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return user_out(db, get_user_or_404(db, user_id))


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(
    user_id: str,
    payload: AdminUserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(admin_user),
):
    target = get_user_or_404(db, user_id)
    before = {"name": target.name, "email": target.email, "role": target.role, "is_active": target.is_active, "ui_locale": target.ui_locale}
    values = payload.model_dump(exclude_unset=True)
    changes_own_access = (
        ("role" in values and values["role"] != target.role)
        or ("is_active" in values and values["is_active"] != target.is_active)
    )
    if target.id == actor.id and changes_own_access:
        raise HTTPException(status_code=400, detail="cannot modify your own role or status")
    ensure_admin_remains(db, target, values.get("role"), values.get("is_active"))
    if "email" in values:
        values["email"] = str(values["email"]).lower()
        duplicate = db.scalar(select(User.id).where(User.email == values["email"], User.id != target.id))
        if duplicate:
            raise HTTPException(status_code=409, detail="email already in use")
    if "name" in values:
        values["name"] = (values["name"] or "").strip()
    was_active = target.is_active
    for key, value in values.items():
        setattr(target, key, value)
    if was_active and not target.is_active:
        revoke_credentials(db, target.id)
    write_audit(db, actor, "user.updated", "user", target.id, target.email, before=before, after=values, request=request)
    db.commit()
    db.refresh(target)
    return user_out(db, target)


@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: str,
    payload: AdminPasswordReset,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(admin_user),
):
    target = get_user_or_404(db, user_id)
    target.password_hash = hash_password(payload.new_password)
    revoke_credentials(db, target.id)
    write_audit(db, actor, "user.password_reset", "user", target.id, target.email, request=request)
    db.commit()


def membership_or_404(db: Session, user_id: str, membership_id: str) -> OrganizationMember:
    membership = db.scalar(select(OrganizationMember).where(
        OrganizationMember.id == membership_id, OrganizationMember.user_id == user_id
    ))
    if not membership:
        raise HTTPException(status_code=404, detail="organization member not found")
    return membership


def ensure_owner_remains(db: Session, membership: OrganizationMember, next_role: str | None = None) -> None:
    if membership.role != "owner" or next_role == "owner":
        return
    owners = db.scalar(select(func.count(OrganizationMember.id)).where(
        OrganizationMember.organization_id == membership.organization_id,
        OrganizationMember.role == "owner",
    )) or 0
    if owners <= 1:
        raise HTTPException(status_code=400, detail="at least one organization owner is required")


@router.post("/users/{user_id}/memberships", response_model=AdminUserOut, status_code=201)
def add_user_membership(
    user_id: str, payload: AdminMembershipCreate, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(admin_user),
):
    target = get_user_or_404(db, user_id)
    organization = db.get(Organization, payload.organization_id)
    if not organization:
        raise HTTPException(status_code=404, detail="organization not found")
    if organization.status != "active":
        raise HTTPException(status_code=403, detail="organization is archived")
    if organization.kind != "team":
        raise HTTPException(status_code=400, detail="personal spaces cannot have members")
    existing = db.scalar(select(OrganizationMember).where(
        OrganizationMember.user_id == target.id,
        OrganizationMember.organization_id == organization.id,
    ))
    if existing:
        raise HTTPException(status_code=409, detail="user is already an organization member")
    membership = OrganizationMember(organization_id=organization.id, user_id=target.id, role=payload.role)
    db.add(membership); db.flush()
    if not target.current_organization_id:
        target.current_organization_id = organization.id
    write_audit(db, actor, "member.added", "member", membership.id, target.email, organization.id, after={"role": membership.role}, request=request)
    db.commit(); db.refresh(target)
    return user_out(db, target)


@router.patch("/users/{user_id}/memberships/{membership_id}", response_model=AdminUserOut)
def update_user_membership(
    user_id: str, membership_id: str, payload: AdminMembershipUpdate, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(admin_user),
):
    target = get_user_or_404(db, user_id)
    membership = membership_or_404(db, target.id, membership_id)
    organization = db.get(Organization, membership.organization_id)
    if organization.status != "active":
        raise HTTPException(status_code=403, detail="organization is archived")
    if organization.kind == "personal":
        raise HTTPException(status_code=400, detail="personal space membership is immutable")
    ensure_owner_remains(db, membership, payload.role)
    before = {"role": membership.role}; membership.role = payload.role
    write_audit(db, actor, "member.role_updated", "member", membership.id, target.email, membership.organization_id, before, {"role": membership.role}, request)
    db.commit(); db.refresh(target)
    return user_out(db, target)


@router.delete("/users/{user_id}/memberships/{membership_id}", response_model=AdminUserOut)
def delete_user_membership(
    user_id: str, membership_id: str, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(admin_user),
):
    target = get_user_or_404(db, user_id)
    membership = membership_or_404(db, target.id, membership_id)
    organization = db.get(Organization, membership.organization_id)
    if organization.kind == "personal":
        raise HTTPException(status_code=400, detail="personal space membership is immutable")
    membership_count = db.scalar(select(func.count(OrganizationMember.id)).where(
        OrganizationMember.user_id == target.id
    )) or 0
    if membership_count <= 1:
        raise HTTPException(status_code=400, detail="user must belong to at least one organization")
    ensure_owner_remains(db, membership)
    organization_id = membership.organization_id
    before = {"role": membership.role}
    db.delete(membership); db.flush()
    if target.current_organization_id == organization_id:
        personal = db.scalar(select(Organization).where(
            Organization.kind == "personal", Organization.personal_owner_id == target.id,
            Organization.status == "active",
        ))
        replacement = db.scalar(select(OrganizationMember).join(
            Organization, Organization.id == OrganizationMember.organization_id
        ).where(OrganizationMember.user_id == target.id, Organization.status == "active").order_by(OrganizationMember.created_at))
        target.current_organization_id = personal.id if personal else replacement.organization_id if replacement else None
    db.execute(update(UserSession).where(
        UserSession.user_id == target.id, UserSession.active_organization_id == organization_id
    ).values(active_organization_id=None))
    db.execute(update(ExtensionToken).where(
        ExtensionToken.user_id == target.id, ExtensionToken.active_organization_id == organization_id
    ).values(active_organization_id=None))
    write_audit(db, actor, "member.removed", "member", membership.id, target.email, organization_id, before=before, request=request)
    db.commit(); db.refresh(target)
    return user_out(db, target)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    target = get_user_or_404(db, user_id)
    if target.id == actor.id:
        raise HTTPException(status_code=400, detail="cannot delete your own account")
    ensure_admin_remains(db, target, next_active=False)
    revoke_credentials(db, target.id)
    target.is_active = False
    target.deleted_at = utcnow()
    write_audit(db, actor, "user.deleted", "user", target.id, target.email, before={"is_active": True}, after={"deleted": True}, request=request)
    db.commit()


def resource_usage_map(db: Session, demo_ids: list[str]) -> dict[str, dict]:
    result = {demo_id: {"steps": 0, "views": 0, "viewers": 0, "storage": 0} for demo_id in demo_ids}
    if not demo_ids:
        return result
    for demo_id, count in db.execute(select(Step.demo_id, func.count(Step.id)).where(
        Step.demo_id.in_(demo_ids)
    ).group_by(Step.demo_id)):
        result[demo_id]["steps"] = count or 0
    for demo_id, views, viewers in db.execute(select(
        AnalyticsEvent.demo_id,
        func.count(distinct(AnalyticsEvent.session_id)),
        func.count(distinct(AnalyticsEvent.visitor_id)),
    ).where(AnalyticsEvent.demo_id.in_(demo_ids)).group_by(AnalyticsEvent.demo_id)):
        result[demo_id]["views"] = views or 0
        result[demo_id]["viewers"] = viewers or 0
    keys: dict[str, set[str]] = {demo_id: set() for demo_id in demo_ids}
    for demo_id, asset_key, snapshot_key in db.execute(select(
        Step.demo_id, Step.asset_key, Step.dom_snapshot_key
    ).where(Step.demo_id.in_(demo_ids))):
        if asset_key:
            keys[demo_id].add(asset_key)
        if snapshot_key:
            keys[demo_id].add(snapshot_key)
    for demo_id, result_key in db.execute(select(ExportJob.demo_id, ExportJob.result_key).where(
        ExportJob.demo_id.in_(demo_ids), ExportJob.result_key.is_not(None)
    )):
        if result_key:
            keys[demo_id].add(result_key)
    for demo_id, values in keys.items():
        result[demo_id]["storage"] = sum(storage.size(key) for key in values)
    return result


def resource_out(demo: Demo, owner: User, usage: dict) -> AdminResourceOut:
    first_step = min(demo.steps, key=lambda item: item.position, default=None)
    return AdminResourceOut(
        id=demo.id,
        title=demo.title,
        description=demo.description,
        status=demo.status.value,
        content_locale=demo.content_locale,
        owner=AdminResourceOwner(id=owner.id, name=owner.name or "", email=owner.email),
        step_count=usage["steps"],
        views=usage["views"],
        unique_viewers=usage["viewers"],
        storage_bytes=usage["storage"],
        thumbnail_url=(
            f"{settings.public_base_url}/api/admin/resources/{demo.id}/steps/{first_step.id}/image"
            if first_step else None
        ),
        created_at=demo.created_at,
        updated_at=demo.updated_at,
    )


def get_resource_or_404(db: Session, demo_id: str) -> tuple[Demo, User]:
    row = db.execute(select(Demo, User).join(User, User.id == Demo.owner_id).where(
        Demo.id == demo_id, Demo.deleted_at.is_(None)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="resource not found")
    return row[0], row[1]


@router.get("/resources", response_model=AdminResourcePage)
def list_resources(
    query: str = Query(default="", max_length=200),
    owner_id: str | None = None,
    resource_status: str | None = Query(default=None, alias="status", pattern="^(draft|published)$"),
    content_locale: str | None = Query(default=None, pattern="^(zh-CN|en)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(admin_user),
):
    filters = [Demo.deleted_at.is_(None)]
    if query.strip():
        value = f"%{query.strip().lower()}%"
        filters.append(or_(
            func.lower(Demo.title).like(value),
            func.lower(User.name).like(value),
            func.lower(User.email).like(value),
        ))
    if owner_id:
        filters.append(Demo.owner_id == owner_id)
    if resource_status:
        filters.append(Demo.status == resource_status)
    if content_locale:
        filters.append(Demo.content_locale == content_locale)
    total = db.scalar(select(func.count(Demo.id)).join(User, User.id == Demo.owner_id).where(*filters)) or 0
    rows = db.execute(select(Demo, User).join(User, User.id == Demo.owner_id).where(*filters).order_by(
        Demo.updated_at.desc()
    ).offset((page - 1) * page_size).limit(page_size)).all()
    usage = resource_usage_map(db, [demo.id for demo, _owner in rows])
    return AdminResourcePage(
        items=[resource_out(demo, owner, usage[demo.id]) for demo, owner in rows],
        total=total, page=page, page_size=page_size,
    )


@router.get("/resources/{demo_id}", response_model=AdminResourceDetail)
def get_resource(demo_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    demo, owner = get_resource_or_404(db, demo_id)
    usage = resource_usage_map(db, [demo.id])[demo.id]
    detail = demo_out(db, demo)
    for step in detail.steps:
        step.image_url = f"{settings.public_base_url}/api/admin/resources/{demo.id}/steps/{step.id}/image"
        step.snapshot_url = (
            f"{settings.public_base_url}/api/admin/resources/{demo.id}/steps/{step.id}/snapshot"
            if step.snapshot_url else None
        )
    detail.thumbnail_url = (
        f"{settings.public_base_url}/api/admin/resources/{demo.id}/steps/{detail.steps[0].id}/image"
        if detail.steps else None
    )
    return AdminResourceDetail(**resource_out(demo, owner, usage).model_dump(), demo=detail)


@router.get("/resources/{demo_id}/steps/{step_id}/image")
def resource_image(
    demo_id: str, step_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    demo, _owner = get_resource_or_404(db, demo_id)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step or not storage.exists(step.asset_key):
        raise HTTPException(status_code=404, detail="asset not found")
    return StreamingResponse(io.BytesIO(storage.read(step.asset_key)), media_type="image/webp")


@router.get("/resources/{demo_id}/steps/{step_id}/snapshot")
def resource_snapshot(
    demo_id: str, step_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    demo, _owner = get_resource_or_404(db, demo_id)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step or not step.dom_snapshot_key or not storage.exists(step.dom_snapshot_key):
        raise HTTPException(status_code=404, detail="DOM snapshot not found")
    version = step.dom_snapshot_key.rsplit("/", 1)[-1].split(".", 1)[0]
    return Response(
        content=storage.read(step.dom_snapshot_key), media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "private, max-age=300", "ETag": f'"{version}"'},
    )


@router.delete("/resources/{demo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(demo_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    demo, _owner = get_resource_or_404(db, demo_id)
    demo.deleted_at = utcnow()
    demo.deleted_by_id = actor.id
    db.execute(update(ShareToken).where(ShareToken.demo_id == demo.id).values(revoked=True))
    write_audit(db, actor, "resource.deleted", "resource", demo.id, demo.title, demo.organization_id, request=request)
    db.commit()


@router.get("/organizations", response_model=list[AdminOrganizationOut])
def admin_organizations(
    include_personal: bool = False,
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    statement = select(Organization).where(Organization.status == "active")
    if not include_personal:
        statement = statement.where(Organization.kind == "team")
    organizations = db.scalars(statement.order_by(Organization.created_at.desc())).all()
    result = []
    for organization in organizations:
        demo_ids = list(db.scalars(select(Demo.id).where(
            Demo.organization_id == organization.id, Demo.deleted_at.is_(None)
        )).all())
        creator = db.get(User, organization.created_by_id)
        owner_row = db.execute(select(OrganizationMember, User).join(
            User, User.id == OrganizationMember.user_id
        ).where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.role == "owner", User.deleted_at.is_(None),
        ).order_by(OrganizationMember.created_at)).first()
        owner = owner_row[1] if owner_row else None
        usage = resource_usage_map(db, demo_ids)
        result.append(AdminOrganizationOut(
            id=organization.id, name=organization.name, slug=organization.slug,
            kind=organization.kind, status=organization.status,
            owner_name=owner.name if owner else "", owner_email=owner.email if owner else "",
            member_count=db.scalar(select(func.count(OrganizationMember.id)).where(
                OrganizationMember.organization_id == organization.id
            )) or 0,
            demo_count=len(demo_ids), storage_bytes=sum(item["storage"] for item in usage.values()),
            created_by_email=creator.email if creator else "", created_at=organization.created_at,
            archived_at=organization.archived_at,
        ))
    return result


@router.get("/audit-logs", response_model=AuditLogPage)
def audit_logs(
    query: str = Query(default="", max_length=200), action: str = Query(default="", max_length=80),
    target_type: str = Query(default="", max_length=40), organization_id: str = Query(default="", max_length=36),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    filters = []
    if query.strip(): filters.append(func.lower(AuditLog.target_label).like(f"%{query.strip().lower()}%"))
    if action: filters.append(AuditLog.action == action)
    if target_type: filters.append(AuditLog.target_type == target_type)
    if organization_id: filters.append(AuditLog.organization_id == organization_id)
    total = db.scalar(select(func.count(AuditLog.id)).where(*filters)) or 0
    logs = db.scalars(select(AuditLog).where(*filters).order_by(AuditLog.created_at.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size)).all()
    items = []
    for log in logs:
        actor = db.get(User, log.actor_id) if log.actor_id else None
        organization = db.get(Organization, log.organization_id) if log.organization_id else None
        items.append(AuditLogOut(
            id=log.id, actor_id=log.actor_id, actor_name=actor.name if actor else "",
            actor_email=actor.email if actor else "", organization_id=log.organization_id,
            organization_name=organization.name if organization else "", action=log.action,
            target_type=log.target_type, target_id=log.target_id, target_label=log.target_label,
            before=log.before or {}, after=log.after or {}, ip_address=log.ip_address, created_at=log.created_at,
        ))
    return AuditLogPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/recycle-bin", response_model=list[RecycleItemOut])
def recycle_bin(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    items = []
    users = db.scalars(select(User).where(User.deleted_at.is_not(None)).order_by(User.deleted_at.desc())).all()
    for user in users:
        items.append(RecycleItemOut(
            id=user.id, item_type="user", title=user.name or user.email, owner_email=user.email,
            deleted_at=user.deleted_at, expires_at=user.deleted_at + timedelta(days=30),
        ))
    rows = db.execute(select(Demo, User).join(User, User.id == Demo.owner_id).where(
        Demo.deleted_at.is_not(None)
    ).order_by(Demo.deleted_at.desc())).all()
    for demo, owner in rows:
        deleted_by = db.get(User, demo.deleted_by_id) if demo.deleted_by_id else None
        items.append(RecycleItemOut(
            id=demo.id, item_type="resource", title=demo.title, owner_email=owner.email,
            deleted_at=demo.deleted_at, deleted_by_name=(deleted_by.name or deleted_by.email) if deleted_by else "",
            expires_at=demo.deleted_at + timedelta(days=30),
        ))
    organizations = db.scalars(select(Organization).where(
        Organization.kind == "team", Organization.status == "archived"
    ).order_by(Organization.archived_at.desc())).all()
    for organization in organizations:
        owner = db.execute(select(User).join(
            OrganizationMember, OrganizationMember.user_id == User.id
        ).where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.role == "owner",
        ).order_by(OrganizationMember.created_at)).scalar()
        items.append(RecycleItemOut(
            id=organization.id, item_type="team_space", title=organization.name,
            owner_email=owner.email if owner else "", deleted_at=organization.archived_at,
            expires_at=organization.scheduled_purge_at or organization.archived_at + timedelta(days=30),
        ))
    return sorted(items, key=lambda item: item.deleted_at, reverse=True)


@router.post("/recycle-bin/users/{user_id}/restore", response_model=AdminUserOut)
def restore_user(user_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    target = db.get(User, user_id)
    if not target or not target.deleted_at:
        raise HTTPException(status_code=404, detail="user not found")
    target.deleted_at = None; target.is_active = True
    write_audit(db, actor, "user.restored", "user", target.id, target.email, request=request)
    db.commit(); db.refresh(target)
    return user_out(db, target)


@router.post("/recycle-bin/resources/{demo_id}/restore", response_model=AdminResourceDetail)
def restore_resource(demo_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    row = db.execute(select(Demo, User).join(User, User.id == Demo.owner_id).where(Demo.id == demo_id)).first()
    if not row or not row[0].deleted_at:
        raise HTTPException(status_code=404, detail="resource not found")
    demo, owner = row
    demo.deleted_at = None; demo.deleted_by_id = None; demo.status = DemoStatus.draft
    write_audit(db, actor, "resource.restored", "resource", demo.id, demo.title, demo.organization_id, request=request)
    db.commit(); db.refresh(demo)
    usage = resource_usage_map(db, [demo.id])[demo.id]
    detail = demo_out(db, demo)
    for step in detail.steps:
        step.image_url = f"{settings.public_base_url}/api/admin/resources/{demo.id}/steps/{step.id}/image"
        step.snapshot_url = f"{settings.public_base_url}/api/admin/resources/{demo.id}/steps/{step.id}/snapshot" if step.snapshot_url else None
    return AdminResourceDetail(**resource_out(demo, owner, usage).model_dump(), demo=detail)


@router.post("/recycle-bin/team-spaces/{organization_id}/restore", status_code=204)
def restore_team_space(
    organization_id: str, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(admin_user),
):
    organization = db.get(Organization, organization_id)
    if not organization or organization.kind != "team" or organization.status != "archived":
        raise HTTPException(status_code=404, detail="organization not found")
    organization.status = "active"
    organization.archived_at = None
    organization.archived_by_id = None
    organization.scheduled_purge_at = None
    write_audit(db, actor, "organization.restored", "organization", organization.id, organization.name, organization.id, before={"status": "archived"}, after={"status": "active"}, request=request)
    db.commit()


def purge_demo(db: Session, demo: Demo) -> set[str]:
    asset_keys = {key for step in demo.steps for key in (step.asset_key, step.dom_snapshot_key) if key}
    asset_keys.update(key for key in db.scalars(select(ExportJob.result_key).where(
        ExportJob.demo_id == demo.id, ExportJob.result_key.is_not(None)
    )).all() if key)
    db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.demo_id == demo.id))
    db.execute(delete(StepComment).where(StepComment.demo_id == demo.id))
    db.execute(delete(ExportJob).where(ExportJob.demo_id == demo.id))
    db.execute(delete(AIJob).where(AIJob.demo_id == demo.id))
    db.execute(delete(ShareToken).where(ShareToken.demo_id == demo.id))
    db.execute(delete(PublishedRevision).where(PublishedRevision.demo_id == demo.id))
    db.execute(delete(demo_tags).where(demo_tags.c.demo_id == demo.id))
    db.delete(demo)
    return asset_keys


@router.delete("/recycle-bin/team-spaces/{organization_id}", status_code=204)
def permanently_delete_team_space(
    organization_id: str, request: Request,
    db: Session = Depends(get_db), actor: User = Depends(admin_user),
):
    organization = db.get(Organization, organization_id)
    if not organization or organization.kind != "team" or organization.status != "archived":
        raise HTTPException(status_code=404, detail="organization not found")
    keys: set[str] = set()
    for demo in db.scalars(select(Demo).where(Demo.organization_id == organization.id)).all():
        keys.update(purge_demo(db, demo))
    label = organization.name
    db.execute(update(User).where(User.current_organization_id == organization.id).values(current_organization_id=None))
    db.execute(update(UserSession).where(UserSession.active_organization_id == organization.id).values(active_organization_id=None))
    db.execute(update(ExtensionToken).where(ExtensionToken.active_organization_id == organization.id).values(active_organization_id=None))
    db.execute(delete(OrganizationInvitation).where(OrganizationInvitation.organization_id == organization.id))
    db.execute(delete(Category).where(Category.organization_id == organization.id))
    db.execute(delete(Tag).where(Tag.organization_id == organization.id))
    db.execute(delete(OrganizationMember).where(OrganizationMember.organization_id == organization.id))
    write_audit(db, actor, "organization.purged", "organization", organization.id, label, organization.id, before={"status": "archived"}, after={"purged": True}, request=request)
    db.delete(organization)
    db.commit()
    for key in keys:
        still_used = db.scalar(select(Step.id).where(or_(Step.asset_key == key, Step.dom_snapshot_key == key)).limit(1)) or db.scalar(select(ExportJob.id).where(ExportJob.result_key == key).limit(1))
        if not still_used:
            storage.delete(key)


@router.delete("/recycle-bin/resources/{demo_id}", status_code=204)
def permanently_delete_resource(demo_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    demo = db.get(Demo, demo_id)
    if not demo or not demo.deleted_at:
        raise HTTPException(status_code=404, detail="resource not found")
    label, organization_id = demo.title, demo.organization_id
    keys = purge_demo(db, demo)
    write_audit(db, actor, "resource.purged", "resource", demo_id, label, organization_id, request=request)
    db.commit()
    for key in keys:
        still_used = db.scalar(select(Step.id).where(or_(Step.asset_key == key, Step.dom_snapshot_key == key)).limit(1)) or db.scalar(select(ExportJob.id).where(ExportJob.result_key == key).limit(1))
        if not still_used: storage.delete(key)


@router.delete("/recycle-bin/users/{user_id}", status_code=204)
def permanently_delete_user(user_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    target = db.get(User, user_id)
    if not target or not target.deleted_at:
        raise HTTPException(status_code=404, detail="user not found")
    keys: set[str] = set()
    memberships = db.scalars(select(OrganizationMember).where(OrganizationMember.user_id == target.id)).all()
    for membership in memberships:
        organization = db.get(Organization, membership.organization_id)
        successor = db.scalar(select(OrganizationMember).where(
            OrganizationMember.organization_id == membership.organization_id,
            OrganizationMember.user_id != target.id,
        ).order_by(case((OrganizationMember.role == "owner", 0), (OrganizationMember.role == "admin", 1), else_=2)))
        if successor:
            for model in (Demo, Category, Tag, ExportJob, AIJob):
                db.execute(update(model).where(model.owner_id == target.id).values(owner_id=successor.user_id))
            if organization and organization.created_by_id == target.id:
                organization.created_by_id = successor.user_id
            db.delete(membership)
        elif organization:
            demos = db.scalars(select(Demo).where(Demo.organization_id == organization.id)).all()
            for demo in demos:
                keys.update(purge_demo(db, demo))
            db.execute(delete(OrganizationInvitation).where(OrganizationInvitation.organization_id == organization.id))
            db.execute(delete(Category).where(Category.organization_id == organization.id))
            db.execute(delete(Tag).where(Tag.organization_id == organization.id))
            db.delete(membership); db.delete(organization)
    revoke_credentials(db, target.id)
    write_audit(db, actor, "user.purged", "user", target.id, target.email, request=request)
    # Flush organization deletions first: personal spaces reference the user as
    # both creator and personal owner, while the user points back to the space.
    # An explicit flush avoids relying on ORM ordering for this FK cycle.
    db.flush()
    db.delete(target); db.commit()
    for key in keys:
        still_used = db.scalar(select(Step.id).where(or_(Step.asset_key == key, Step.dom_snapshot_key == key)).limit(1)) or db.scalar(select(ExportJob.id).where(ExportJob.result_key == key).limit(1))
        if not still_used:
            storage.delete(key)
