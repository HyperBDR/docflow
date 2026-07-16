import io
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import case, delete, distinct, func, or_, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import admin_user
from app.models import (
    AnalyticsEvent,
    AIJob,
    AIModelConfig,
    AIPlatformSettings,
    AIUsageRecord,
    AuditLog,
    Category,
    Demo,
    DemoStatus,
    ExportJob,
    JobStatus,
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
    StorageConfig,
    Tag,
    User,
    demo_tags,
)
from app.schemas import (
    AdminOverview,
    AdminJobDetail,
    AdminJobItem,
    AdminJobPage,
    OverviewTrendPoint,
    OverviewFailedJob,
    OverviewExportJob,
    OverviewResourceTraffic,
    MetricPoint,
    AIModelConfigInput,
    AIModelConfigOut,
    AIModelConfigUpdate,
    AIUsagePoint,
    AIUsageRecordOut,
    AIUsageRecordPage,
    AIUsageSummary,
    AIPlatformSettingsOut,
    AIPlatformSettingsUpdate,
    StorageConfigInput,
    StorageConfigOut,
    StorageConfigUpdate,
    StorageObjectOut,
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
from app.ai_models import platform_settings, set_default
from app.secrets import encrypt_secret
from app.storage import storage, target_from_model
from app.worker import celery

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
    demos = db.scalars(select(Demo).where(Demo.deleted_at.is_(None))).all()
    organizations = db.scalars(select(Organization).where(Organization.status == "active")).all()
    analytics = db.scalars(select(AnalyticsEvent)).all()
    usage = db.scalars(select(AIUsageRecord)).all()
    exports = db.scalars(select(ExportJob)).all()
    ai_jobs = db.scalars(select(AIJob)).all()
    users_by_id = {item.id: item for item in users}
    demos_by_id = {item.id: item for item in demos}
    start = utcnow().date() - timedelta(days=29)
    trend = []
    for offset in range(30):
        day = start + timedelta(days=offset)
        day_analytics = [item for item in analytics if item.created_at.date() == day]
        trend.append(OverviewTrendPoint(
            date=day.isoformat(),
            users=sum(1 for item in users if item.created_at.date() == day),
            demos=sum(1 for item in demos if item.created_at.date() == day),
            views=len({item.session_id for item in day_analytics}),
            ai_tokens=sum(item.total_tokens for item in usage if item.created_at.date() == day),
        ))
    organization_points = []
    for organization in organizations:
        organization_demos = [item for item in demos if item.organization_id == organization.id]
        demo_ids = {item.id for item in organization_demos}
        organization_points.append(MetricPoint(
            key=organization.id, label=organization.name, value=len(organization_demos),
            secondary=len({item.session_id for item in analytics if item.demo_id in demo_ids}),
        ))
    recent_exports = []
    for item in sorted(exports, key=lambda value: value.created_at, reverse=True)[:6]:
        demo = demos_by_id.get(item.demo_id)
        user = users_by_id.get(item.owner_id)
        recent_exports.append(OverviewExportJob(
            id=item.id, kind=item.kind, status=item.status.value, progress=item.progress,
            resource_id=item.demo_id, resource_title=demo.title if demo else "",
            user_name=user.name if user else "", user_email=user.email if user else "",
            created_at=item.created_at,
        ))
    failed_jobs = []
    for item in exports:
        if item.status.value != "failed":
            continue
        demo = demos_by_id.get(item.demo_id)
        user = users_by_id.get(item.owner_id)
        failed_jobs.append(OverviewFailedJob(
            id=item.id, job_type="export", kind=item.kind, resource_id=item.demo_id,
            resource_title=demo.title if demo else "", user_name=user.name if user else "",
            user_email=user.email if user else "", error=item.error or item.error_code or "",
            created_at=item.created_at,
        ))
    for item in ai_jobs:
        if item.status.value != "failed":
            continue
        demo = demos_by_id.get(item.demo_id)
        user = users_by_id.get(item.owner_id)
        failed_jobs.append(OverviewFailedJob(
            id=item.id, job_type="ai", kind="ai", resource_id=item.demo_id,
            resource_title=demo.title if demo else "", user_name=user.name if user else "",
            user_email=user.email if user else "", error=item.error or item.error_code or "",
            created_at=item.created_at,
        ))
    failed_jobs.sort(key=lambda value: value.created_at, reverse=True)
    top_resources = []
    for demo in demos:
        events = [item for item in analytics if item.demo_id == demo.id]
        if not events:
            continue
        user = users_by_id.get(demo.owner_id)
        top_resources.append(OverviewResourceTraffic(
            id=demo.id, title=demo.title, owner_name=user.name if user else "",
            owner_email=user.email if user else "",
            views=len({item.session_id for item in events}),
            unique_viewers=len({item.visitor_id for item in events}),
            last_viewed_at=max(item.created_at for item in events),
        ))
    top_resources.sort(key=lambda value: (value.views, value.unique_viewers), reverse=True)
    return AdminOverview(
        users=len(users),
        active_users=sum(1 for user in users if user.is_active),
        admins=sum(1 for user in users if user.role == "admin"),
        organizations=len(organizations), demos=len(demos),
        draft_demos=sum(1 for item in demos if item.status == DemoStatus.draft),
        published_demos=sum(1 for item in demos if item.status == DemoStatus.published),
        steps=db.scalar(select(func.count(Step.id)).join(Demo, Demo.id == Step.demo_id).where(Demo.deleted_at.is_(None))) or 0,
        views=sum(item.views for item in stats),
        unique_viewers=len({item.visitor_id for item in analytics}), exports=len(exports),
        ai_requests=len(usage), ai_tokens=sum(item.total_tokens for item in usage),
        failed_jobs=len(failed_jobs),
        storage_bytes=sum(item.storage_bytes for item in stats),
        trend=trend,
        demo_status=[
            MetricPoint(key="draft", label="Draft", value=sum(1 for item in demos if item.status == DemoStatus.draft)),
            MetricPoint(key="published", label="Published", value=sum(1 for item in demos if item.status == DemoStatus.published)),
        ],
        content_locales=[MetricPoint(key=locale, label=locale, value=sum(1 for item in demos if item.content_locale == locale)) for locale in sorted({item.content_locale for item in demos})],
        top_organizations=sorted(organization_points, key=lambda item: (item.value, item.secondary), reverse=True)[:8],
        recent_failed_jobs=failed_jobs[:6], recent_exports=recent_exports,
        top_resources=top_resources[:6],
    )


def _job_status(value: JobStatus | str) -> str:
    return value.value if isinstance(value, JobStatus) else str(value)


def _job_duration_ms(job: AIJob | ExportJob) -> int | None:
    start = job.started_at or job.created_at
    end = job.completed_at or job.cancelled_at
    if not end and job.status == JobStatus.running:
        end = utcnow()
    if not start or not end:
        return None
    if start.tzinfo is None and end.tzinfo is not None:
        end = end.replace(tzinfo=None)
    elif start.tzinfo is not None and end.tzinfo is None:
        end = end.replace(tzinfo=start.tzinfo)
    return max(0, int((end - start).total_seconds() * 1000))


def _admin_job_item(db: Session, job_type: str, job: AIJob | ExportJob) -> AdminJobItem:
    demo = db.get(Demo, job.demo_id)
    owner = db.get(User, job.owner_id)
    organization = db.get(Organization, demo.organization_id) if demo and demo.organization_id else None
    status_value = _job_status(job.status)
    is_export = job_type == "export"
    download_url = (
        f"/api/admin/jobs/export/{job.id}/download"
        if is_export and status_value == "complete" and getattr(job, "result_key", None) else None
    )
    return AdminJobItem(
        id=job.id, job_type=job_type, kind=job.kind if is_export else "ai",
        status=status_value, progress=job.progress, resource_id=job.demo_id,
        resource_title=demo.title if demo else "", organization_id=demo.organization_id if demo else None,
        organization_name=organization.name if organization else "", user_id=job.owner_id,
        user_name=owner.name if owner else "", user_email=owner.email if owner else "",
        model=getattr(job, "model", "") or "", step_id=getattr(job, "step_id", None),
        error_code=job.error_code, error=job.error, retry_of_id=job.retry_of_id,
        created_at=job.created_at, updated_at=job.updated_at, started_at=job.started_at,
        completed_at=job.completed_at, cancelled_at=job.cancelled_at,
        duration_ms=_job_duration_ms(job), download_url=download_url,
        can_retry=status_value in {"failed", "cancelled"}, can_cancel=status_value in {"queued", "running"},
    )


def _admin_job_detail(db: Session, job_type: str, job: AIJob | ExportJob) -> AdminJobDetail:
    item = _admin_job_item(db, job_type, job)
    if job_type == "ai":
        result = dict(job.result or {})
        metadata = {
            "model_config_id": job.model_config_id, "step_id": job.step_id,
            "applied_demo_fields": len((job.applied_patch or {}).get("demo", {})),
            "applied_steps": len((job.applied_patch or {}).get("steps", {})),
            "applied_hotspots": len((job.applied_patch or {}).get("hotspots", {})),
        }
    else:
        result = {}
        metadata = {
            "revision_id": job.revision_id, "result_available": bool(job.result_key),
            "result_bytes": storage.size(job.result_key) if job.result_key else 0,
        }
    return AdminJobDetail(**item.model_dump(), result=result, metadata=metadata)


def _job_statement(
    model, job_type: str, query: str, status_filter: str, user_id: str,
    organization_id: str, from_at: datetime | None, to_at: datetime | None,
    include_status: bool = True,
):
    statement = select(model).join(Demo, Demo.id == model.demo_id).join(User, User.id == model.owner_id)
    conditions = []
    if query:
        term = f"%{query.strip()}%"
        type_field = model.model if job_type == "ai" else model.kind
        conditions.append(or_(
            model.id.ilike(term), Demo.title.ilike(term), User.email.ilike(term),
            User.name.ilike(term), type_field.ilike(term),
        ))
    if include_status and status_filter:
        conditions.append(model.status == JobStatus(status_filter))
    if user_id:
        conditions.append(model.owner_id == user_id)
    if organization_id:
        conditions.append(Demo.organization_id == organization_id)
    if from_at:
        conditions.append(model.created_at >= from_at)
    if to_at:
        conditions.append(model.created_at <= to_at)
    return statement.where(*conditions)


@router.get("/jobs", response_model=AdminJobPage)
def admin_jobs(
    query: str = "", job_type: str = "", status_filter: str = Query("", alias="status"),
    user_id: str = "", organization_id: str = "", from_at: datetime | None = None,
    to_at: datetime | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    if job_type not in {"", "ai", "export"}:
        raise HTTPException(status_code=422, detail="invalid job type")
    if status_filter not in {"", *(item.value for item in JobStatus)}:
        raise HTTPException(status_code=422, detail="invalid job status")
    models = [("ai", AIJob), ("export", ExportJob)]
    if job_type:
        models = [item for item in models if item[0] == job_type]
    offset = (page - 1) * page_size
    candidates: list[tuple[str, AIJob | ExportJob]] = []
    total = 0
    summary = {item.value: 0 for item in JobStatus}
    for kind, model in models:
        statement = _job_statement(model, kind, query, status_filter, user_id, organization_id, from_at, to_at)
        total += db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
        jobs = db.scalars(statement.order_by(model.created_at.desc()).limit(offset + page_size)).all()
        candidates.extend((kind, item) for item in jobs)
        summary_statement = _job_statement(model, kind, query, "", user_id, organization_id, from_at, to_at, False)
        summary_subquery = summary_statement.subquery()
        for value, count in db.execute(select(
            summary_subquery.c.status, func.count()
        ).group_by(summary_subquery.c.status)):
            summary[_job_status(value)] = summary.get(_job_status(value), 0) + count
    candidates.sort(key=lambda item: item[1].created_at, reverse=True)
    selected = candidates[offset:offset + page_size]
    return AdminJobPage(
        items=[_admin_job_item(db, kind, job) for kind, job in selected], total=total,
        page=page, page_size=page_size, summary=summary,
    )


def _admin_job_or_404(db: Session, job_type: str, job_id: str) -> AIJob | ExportJob:
    model = AIJob if job_type == "ai" else ExportJob if job_type == "export" else None
    job = db.get(model, job_id) if model else None
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/jobs/{job_type}/{job_id}", response_model=AdminJobDetail)
def admin_job_detail(job_type: str, job_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return _admin_job_detail(db, job_type, _admin_job_or_404(db, job_type, job_id))


@router.post("/jobs/{job_type}/{job_id}/cancel", response_model=AdminJobDetail)
def cancel_admin_job(
    job_type: str, job_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user),
):
    job = _admin_job_or_404(db, job_type, job_id)
    before = _job_status(job.status)
    if before not in {"queued", "running"}:
        raise HTTPException(status_code=409, detail="only queued or running jobs can be cancelled")
    demo = db.get(Demo, job.demo_id)
    job.status = JobStatus.cancelled
    job.cancelled_at = utcnow()
    job.completed_at = job.cancelled_at
    job.cancelled_by_id = actor.id
    job.error = None
    job.error_code = "job.cancelled_by_admin"
    write_audit(
        db, actor, "job.cancelled", "job", job.id,
        f"{job_type}: {demo.title if demo else job.demo_id}", demo.organization_id if demo else None,
        before={"status": before}, after={"status": "cancelled", "job_type": job_type}, request=request,
    )
    db.commit()
    try:
        celery.control.revoke(job.id, terminate=before == "running", signal="SIGTERM")
    except Exception:
        pass
    db.refresh(job)
    return _admin_job_detail(db, job_type, job)


@router.post("/jobs/{job_type}/{job_id}/retry", response_model=AdminJobDetail, status_code=202)
def retry_admin_job(
    job_type: str, job_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user),
):
    source = _admin_job_or_404(db, job_type, job_id)
    if _job_status(source.status) not in {"failed", "cancelled"}:
        raise HTTPException(status_code=409, detail="only failed or cancelled jobs can be retried")
    demo = db.get(Demo, source.demo_id)
    owner = db.get(User, source.owner_id)
    if not demo or demo.deleted_at or not owner or owner.deleted_at:
        raise HTTPException(status_code=409, detail="job resource or owner is no longer available")
    if job_type == "ai":
        if not active_model(db, source.model_config_id):
            raise HTTPException(status_code=409, detail="configured AI model is unavailable")
        target: AIJob | ExportJob = AIJob(
            owner_id=source.owner_id, demo_id=source.demo_id, step_id=source.step_id,
            model_config_id=source.model_config_id, model=source.model, retry_of_id=source.id,
        )
        task_name = "docflow.ai_generate"
    else:
        if not db.get(PublishedRevision, source.revision_id):
            raise HTTPException(status_code=409, detail="published revision is no longer available")
        target = ExportJob(
            owner_id=source.owner_id, demo_id=source.demo_id, revision_id=source.revision_id,
            kind=source.kind, retry_of_id=source.id,
        )
        task_name = "docflow.render_export"
    db.add(target)
    db.flush()
    write_audit(
        db, actor, "job.retried", "job", target.id, f"{job_type}: {demo.title}", demo.organization_id,
        before={"source_job_id": source.id, "status": _job_status(source.status)},
        after={"new_job_id": target.id, "status": "queued", "job_type": job_type}, request=request,
    )
    db.commit()
    try:
        celery.send_task(task_name, args=[target.id], task_id=target.id)
    except Exception as exc:
        target.status = JobStatus.failed
        target.error_code = "job.dispatch_failed"
        target.error = str(exc)
        target.completed_at = utcnow()
        db.commit()
    db.refresh(target)
    return _admin_job_detail(db, job_type, target)


@router.get("/jobs/export/{job_id}/download")
def download_admin_export(job_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    job = db.get(ExportJob, job_id)
    if not job or job.status != JobStatus.complete or not job.result_key:
        raise HTTPException(status_code=404, detail="export result not found")
    suffix = {"pdf": "pdf", "mp4": "mp4", "markdown": "zip"}.get(job.kind, "bin")
    media = {"pdf": "application/pdf", "mp4": "video/mp4", "markdown": "application/zip"}.get(job.kind, "application/octet-stream")
    filename = f"DocFlow-{job.id}.{suffix}"
    direct = storage.direct_url(job.result_key, filename)
    if direct:
        return RedirectResponse(direct, status_code=307)
    return StreamingResponse(
        io.BytesIO(storage.read(job.result_key)), media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def ensure_legacy_storage(db: Session, actor: User) -> None:
    if db.scalar(select(StorageConfig.id).limit(1)):
        return
    db.add(StorageConfig(
        name="Server local storage", kind="local", local_path=str(storage.root), prefix="",
        enabled=True, is_default=True, direct_download=False, created_by_id=actor.id,
    ))
    db.commit()


def validate_storage_values(kind: str, values: dict) -> None:
    prefix = str(values.get("prefix") or "").strip("/")
    if any(part == ".." for part in prefix.split("/")):
        raise HTTPException(status_code=400, detail="storage prefix cannot contain '..'")
    values["prefix"] = prefix
    if kind == "local":
        if not str(values.get("local_path") or "").strip():
            raise HTTPException(status_code=400, detail="local path is required")
        try:
            path = storage.validate_local_root(str(values["local_path"]))
            path.mkdir(parents=True, exist_ok=True)
            values["local_path"] = str(path)
        except (OSError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif not str(values.get("bucket") or "").strip():
        raise HTTPException(status_code=400, detail="bucket is required")


def set_default_storage(db: Session, target: StorageConfig) -> None:
    db.execute(update(StorageConfig).where(StorageConfig.id != target.id).values(is_default=False))
    target.is_default = True
    target.enabled = True


def storage_out(target: StorageConfig, include_stats: bool = True) -> StorageConfigOut:
    count = total = 0
    if include_stats and target.kind == "local":
        try: count, total = storage.stats(target_from_model(target))
        except Exception: pass
    return StorageConfigOut(
        id=target.id, name=target.name, kind=target.kind, enabled=target.enabled, is_default=target.is_default,
        local_path=target.local_path or "", endpoint_url=target.endpoint_url or "", region=target.region or "",
        bucket=target.bucket or "", prefix=target.prefix or "", force_path_style=target.force_path_style,
        direct_download=target.direct_download, public_base_url=target.public_base_url or "",
        credentials_configured=bool(target.access_key_encrypted or target.secret_key_encrypted),
        object_count=count, total_bytes=total, created_at=target.created_at, updated_at=target.updated_at,
    )


@router.get("/storage/configs", response_model=list[StorageConfigOut])
def list_storage_configs(db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    ensure_legacy_storage(db, actor)
    return [storage_out(item) for item in db.scalars(select(StorageConfig).order_by(
        StorageConfig.is_default.desc(), StorageConfig.created_at
    )).all()]


@router.post("/storage/configs", response_model=StorageConfigOut, status_code=201)
def create_storage_config(payload: StorageConfigInput, request: Request,
                          db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    values = payload.model_dump(); values["name"] = values["name"].strip()
    if db.scalar(select(StorageConfig.id).where(func.lower(StorageConfig.name) == values["name"].lower())):
        raise HTTPException(status_code=409, detail="storage configuration name already exists")
    validate_storage_values(values["kind"], values)
    access_key = values.pop("access_key", None) or ""; secret_key = values.pop("secret_key", None) or ""
    target = StorageConfig(**values, access_key_encrypted=encrypt_secret(access_key),
                           secret_key_encrypted=encrypt_secret(secret_key), created_by_id=actor.id)
    db.add(target); db.flush()
    if target.is_default or not db.scalar(select(StorageConfig.id).where(StorageConfig.id != target.id, StorageConfig.is_default.is_(True))):
        set_default_storage(db, target)
    write_audit(db, actor, "storage.created", "storage", target.id, target.name,
                after={key: value for key, value in values.items() if key not in {"access_key", "secret_key"}}, request=request)
    db.commit(); db.refresh(target)
    return storage_out(target)


@router.patch("/storage/configs/{storage_id}", response_model=StorageConfigOut)
def update_storage_config(storage_id: str, payload: StorageConfigUpdate, request: Request,
                          db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    target = db.get(StorageConfig, storage_id)
    if not target: raise HTTPException(status_code=404, detail="storage configuration not found")
    values = payload.model_dump(exclude_unset=True)
    if values.get("name"):
        values["name"] = values["name"].strip()
        duplicate = db.scalar(select(StorageConfig.id).where(func.lower(StorageConfig.name) == values["name"].lower(), StorageConfig.id != target.id))
        if duplicate: raise HTTPException(status_code=409, detail="storage configuration name already exists")
    if target.is_default and values.get("is_default") is False:
        raise HTTPException(status_code=400, detail="set another storage target as default first")
    if target.is_default and values.get("enabled") is False:
        raise HTTPException(status_code=400, detail="the default storage target cannot be disabled")
    access_key = values.pop("access_key", None); secret_key = values.pop("secret_key", None)
    merged = {
        "local_path": values.get("local_path", target.local_path), "bucket": values.get("bucket", target.bucket),
        "prefix": values.get("prefix", target.prefix),
    }
    validate_storage_values(target.kind, merged)
    values.update(merged)
    before = {"name": target.name, "enabled": target.enabled, "is_default": target.is_default}
    for key, value in values.items(): setattr(target, key, value)
    if access_key: target.access_key_encrypted = encrypt_secret(access_key)
    if secret_key: target.secret_key_encrypted = encrypt_secret(secret_key)
    if values.get("is_default"): set_default_storage(db, target)
    write_audit(db, actor, "storage.updated", "storage", target.id, target.name, before=before,
                after=values, request=request)
    db.commit(); db.refresh(target)
    return storage_out(target)


def storage_reference_exists(db: Session, storage_id: str, logical_key: str | None = None) -> bool:
    prefix = storage.managed_key(storage_id, logical_key) if logical_key else f"storage://{storage_id}/%"
    comparator = (lambda column: column == prefix) if logical_key else (lambda column: column.like(prefix))
    step_conditions = [comparator(Step.asset_key), comparator(Step.dom_snapshot_key)]
    export_conditions = [comparator(ExportJob.result_key)]
    target = db.get(StorageConfig, storage_id)
    if target and target.kind == "local" and Path(target.local_path).resolve() == storage.root:
        if logical_key:
            step_conditions.extend([Step.asset_key == logical_key, Step.dom_snapshot_key == logical_key])
            export_conditions.append(ExportJob.result_key == logical_key)
        else:
            step_conditions.extend([Step.asset_key.not_like("storage://%"), Step.dom_snapshot_key.not_like("storage://%")])
            export_conditions.append(ExportJob.result_key.not_like("storage://%"))
    return bool(db.scalar(select(Step.id).where(or_(*step_conditions)).limit(1))
                or db.scalar(select(ExportJob.id).where(or_(*export_conditions)).limit(1)))


@router.delete("/storage/configs/{storage_id}", status_code=204)
def delete_storage_config(storage_id: str, request: Request,
                          db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    target = db.get(StorageConfig, storage_id)
    if not target: raise HTTPException(status_code=404, detail="storage configuration not found")
    if storage_reference_exists(db, target.id):
        raise HTTPException(status_code=409, detail="storage target is still referenced by platform data")
    try:
        count, _total = storage.stats(target_from_model(target))
        if count: raise HTTPException(status_code=409, detail="storage target is not empty")
    except HTTPException: raise
    except Exception: pass
    label, was_default = target.name, target.is_default
    db.delete(target); db.flush()
    if was_default:
        replacement = db.scalar(select(StorageConfig).where(StorageConfig.enabled.is_(True)).order_by(StorageConfig.created_at))
        if replacement: set_default_storage(db, replacement)
    write_audit(db, actor, "storage.deleted", "storage", storage_id, label, request=request)
    db.commit()


@router.post("/storage/configs/{storage_id}/test")
def test_storage_config(storage_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    target = db.get(StorageConfig, storage_id)
    if not target: raise HTTPException(status_code=404, detail="storage configuration not found")
    try: latency = storage.test_target(target_from_model(target))
    except Exception as exc: raise HTTPException(status_code=502, detail=f"storage connection failed: {str(exc)[:300]}") from exc
    return {"ok": True, "latency_ms": latency}


@router.get("/storage/configs/{storage_id}/stats")
def storage_config_stats(storage_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    target = db.get(StorageConfig, storage_id)
    if not target: raise HTTPException(status_code=404, detail="storage configuration not found")
    try: count, total = storage.stats(target_from_model(target))
    except Exception as exc: raise HTTPException(status_code=502, detail=f"could not calculate storage usage: {str(exc)[:300]}") from exc
    return {"object_count": count, "total_bytes": total}


@router.get("/storage/configs/{storage_id}/objects", response_model=list[StorageObjectOut])
def browse_storage_objects(storage_id: str, prefix: str = Query(default="", max_length=1000),
                           db: Session = Depends(get_db), _: User = Depends(admin_user)):
    target = db.get(StorageConfig, storage_id)
    if not target: raise HTTPException(status_code=404, detail="storage configuration not found")
    if any(part == ".." for part in prefix.split("/")): raise HTTPException(status_code=400, detail="invalid prefix")
    try: return storage.browse(target_from_model(target), prefix)
    except Exception as exc: raise HTTPException(status_code=502, detail=f"could not browse storage: {str(exc)[:300]}") from exc


@router.get("/storage/configs/{storage_id}/objects/download")
def download_storage_object(storage_id: str, key: str = Query(max_length=1500),
                            db: Session = Depends(get_db), _: User = Depends(admin_user)):
    target = db.get(StorageConfig, storage_id)
    if not target: raise HTTPException(status_code=404, detail="storage configuration not found")
    managed = storage.managed_key(storage_id, key)
    if not storage.exists(managed): raise HTTPException(status_code=404, detail="object not found")
    direct = storage.direct_url(managed, key.rsplit("/", 1)[-1])
    if direct: return RedirectResponse(direct, status_code=307)
    return StreamingResponse(io.BytesIO(storage.read(managed)), media_type="application/octet-stream",
                             headers={"Content-Disposition": f'attachment; filename="{key.rsplit("/", 1)[-1]}"'})


@router.delete("/storage/configs/{storage_id}/objects", status_code=204)
def delete_storage_object(storage_id: str, key: str = Query(max_length=1500),
                          db: Session = Depends(get_db), _: User = Depends(admin_user)):
    if not db.get(StorageConfig, storage_id): raise HTTPException(status_code=404, detail="storage configuration not found")
    if storage_reference_exists(db, storage_id, key):
        raise HTTPException(status_code=409, detail="object is referenced by platform data")
    storage.delete(storage.managed_key(storage_id, key))


def ai_model_out(model: AIModelConfig) -> AIModelConfigOut:
    return AIModelConfigOut(
        id=model.id, name=model.name, provider=model.provider, base_url=model.base_url, model=model.model,
        enabled=model.enabled, is_default=model.is_default, vision_enabled=model.vision_enabled,
        timeout_seconds=model.timeout_seconds, temperature=model.temperature,
        extra_options=model.extra_options or {}, api_key_configured=bool(model.api_key_encrypted),
        created_at=model.created_at, updated_at=model.updated_at,
    )


def ai_settings_out(db: Session, value: AIPlatformSettings) -> AIPlatformSettingsOut:
    configured = db.scalar(select(func.count(AIModelConfig.id))) or 0
    enabled = db.scalar(select(func.count(AIModelConfig.id)).where(AIModelConfig.enabled.is_(True))) or 0
    return AIPlatformSettingsOut(
        enabled=value.enabled, chunk_size=value.chunk_size, configured_models=configured,
        enabled_models=enabled, effective=value.enabled and enabled > 0, updated_at=value.updated_at,
    )


@router.get("/ai/settings", response_model=AIPlatformSettingsOut)
def get_ai_settings(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return ai_settings_out(db, platform_settings(db))


@router.patch("/ai/settings", response_model=AIPlatformSettingsOut)
def update_ai_settings(payload: AIPlatformSettingsUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    value = platform_settings(db)
    before = {"enabled": value.enabled, "chunk_size": value.chunk_size}
    value.enabled = payload.enabled
    value.chunk_size = payload.chunk_size
    value.updated_by_id = actor.id
    write_audit(db, actor, "ai_settings.updated", "ai_settings", value.id, "Global AI settings",
                before=before, after=payload.model_dump(), request=request, source="admin")
    db.commit(); db.refresh(value)
    return ai_settings_out(db, value)


@router.get("/ai/models", response_model=list[AIModelConfigOut])
def list_ai_models(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return [ai_model_out(item) for item in db.scalars(select(AIModelConfig).order_by(
        AIModelConfig.is_default.desc(), AIModelConfig.created_at.desc()
    )).all()]


@router.post("/ai/models", response_model=AIModelConfigOut, status_code=201)
def create_ai_model(payload: AIModelConfigInput, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    if db.scalar(select(AIModelConfig.id).where(func.lower(AIModelConfig.name) == payload.name.strip().lower())):
        raise HTTPException(status_code=409, detail="model configuration name already exists")
    values = payload.model_dump()
    values["name"] = values["name"].strip(); values["base_url"] = values["base_url"].rstrip("/")
    values["api_key"] = values.get("api_key") or ""
    model = AIModelConfig(**values, created_by_id=actor.id)
    db.add(model); db.flush()
    if model.is_default or not db.scalar(select(AIModelConfig.id).where(AIModelConfig.id != model.id, AIModelConfig.is_default.is_(True))):
        set_default(db, model)
    write_audit(db, actor, "ai_model.created", "ai_model", model.id, model.name,
                after={key: value for key, value in values.items() if key != "api_key"}, request=request)
    db.commit(); db.refresh(model)
    return ai_model_out(model)


@router.patch("/ai/models/{model_id}", response_model=AIModelConfigOut)
def update_ai_model(model_id: str, payload: AIModelConfigUpdate, request: Request,
                    db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    model = db.get(AIModelConfig, model_id)
    if not model: raise HTTPException(status_code=404, detail="model configuration not found")
    values = payload.model_dump(exclude_unset=True)
    if values.get("name"):
        values["name"] = values["name"].strip()
        duplicate = db.scalar(select(AIModelConfig.id).where(func.lower(AIModelConfig.name) == values["name"].lower(), AIModelConfig.id != model.id))
        if duplicate: raise HTTPException(status_code=409, detail="model configuration name already exists")
    if values.get("base_url"): values["base_url"] = values["base_url"].rstrip("/")
    if values.get("api_key") == "": values.pop("api_key")  # Empty means retain the stored credential.
    before = {"name": model.name, "model": model.model, "enabled": model.enabled, "is_default": model.is_default}
    if model.is_default and values.get("is_default") is False:
        raise HTTPException(status_code=400, detail="set another model as default first")
    if model.is_default and values.get("enabled") is False:
        raise HTTPException(status_code=400, detail="the default model cannot be disabled")
    for key, value in values.items(): setattr(model, key, value)
    if values.get("is_default"): set_default(db, model)
    write_audit(db, actor, "ai_model.updated", "ai_model", model.id, model.name, before=before,
                after={key: value for key, value in values.items() if key != "api_key"}, request=request)
    db.commit(); db.refresh(model)
    return ai_model_out(model)


@router.delete("/ai/models/{model_id}", status_code=204)
def delete_ai_model(model_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    model = db.get(AIModelConfig, model_id)
    if not model: raise HTTPException(status_code=404, detail="model configuration not found")
    label, was_default = model.name, model.is_default
    db.delete(model); db.flush()
    if was_default:
        replacement = db.scalar(select(AIModelConfig).where(AIModelConfig.enabled.is_(True)).order_by(AIModelConfig.created_at))
        if replacement: set_default(db, replacement)
    write_audit(db, actor, "ai_model.deleted", "ai_model", model_id, label, request=request)
    db.commit()


@router.post("/ai/models/{model_id}/test")
def test_ai_model(model_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    model = db.get(AIModelConfig, model_id)
    if not model: raise HTTPException(status_code=404, detail="model configuration not found")
    try:
        headers = {"Authorization": f"Bearer {model.api_key}"} if model.api_key else {}
        with httpx.Client(timeout=min(model.timeout_seconds, 45)) as client:
            models_started = time.perf_counter()
            response = client.get(f"{model.base_url.rstrip('/')}/models", headers=headers)
            models_latency = round((time.perf_counter() - models_started) * 1000)
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"provider /models returned {response.status_code}")
            body = response.json()
            available = [str(item.get("id", "")) for item in body.get("data", []) if isinstance(item, dict)] if isinstance(body, dict) else []
            model_available = not available or model.model in available
            if not model_available:
                raise HTTPException(status_code=502, detail="configured model was not returned by /models")

            completion_started = time.perf_counter()
            completion = client.post(f"{model.base_url.rstrip('/')}/chat/completions", headers={**headers, "Content-Type": "application/json"}, json={
                "model": model.model, "temperature": 0,
                "messages": [
                    {"role": "system", "content": "Return valid JSON only."},
                    {"role": "user", "content": 'Return exactly {"ok":true}.'},
                ],
                "response_format": {"type": "json_object"},
            })
            completion_latency = round((time.perf_counter() - completion_started) * 1000)
            if completion.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"provider /chat/completions returned {completion.status_code}: {completion.text[:200]}")
            completion_body = completion.json()
            content = completion_body["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = "".join(str(item.get("text", "")) if isinstance(item, dict) else str(item) for item in content)
            parsed = json.loads(str(content).strip().removeprefix("```json").removesuffix("```").strip())
            if not isinstance(parsed, dict) or parsed.get("ok") is not True:
                raise HTTPException(status_code=502, detail="provider did not return the expected JSON object")
        return {"ok": True, "latency_ms": models_latency + completion_latency,
                "models_latency_ms": models_latency, "completion_latency_ms": completion_latency,
                "model_available": True, "json_supported": True}
    except HTTPException: raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"provider connection failed: {str(exc)[:200]}") from exc


def _usage_point(key: str, label: str, rows: list[AIUsageRecord]) -> AIUsagePoint:
    first = [row.first_token_ms for row in rows if row.first_token_ms is not None]
    return AIUsagePoint(
        key=key, label=label, requests=len(rows), input_tokens=sum(row.input_tokens for row in rows),
        output_tokens=sum(row.output_tokens for row in rows), total_tokens=sum(row.total_tokens for row in rows),
        avg_first_token_ms=round(sum(first) / len(first)) if first else None,
        avg_latency_ms=round(sum(row.latency_ms for row in rows) / len(rows)) if rows else 0,
    )


@router.get("/ai/usage/summary", response_model=AIUsageSummary)
def ai_usage_summary(
    days: int = Query(default=30, ge=1, le=365), model_id: str = "", user_id: str = "", organization_id: str = "",
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    start = utcnow() - timedelta(days=days - 1)
    filters = [AIUsageRecord.created_at >= start]
    if model_id: filters.append(AIUsageRecord.model_config_id == model_id)
    if user_id: filters.append(AIUsageRecord.user_id == user_id)
    if organization_id: filters.append(AIUsageRecord.organization_id == organization_id)
    rows = list(db.scalars(select(AIUsageRecord).where(*filters).order_by(AIUsageRecord.created_at)).all())
    users = {item.id: item for item in db.scalars(select(User).where(User.id.in_({r.user_id for r in rows if r.user_id}))).all()}
    organizations = {item.id: item for item in db.scalars(select(Organization).where(Organization.id.in_({r.organization_id for r in rows if r.organization_id}))).all()}
    models = {item.id: item for item in db.scalars(select(AIModelConfig).where(AIModelConfig.id.in_({r.model_config_id for r in rows if r.model_config_id}))).all()}
    demos = {item.id: item for item in db.scalars(select(Demo).where(Demo.id.in_({r.demo_id for r in rows if r.demo_id}))).all()}

    def grouped(field: str, labels: dict, fallback) -> list[AIUsagePoint]:
        groups: dict[str, list[AIUsageRecord]] = {}
        for row in rows:
            key = str(getattr(row, field) or "unknown"); groups.setdefault(key, []).append(row)
        return sorted((_usage_point(key, labels[key] if key in labels else fallback(group[0]), group) for key, group in groups.items()), key=lambda x: x.total_tokens, reverse=True)

    by_day: dict[str, list[AIUsageRecord]] = {}
    for row in rows: by_day.setdefault(row.created_at.date().isoformat(), []).append(row)
    trend = []
    for offset in range(days):
        key = (start.date() + timedelta(days=offset)).isoformat()
        trend.append(_usage_point(key, key, by_day.get(key, [])))
    return AIUsageSummary(
        totals=_usage_point("total", "Total", rows), trend=trend,
        by_user=grouped("user_id", {key: value.name or value.email for key, value in users.items()}, lambda _row: "Unknown user"),
        by_organization=grouped("organization_id", {key: value.name for key, value in organizations.items()}, lambda _row: "No team"),
        by_model=grouped("model_config_id", {key: value.name for key, value in models.items()}, lambda row: row.model_name or "Deleted model"),
        by_resource=grouped("demo_id", {key: value.title for key, value in demos.items()}, lambda _row: "Deleted resource"),
        by_status=grouped("status", {"success": "Success", "failed": "Failed"}, lambda row: row.status),
        by_operation=grouped("operation", {}, lambda row: row.operation),
    )


@router.get("/ai/usage/requests", response_model=AIUsageRecordPage)
def ai_usage_requests(
    query: str = Query(default="", max_length=200), model_id: str = "", user_id: str = "", organization_id: str = "",
    request_status: str = Query(default="", alias="status", pattern="^(|success|failed)$"),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    filters = []
    if query.strip():
        value = f"%{query.strip().lower()}%"
        filters.append(or_(func.lower(AIUsageRecord.request_id).like(value), func.lower(AIUsageRecord.model_name).like(value), func.lower(AIUsageRecord.operation).like(value)))
    if model_id: filters.append(AIUsageRecord.model_config_id == model_id)
    if user_id: filters.append(AIUsageRecord.user_id == user_id)
    if organization_id: filters.append(AIUsageRecord.organization_id == organization_id)
    if request_status: filters.append(AIUsageRecord.status == request_status)
    total = db.scalar(select(func.count(AIUsageRecord.id)).where(*filters)) or 0
    rows = db.scalars(select(AIUsageRecord).where(*filters).order_by(AIUsageRecord.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    result = []
    for row in rows:
        user = db.get(User, row.user_id) if row.user_id else None
        organization = db.get(Organization, row.organization_id) if row.organization_id else None
        demo = db.get(Demo, row.demo_id) if row.demo_id else None
        result.append(AIUsageRecordOut(
            id=row.id, request_id=row.request_id, model_config_id=row.model_config_id, model_name=row.model_name,
            user_id=row.user_id, user_name=user.name if user else "", user_email=user.email if user else "",
            organization_id=row.organization_id, organization_name=organization.name if organization else "",
            demo_id=row.demo_id, demo_title=demo.title if demo else "", operation=row.operation, status=row.status,
            input_tokens=row.input_tokens, output_tokens=row.output_tokens, total_tokens=row.total_tokens,
            first_token_ms=row.first_token_ms, latency_ms=row.latency_ms, request_detail=row.request_detail or {},
            response_detail=row.response_detail or {}, error=row.error, created_at=row.created_at,
        ))
    return AIUsageRecordPage(items=result, total=total, page=page, page_size=page_size)


@router.get("/users", response_model=AdminUserPage)
def list_users(
    query: str = Query(default="", max_length=200),
    role: str | None = Query(default=None, pattern="^(user|admin)$"),
    active: bool | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
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
    page_size: int = Query(default=10, ge=1, le=100),
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
    direct = storage.direct_url(step.asset_key)
    if direct: return RedirectResponse(direct, status_code=307, headers={"Cache-Control": "private, no-store"})
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
    source: str = Query(default="", max_length=30), outcome: str = Query(default="", max_length=20),
    page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    filters = []
    if query.strip(): filters.append(func.lower(AuditLog.target_label).like(f"%{query.strip().lower()}%"))
    if action: filters.append(AuditLog.action == action)
    if target_type: filters.append(AuditLog.target_type == target_type)
    if organization_id: filters.append(AuditLog.organization_id == organization_id)
    if source: filters.append(AuditLog.source == source)
    if outcome: filters.append(AuditLog.outcome == outcome)
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
            before=log.before or {}, after=log.after or {}, ip_address=log.ip_address,
            user_agent=log.user_agent or "", source=log.source or "web", outcome=log.outcome or "success",
            created_at=log.created_at,
        ))
    return AuditLogPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/recycle-bin", response_model=list[RecycleItemOut])
def recycle_bin(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    items = []
    users = db.scalars(select(User).where(User.deleted_at.is_not(None)).order_by(User.deleted_at.desc())).all()
    for user in users:
        stats = user_stats(db, user.id)
        team_count = db.scalar(select(func.count(OrganizationMember.id)).join(
            Organization, Organization.id == OrganizationMember.organization_id
        ).where(OrganizationMember.user_id == user.id, Organization.kind == "team")) or 0
        items.append(RecycleItemOut(
            id=user.id, item_type="user", title=user.name or user.email, owner_email=user.email,
            deleted_at=user.deleted_at, expires_at=user.deleted_at + timedelta(days=30),
            preview={
                "email": user.email, "role": user.role, "is_active": user.is_active,
                "ui_locale": user.ui_locale, "created_at": user.created_at.isoformat(),
                "resource_count": stats.demos, "team_count": team_count,
                "storage_bytes": stats.storage_bytes,
            },
        ))
    rows = db.execute(select(Demo, User).join(User, User.id == Demo.owner_id).where(
        Demo.deleted_at.is_not(None)
    ).order_by(Demo.deleted_at.desc())).all()
    resource_usage = resource_usage_map(db, [demo.id for demo, _owner in rows])
    for demo, owner in rows:
        deleted_by = db.get(User, demo.deleted_by_id) if demo.deleted_by_id else None
        organization = db.get(Organization, demo.organization_id) if demo.organization_id else None
        first_step = min(demo.steps, key=lambda value: value.position, default=None)
        usage = resource_usage[demo.id]
        items.append(RecycleItemOut(
            id=demo.id, item_type="resource", title=demo.title, owner_email=owner.email,
            deleted_at=demo.deleted_at, deleted_by_name=(deleted_by.name or deleted_by.email) if deleted_by else "",
            expires_at=demo.deleted_at + timedelta(days=30),
            thumbnail_url=(
                f"{settings.public_base_url}/api/admin/recycle-bin/resources/{demo.id}/thumbnail"
                if first_step else None
            ),
            preview={
                "description": demo.description, "status": demo.status.value,
                "content_locale": demo.content_locale, "step_count": usage["steps"],
                "views": usage["views"], "storage_bytes": usage["storage"],
                "organization_name": organization.name if organization else "",
                "created_at": demo.created_at.isoformat(), "updated_at": demo.updated_at.isoformat(),
            },
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
        archived_by = db.get(User, organization.archived_by_id) if organization.archived_by_id else None
        member_count = db.scalar(select(func.count(OrganizationMember.id)).where(
            OrganizationMember.organization_id == organization.id
        )) or 0
        resource_count = db.scalar(select(func.count(Demo.id)).where(
            Demo.organization_id == organization.id, Demo.deleted_at.is_(None)
        )) or 0
        items.append(RecycleItemOut(
            id=organization.id, item_type="team_space", title=organization.name,
            owner_email=owner.email if owner else "", deleted_at=organization.archived_at,
            deleted_by_name=(archived_by.name or archived_by.email) if archived_by else "",
            expires_at=organization.scheduled_purge_at or organization.archived_at + timedelta(days=30),
            preview={
                "slug": organization.slug, "owner_name": owner.name if owner else "",
                "member_count": member_count, "resource_count": resource_count,
                "created_at": organization.created_at.isoformat(),
            },
        ))
    return sorted(items, key=lambda item: item.deleted_at, reverse=True)


@router.get("/recycle-bin/resources/{demo_id}/thumbnail")
def recycle_resource_thumbnail(
    demo_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    demo = db.scalar(select(Demo).where(Demo.id == demo_id, Demo.deleted_at.is_not(None)))
    if not demo:
        raise HTTPException(status_code=404, detail="recycled resource not found")
    step = db.scalar(select(Step).where(Step.demo_id == demo.id).order_by(Step.position))
    if not step or not storage.exists(step.asset_key):
        raise HTTPException(status_code=404, detail="asset not found")
    direct = storage.direct_url(step.asset_key)
    if direct:
        return RedirectResponse(direct, status_code=307, headers={"Cache-Control": "private, no-store"})
    return StreamingResponse(
        io.BytesIO(storage.read(step.asset_key)), media_type="image/webp",
        headers={"Cache-Control": "private, no-store"},
    )


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
