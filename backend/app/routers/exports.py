import io
import re
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import Demo, ExportDownloadEvent, ExportJob, JobStatus, User, now
from app.schemas import ExportCreate, ExportOut
from app.services import owned_demo
from app.services import write_audit
from app.storage import storage
from app.worker import celery
from app.quota import enforce
from app.quota_estimates import estimate_export_bytes, estimate_video_minutes

router = APIRouter(prefix="/api/exports", tags=["exports"])


def export_filename(title: str, created_at, suffix: str) -> tuple[str, str]:
    clean_title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", (title or "未命名演示").strip())
    clean_title = re.sub(r"\s+", " ", clean_title).strip(" .-") or "未命名演示"
    clean_title = clean_title[:100].rstrip(" .-")
    timestamp = created_at.strftime("%Y%m%d-%H%M%S")
    unicode_name = f"DocFlow-{clean_title}-{timestamp}.{suffix}"
    ascii_name = f"DocFlow-export-{timestamp}.{suffix}"
    return ascii_name, quote(unicode_name)


def export_out(job: ExportJob) -> ExportOut:
    return ExportOut(
        id=job.id, kind=job.kind, status=job.status.value, progress=job.progress, error=job.error, error_code=job.error_code,
        download_url=f"/api/exports/{job.id}/download" if job.status == JobStatus.complete else None,
        created_at=job.created_at,
    )


@router.get("", response_model=list[ExportOut])
def list_exports(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    jobs = db.scalars(
        select(ExportJob).where(ExportJob.demo_id == demo.id, ExportJob.owner_id == user.id)
        .order_by(ExportJob.created_at.desc()).limit(50)
    ).all()
    return [export_out(job) for job in jobs]


@router.post("/{demo_id}", response_model=ExportOut, status_code=202)
def create_export(payload: ExportCreate, demo_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    if not demo.current_revision_id:
        raise HTTPException(status_code=400, detail="publish the demo before exporting")
    reserved_bytes = estimate_export_bytes(demo, payload.kind)
    enforce(db, demo.organization_id, "monthly_exports")
    if payload.kind == "mp4":
        enforce(db, demo.organization_id, "monthly_video_minutes", estimate_video_minutes(demo))
    enforce(db, demo.organization_id, "storage_bytes", reserved_bytes)
    job = ExportJob(
        owner_id=user.id, demo_id=demo.id, revision_id=demo.current_revision_id,
        kind=payload.kind, quota_reserved_bytes=reserved_bytes,
    )
    db.add(job)
    db.flush()
    write_audit(db, user, "export.created", "export", job.id, f"{demo.title} · {job.kind}", demo.organization_id,
                after={"demo_id": demo.id, "kind": job.kind}, request=request)
    db.commit()
    db.refresh(job)
    celery.send_task("docflow.render_export", args=[job.id], task_id=job.id)
    return export_out(job)


@router.get("/{job_id}", response_model=ExportOut)
def get_export(job_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(ExportJob, job_id)
    if not job or job.owner_id != user.id:
        raise HTTPException(status_code=404, detail="export not found")
    return export_out(job)


@router.get("/{job_id}/download")
def download_export(job_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(ExportJob, job_id)
    if not job or job.owner_id != user.id or job.status != JobStatus.complete or not job.result_key:
        raise HTTPException(status_code=404, detail="export not found")
    media = {"pdf": "application/pdf", "mp4": "video/mp4", "markdown": "application/zip"}[job.kind]
    suffix = {"pdf": "pdf", "mp4": "mp4", "markdown": "zip"}[job.kind]
    demo = db.get(Demo, job.demo_id)
    fallback_name, encoded_name = export_filename(demo.title if demo else "未命名演示", job.created_at, suffix)
    direct = storage.direct_url(job.result_key, fallback_name)
    event = ExportDownloadEvent(
        export_job_id=job.id, demo_id=job.demo_id, organization_id=demo.organization_id if demo else None,
        requested_by_id=user.id, source="s3" if direct else "proxy", status="requested",
        bytes_transferred=job.result_size or storage.size(job.result_key),
        ip_address=(request.client.host if request.client else "")[:80],
        user_agent=request.headers.get("user-agent", "")[:1000], referrer=request.headers.get("referer", "")[:1000],
        country=(request.headers.get("cf-ipcountry") or request.headers.get("x-country") or "")[:100],
    )
    db.add(event)
    db.flush()
    if not direct:
        event.status = "completed"; event.completed_at = now()
    write_audit(db, user, "export.download_requested", "export", job.id, demo.title if demo else job.id,
                demo.organization_id if demo else None, after={"request_id": event.request_id, "source": event.source, "status": event.status}, request=request)
    db.commit()
    if direct:
        return RedirectResponse(direct, status_code=307)
    return StreamingResponse(
        io.BytesIO(storage.read(job.result_key)), media_type=media,
        headers={"Content-Disposition": f"attachment; filename=\"{fallback_name}\"; filename*=UTF-8''{encoded_name}"},
    )
