import io
import traceback
from celery import Celery

from app.config import settings
from app.database import SessionLocal
from app.exporters import render_markdown_zip, render_mp4, render_pdf, render_player_images
from app.models import ExportJob, JobStatus, PublishedRevision, ShareToken
from app.storage import storage
from app.ai_service import run_ai_generation

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
        share = db.query(ShareToken).filter(
            ShareToken.demo_id == job.demo_id, ShareToken.revision_id == revision.id, ShareToken.revoked.is_(False)
        ).order_by(ShareToken.created_at.desc()).first()
        if job.kind == "mp4":
            data = render_mp4(revision.snapshot, share.token if share else None)
        elif job.kind == "pdf":
            pages = render_player_images(revision.snapshot, share.token if share else None)
            if pages:
                output = io.BytesIO()
                pages[0].save(output, "PDF", save_all=True, append_images=pages[1:], resolution=144, quality=90)
                data = output.getvalue()
            else:
                data = render_pdf(revision.snapshot)
        else:
            data = render_markdown_zip(revision.snapshot)
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


@celery.task(name="docflow.ai_generate")
def ai_generate(job_id: str):
    run_ai_generation(job_id)
