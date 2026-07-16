from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AIJob,
    AIUsageRecord,
    AnalyticsEvent,
    Demo,
    DemoStatus,
    ExportJob,
    JobStatus,
    Organization,
    OrganizationMember,
    Step,
    User,
)
from app.security import utcnow
from app.storage import storage
from app.workspace_schemas import (
    WorkspaceJobItem,
    WorkspaceJobPage,
    WorkspaceOverview,
    WorkspaceResourceSummary,
    WorkspaceTrendPoint,
)


JOB_STATUSES = [item.value for item in JobStatus]


def _job_item(job: AIJob | ExportJob, demo: Demo | None, owner: User | None, viewer: User) -> WorkspaceJobItem:
    is_export = isinstance(job, ExportJob)
    return WorkspaceJobItem(
        id=job.id,
        job_type="export" if is_export else "ai",
        kind=job.kind if is_export else ("step" if job.step_id else "demo"),
        status=job.status.value,
        progress=job.progress,
        resource_id=job.demo_id,
        resource_title=demo.title if demo else "",
        owner_name=(owner.name or owner.email) if owner else "",
        error_code=job.error_code,
        created_at=job.created_at,
        updated_at=job.updated_at,
        download_url=(
            f"/api/exports/{job.id}/download"
            if is_export and job.status == JobStatus.complete and job.result_key and job.owner_id == viewer.id
            else None
        ),
    )


def list_workspace_jobs(db: Session, organization_id: str, viewer: User) -> list[WorkspaceJobItem]:
    demos = db.scalars(
        select(Demo).where(Demo.organization_id == organization_id, Demo.deleted_at.is_(None))
    ).all()
    demos_by_id = {item.id: item for item in demos}
    if not demos_by_id:
        return []

    demo_ids = list(demos_by_id)
    exports = db.scalars(select(ExportJob).where(ExportJob.demo_id.in_(demo_ids))).all()
    ai_jobs = db.scalars(select(AIJob).where(AIJob.demo_id.in_(demo_ids))).all()
    all_jobs = [*exports, *ai_jobs]
    owner_ids = {item.owner_id for item in all_jobs}
    owners = db.scalars(select(User).where(User.id.in_(owner_ids))).all() if owner_ids else []
    owners_by_id = {item.id: item for item in owners}
    items = [
        _job_item(item, demos_by_id.get(item.demo_id), owners_by_id.get(item.owner_id), viewer)
        for item in all_jobs
    ]
    return sorted(items, key=lambda item: item.created_at, reverse=True)


def get_workspace_jobs(
    db: Session,
    organization_id: str,
    viewer: User,
    *,
    status: str = "",
    job_type: str = "",
    page: int = 1,
    page_size: int = 20,
) -> WorkspaceJobPage:
    items = list_workspace_jobs(db, organization_id, viewer)
    summary = {value: sum(1 for item in items if item.status == value) for value in JOB_STATUSES}
    filtered = [
        item for item in items
        if (not status or item.status == status) and (not job_type or item.job_type == job_type)
    ]
    offset = (page - 1) * page_size
    return WorkspaceJobPage(
        items=filtered[offset:offset + page_size],
        total=len(filtered),
        page=page,
        page_size=page_size,
        summary=summary,
    )


def _storage_bytes(keys: set[str]) -> int:
    total = 0
    for key in keys:
        try:
            total += storage.size(key)
        except (FileNotFoundError, OSError):
            # A stale object reference must not make the whole overview unavailable.
            continue
    return total


def get_workspace_overview(db: Session, organization_id: str, viewer: User) -> WorkspaceOverview:
    organization = db.get(Organization, organization_id)
    demos = db.scalars(
        select(Demo).where(Demo.organization_id == organization_id, Demo.deleted_at.is_(None))
    ).all()
    demo_ids = [item.id for item in demos]
    steps = db.scalars(select(Step).where(Step.demo_id.in_(demo_ids))).all() if demo_ids else []
    analytics = db.scalars(
        select(AnalyticsEvent).where(AnalyticsEvent.demo_id.in_(demo_ids))
    ).all() if demo_ids else []
    usage = db.scalars(
        select(AIUsageRecord).where(AIUsageRecord.organization_id == organization_id)
    ).all()
    jobs = list_workspace_jobs(db, organization_id, viewer)

    keys = {key for step in steps for key in (step.asset_key, step.dom_snapshot_key) if key}
    if demo_ids:
        result_keys = db.scalars(
            select(ExportJob.result_key).where(
                ExportJob.demo_id.in_(demo_ids), ExportJob.result_key.is_not(None)
            )
        ).all()
        keys.update(key for key in result_keys if key)

    view_sessions: dict[str, set[str]] = {}
    for event in analytics:
        view_sessions.setdefault(event.demo_id, set()).add(event.session_id)
    step_count: dict[str, int] = {}
    for step in steps:
        step_count[step.demo_id] = step_count.get(step.demo_id, 0) + 1

    start = utcnow().date() - timedelta(days=29)
    trend = [
        WorkspaceTrendPoint(
            date=day.isoformat(),
            resources=sum(item.created_at.date() == day for item in demos),
            views=len({item.session_id for item in analytics if item.created_at.date() == day}),
            ai_tokens=sum(item.total_tokens for item in usage if item.created_at.date() == day),
            jobs=sum(item.created_at.date() == day for item in jobs),
        )
        for day in (start + timedelta(days=offset) for offset in range(30))
    ]
    summary = {status: sum(item.status == status for item in jobs) for status in JOB_STATUSES}
    recent_resources = [
        WorkspaceResourceSummary(
            id=item.id,
            title=item.title,
            status=item.status.value,
            step_count=step_count.get(item.id, 0),
            views=len(view_sessions.get(item.id, set())),
            updated_at=item.updated_at,
        )
        for item in sorted(demos, key=lambda item: item.updated_at, reverse=True)[:6]
    ]
    return WorkspaceOverview(
        organization_id=organization_id,
        organization_name=organization.name if organization else "",
        organization_kind=organization.kind if organization else "personal",
        member_count=db.scalar(
            select(func.count(OrganizationMember.id)).where(
                OrganizationMember.organization_id == organization_id
            )
        ) or 0,
        resources=len(demos),
        draft_resources=sum(item.status == DemoStatus.draft for item in demos),
        published_resources=sum(item.status == DemoStatus.published for item in demos),
        steps=len(steps),
        storage_bytes=_storage_bytes(keys),
        views=len({item.session_id for item in analytics}),
        unique_viewers=len({item.visitor_id for item in analytics}),
        exports=sum(item.job_type == "export" for item in jobs),
        ai_requests=len(usage),
        ai_tokens=sum(item.total_tokens for item in usage),
        failed_jobs=summary.get("failed", 0),
        active_jobs=summary.get("queued", 0) + summary.get("running", 0),
        job_summary=summary,
        trend=trend,
        recent_resources=recent_resources,
        recent_jobs=jobs[:8],
    )
