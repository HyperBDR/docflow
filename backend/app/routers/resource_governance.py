from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import case, distinct, func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import admin_user
from app.models import (
    AnalyticsEvent, AuditLog, Demo, ExportDownloadEvent, ExportJob, JobStatus,
    Organization, ShareToken, Step, User, now,
)
from app.services import write_audit
from app.storage import storage

router = APIRouter(prefix="/api/admin/resource-governance", tags=["resource-governance"])


def page_result(items: list, total: int, page: int, page_size: int) -> dict:
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def person(user: User | None) -> dict | None:
    return {"id": user.id, "name": user.name or "", "email": user.email} if user else None


def organization_out(value: Organization | None) -> dict | None:
    return {"id": value.id, "name": value.name, "kind": value.kind} if value else None


def share_status(share: ShareToken) -> str:
    expires = share.expires_at
    if expires and (expires if expires.tzinfo else expires.replace(tzinfo=timezone.utc)) <= now():
        return "expired"
    return "revoked" if share.revoked else "active"


@router.get("/shares")
def list_shares(
    query: str = Query(default="", max_length=200), status: str = Query(default="", pattern="^(|active|expired|revoked)$"),
    organization_id: str = "", owner_id: str = "", page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100), db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    statement = select(ShareToken, Demo, User, Organization).join(Demo, Demo.id == ShareToken.demo_id).join(
        User, User.id == Demo.owner_id
    ).outerjoin(Organization, Organization.id == Demo.organization_id).where(Demo.deleted_at.is_(None))
    if query.strip():
        value = f"%{query.strip().lower()}%"
        statement = statement.where(or_(func.lower(Demo.title).like(value), func.lower(ShareToken.name).like(value), func.lower(User.email).like(value)))
    if organization_id: statement = statement.where(Demo.organization_id == organization_id)
    if owner_id: statement = statement.where(Demo.owner_id == owner_id)
    rows = db.execute(statement.order_by(ShareToken.created_at.desc())).all()
    if status: rows = [row for row in rows if share_status(row[0]) == status]
    total = len(rows); rows = rows[(page - 1) * page_size:page * page_size]
    share_ids = [row[0].id for row in rows]
    stats = {share_id: {"views": 0, "viewers": 0} for share_id in share_ids}
    if share_ids:
        for share_id, views, viewers in db.execute(select(
            AnalyticsEvent.share_id, func.count(distinct(AnalyticsEvent.session_id)), func.count(distinct(AnalyticsEvent.visitor_id)),
        ).where(AnalyticsEvent.share_id.in_(share_ids)).group_by(AnalyticsEvent.share_id)):
            stats[share_id] = {"views": views or 0, "viewers": viewers or 0}
    creators = {item.id: item for item in db.scalars(select(User).where(User.id.in_([row[0].created_by_id for row in rows if row[0].created_by_id]))).all()}
    return page_result([{
        "id": share.id, "name": share.name, "status": share_status(share), "password_protected": bool(share.password_hash),
        "url": f"{settings.web_origin.rstrip('/')}/p/{share.token}", "resource": {"id": demo.id, "title": demo.title},
        "owner": person(owner), "created_by": person(creators.get(share.created_by_id)), "organization": organization_out(organization),
        "views": stats[share.id]["views"], "unique_viewers": stats[share.id]["viewers"], "access_count": share.access_count,
        "expires_at": share.expires_at, "last_accessed_at": share.last_accessed_at, "created_at": share.created_at,
    } for share, demo, owner, organization in rows], total, page, page_size)


@router.patch("/shares/{share_id}")
def govern_share(share_id: str, payload: dict, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    share = db.get(ShareToken, share_id)
    demo = db.get(Demo, share.demo_id) if share else None
    if not share or not demo or demo.deleted_at:
        raise HTTPException(status_code=404, detail="share link not found")
    before = {"revoked": share.revoked, "expires_at": share.expires_at.isoformat() if share.expires_at else None}
    if "revoked" in payload: share.revoked = bool(payload["revoked"])
    if share.revoked:
        write_audit(db, actor, "share.revoked", "share", share.id, share.name or demo.title,
                    demo.organization_id, before=before, after={"revoked": True}, request=request)
    else:
        write_audit(db, actor, "share.restored", "share", share.id, share.name or demo.title,
                    demo.organization_id, before=before, after={"revoked": False}, request=request)
    db.commit()
    return {"id": share.id, "status": share_status(share)}


@router.get("/downloads")
def list_downloads(
    query: str = Query(default="", max_length=200), status: str = Query(default="", pattern="^(|queued|running|complete|failed|cancelled)$"),
    kind: str = Query(default="", pattern="^(|pdf|mp4|markdown)$"), organization_id: str = "", owner_id: str = "",
    page: int = Query(default=1, ge=1), page_size: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    statement = select(ExportJob, Demo, User, Organization).join(Demo, Demo.id == ExportJob.demo_id).join(
        User, User.id == ExportJob.owner_id
    ).outerjoin(Organization, Organization.id == Demo.organization_id).where(Demo.deleted_at.is_(None))
    if query.strip():
        value = f"%{query.strip().lower()}%"; statement = statement.where(or_(func.lower(Demo.title).like(value), func.lower(User.email).like(value), ExportJob.id.like(value)))
    if status: statement = statement.where(ExportJob.status == status)
    if kind: statement = statement.where(ExportJob.kind == kind)
    if organization_id: statement = statement.where(Demo.organization_id == organization_id)
    if owner_id: statement = statement.where(ExportJob.owner_id == owner_id)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(statement.order_by(ExportJob.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    job_ids = [row[0].id for row in rows]
    event_stats = {job_id: {"requests": 0, "completed": 0, "last": None} for job_id in job_ids}
    if job_ids:
        for job_id, requests, completed, last in db.execute(select(
            ExportDownloadEvent.export_job_id, func.count(ExportDownloadEvent.id),
            func.sum(case((ExportDownloadEvent.status == "completed", 1), else_=0)), func.max(ExportDownloadEvent.created_at),
        ).where(ExportDownloadEvent.export_job_id.in_(job_ids)).group_by(ExportDownloadEvent.export_job_id)):
            event_stats[job_id] = {"requests": requests or 0, "completed": completed or 0, "last": last}
    return page_result([{
        "id": job.id, "kind": job.kind, "status": job.status.value, "progress": job.progress,
        "resource": {"id": demo.id, "title": demo.title}, "owner": person(owner), "organization": organization_out(organization),
        "size": job.result_size or (storage.size(job.result_key) if job.result_key else 0), "storage_key": job.result_key,
        "download_requests": event_stats[job.id]["requests"], "completed_downloads": event_stats[job.id]["completed"],
        "last_downloaded_at": event_stats[job.id]["last"], "created_at": job.created_at, "completed_at": job.completed_at,
    } for job, demo, owner, organization in rows], total, page, page_size)


def distribution(events: list[AnalyticsEvent], field: str) -> list[dict]:
    sessions: dict[str, str] = {}
    for event in events:
        value = getattr(event, field, "") or ""
        if value and event.session_id not in sessions: sessions[event.session_id] = value
    return [{"name": key, "value": value} for key, value in Counter(sessions.values()).most_common(20)]


@router.get("/resources/{demo_id}")
def resource_governance(demo_id: str, days: int = Query(default=30, ge=1, le=365), db: Session = Depends(get_db), _: User = Depends(admin_user)):
    demo = db.scalar(select(Demo).where(Demo.id == demo_id, Demo.deleted_at.is_(None)))
    if not demo: raise HTTPException(status_code=404, detail="resource not found")
    start = now() - timedelta(days=days - 1)
    events = db.scalars(select(AnalyticsEvent).where(AnalyticsEvent.demo_id == demo.id, AnalyticsEvent.created_at >= start).order_by(AnalyticsEvent.created_at)).all()
    sessions = {item.session_id for item in events}; visitors = {item.visitor_id for item in events}
    completed = {item.session_id for item in events if item.event_type == "complete"}
    interacted = {item.session_id for item in events if item.event_type == "interaction"}
    by_day: dict[str, dict] = defaultdict(lambda: {"sessions": set(), "visitors": set(), "completions": set()})
    for event in events:
        bucket = by_day[event.created_at.date().isoformat()]
        bucket["sessions"].add(event.session_id); bucket["visitors"].add(event.visitor_id)
        if event.event_type == "complete": bucket["completions"].add(event.session_id)
    trend = []
    for offset in range(days):
        key = (start.date() + timedelta(days=offset)).isoformat(); bucket = by_day[key]
        trend.append({"date": key, "views": len(bucket["sessions"]), "viewers": len(bucket["visitors"]), "completions": len(bucket["completions"])})
    steps = db.scalars(select(Step).where(Step.demo_id == demo.id).order_by(Step.position)).all()
    step_sessions: dict[str, set[str]] = defaultdict(set)
    for event in events:
        if event.step_id and event.event_type == "step_view": step_sessions[event.step_id].add(event.session_id)
    shares = db.scalars(select(ShareToken).where(ShareToken.demo_id == demo.id).order_by(ShareToken.created_at.desc())).all()
    share_stats: dict[str, set[str]] = defaultdict(set)
    for event in events: share_stats[event.share_id].add(event.session_id)
    jobs = db.scalars(select(ExportJob).where(ExportJob.demo_id == demo.id).order_by(ExportJob.created_at.desc())).all()
    job_ids = [item.id for item in jobs]
    downloads = db.scalars(select(ExportDownloadEvent).where(ExportDownloadEvent.export_job_id.in_(job_ids)).order_by(ExportDownloadEvent.created_at.desc()).limit(200)).all() if job_ids else []
    users = {item.id: item for item in db.scalars(select(User).where(User.id.in_({item.requested_by_id for item in downloads if item.requested_by_id} | {item.created_by_id for item in shares if item.created_by_id}))).all()}
    audit = db.scalars(select(AuditLog).where(or_(AuditLog.target_id == demo.id, AuditLog.target_id.in_([item.id for item in shares + jobs]))).order_by(AuditLog.created_at.desc()).limit(100)).all()
    actors = {item.id: item for item in db.scalars(select(User).where(User.id.in_([item.actor_id for item in audit if item.actor_id]))).all()}
    locations = Counter(", ".join(filter(None, [item.city, item.region, item.country])) for item in events)
    return {
        "range": {"days": days, "from": start, "to": now()},
        "summary": {"views": len(sessions), "unique_viewers": len(visitors), "engagement": round(len(interacted) / len(sessions) * 100, 1) if sessions else 0, "completion": round(len(completed) / len(sessions) * 100, 1) if sessions else 0, "share_links": len(shares), "active_shares": sum(share_status(item) == "active" for item in shares), "exports": len(jobs), "download_requests": len(downloads), "completed_downloads": sum(item.status == "completed" for item in downloads)},
        "trend": trend,
        "steps": [{"id": step.id, "title": step.title or f"Step {index + 1}", "position": step.position, "viewers": len(step_sessions[step.id]), "conversion": round(len(step_sessions[step.id]) / len(sessions) * 100, 1) if sessions else 0} for index, step in enumerate(steps)],
        "devices": {"operating_systems": distribution(events, "operating_system"), "browsers": distribution(events, "browser"), "device_types": distribution(events, "device")},
        "locations": [{"name": key, "value": value} for key, value in locations.most_common(20) if key],
        "sources": distribution(events, "referrer_host"), "utm_sources": distribution(events, "utm_source"),
        "shares": [{"id": item.id, "name": item.name, "status": share_status(item), "url": f"{settings.web_origin.rstrip('/')}/p/{item.token}", "password_protected": bool(item.password_hash), "expires_at": item.expires_at, "views": len(share_stats[item.id]), "access_count": item.access_count, "last_accessed_at": item.last_accessed_at, "created_by": person(users.get(item.created_by_id)), "created_at": item.created_at} for item in shares],
        "exports": [{"id": item.id, "kind": item.kind, "status": item.status.value, "size": item.result_size or (storage.size(item.result_key) if item.result_key else 0), "storage_key": item.result_key, "created_at": item.created_at, "completed_at": item.completed_at} for item in jobs],
        "downloads": [{"id": item.id, "job_id": item.export_job_id, "request_id": item.request_id, "source": item.source, "status": item.status, "bytes": item.bytes_transferred, "country": item.country, "ip_address": item.ip_address, "user_agent": item.user_agent, "requested_by": person(users.get(item.requested_by_id)), "created_at": item.created_at, "completed_at": item.completed_at} for item in downloads],
        "audit": [{"id": item.id, "action": item.action, "target_type": item.target_type, "target_label": item.target_label, "actor": person(actors.get(item.actor_id)), "source": item.source, "outcome": item.outcome, "created_at": item.created_at} for item in audit],
    }


@router.post("/download-events/ingest", status_code=202)
def ingest_download_event(payload: dict, x_docflow_ingest_token: str = Header(default=""), db: Session = Depends(get_db)):
    if not settings.download_log_ingest_token or x_docflow_ingest_token != settings.download_log_ingest_token:
        raise HTTPException(status_code=401, detail="invalid ingest token")
    external_id = str(payload.get("external_id") or "")[:255]
    if not external_id: raise HTTPException(status_code=400, detail="external_id is required")
    existing = db.scalar(select(ExportDownloadEvent).where(ExportDownloadEvent.external_id == external_id))
    if existing: return {"id": existing.id, "duplicate": True}
    job = db.get(ExportJob, str(payload.get("export_job_id") or ""))
    if not job: raise HTTPException(status_code=404, detail="export job not found")
    demo = db.get(Demo, job.demo_id)
    event = ExportDownloadEvent(
        export_job_id=job.id, demo_id=job.demo_id, organization_id=demo.organization_id if demo else None,
        external_id=external_id, source=str(payload.get("source") or "cdn")[:30],
        status="completed" if payload.get("status") == "completed" else "requested",
        bytes_transferred=max(0, int(payload.get("bytes_transferred") or 0)), ip_address=str(payload.get("ip_address") or "")[:80],
        user_agent=str(payload.get("user_agent") or "")[:1000], referrer=str(payload.get("referrer") or "")[:1000],
        country=str(payload.get("country") or "")[:100], event_metadata=payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
        completed_at=now() if payload.get("status") == "completed" else None,
    )
    db.add(event); db.commit(); db.refresh(event)
    return {"id": event.id, "duplicate": False}
