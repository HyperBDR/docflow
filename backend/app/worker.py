import traceback
from celery import Celery

from app.config import settings
from app.database import SessionLocal
from app.exporters import render_markdown_zip, render_mp4, render_pdf
from app.models import ExportJob, JobStatus, PublishedRevision
from app.storage import storage

celery = Celery("docflow", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.update(task_track_started=True, task_time_limit=1200, result_expires=3600)


@celery.task(name="docflow.render_export")
def render_export(job_id: str):
    db = SessionLocal()
    try:
        job = db.get(ExportJob, job_id)
        if not job:
            return
        job.status = JobStatus.running
        job.progress = 10
        db.commit()
        revision = db.get(PublishedRevision, job.revision_id)
        if not revision:
            raise RuntimeError("published revision no longer exists")
        data = {"pdf": render_pdf, "mp4": render_mp4, "markdown": render_markdown_zip}[job.kind](revision.snapshot)
        extension = {"pdf": "pdf", "mp4": "mp4", "markdown": "zip"}[job.kind]
        job.result_key = storage.write(f"exports/{job.id}.{extension}", data)
        job.status = JobStatus.complete
        job.progress = 100
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(ExportJob, job_id)
        if job:
            job.status = JobStatus.failed
            job.error = f"{exc}\n{traceback.format_exc()[-1500:]}"
            db.commit()
        raise
    finally:
        db.close()

