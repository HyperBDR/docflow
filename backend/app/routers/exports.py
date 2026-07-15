import io
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import ExportJob, JobStatus, User
from app.schemas import ExportCreate, ExportOut
from app.services import owned_demo
from app.storage import storage
from app.worker import celery

router = APIRouter(prefix="/api/exports", tags=["exports"])


def export_out(job: ExportJob) -> ExportOut:
    return ExportOut(
        id=job.id, kind=job.kind, status=job.status.value, progress=job.progress, error=job.error,
        download_url=f"/api/exports/{job.id}/download" if job.status == JobStatus.complete else None,
    )


@router.post("/{demo_id}", response_model=ExportOut, status_code=202)
def create_export(payload: ExportCreate, demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    if not demo.current_revision_id:
        raise HTTPException(status_code=400, detail="publish the demo before exporting")
    job = ExportJob(owner_id=user.id, demo_id=demo.id, revision_id=demo.current_revision_id, kind=payload.kind)
    db.add(job)
    db.commit()
    db.refresh(job)
    celery.send_task("docflow.render_export", args=[job.id])
    return export_out(job)


@router.get("/{job_id}", response_model=ExportOut)
def get_export(job_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(ExportJob, job_id)
    if not job or job.owner_id != user.id:
        raise HTTPException(status_code=404, detail="export not found")
    return export_out(job)


@router.get("/{job_id}/download")
def download_export(job_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(ExportJob, job_id)
    if not job or job.owner_id != user.id or job.status != JobStatus.complete or not job.result_key:
        raise HTTPException(status_code=404, detail="export not found")
    media = {"pdf": "application/pdf", "mp4": "video/mp4", "markdown": "application/zip"}[job.kind]
    suffix = {"pdf": "pdf", "mp4": "mp4", "markdown": "zip"}[job.kind]
    return StreamingResponse(
        io.BytesIO(storage.read(job.result_key)), media_type=media,
        headers={"Content-Disposition": f'attachment; filename="docflow-{job.demo_id}.{suffix}"'},
    )
