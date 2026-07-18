import io
import traceback
from celery import Celery
from celery.schedules import crontab

from app.config import settings
from app.database import SessionLocal
from app.exporters import render_markdown_zip, render_mp4, render_pdf, render_player_images
from app.models import ExportJob, JobStatus, PublishedRevision, ShareToken, now
from app.storage import storage
from app.ai_service import run_ai_generation
from app.in_app_notifications import notify_job_result

celery = Celery("docflow", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.update(
    task_track_started=True, task_time_limit=1200, result_expires=3600,
    beat_schedule={
        "collect-platform-monitoring": {
            "task": "docflow.collect_monitoring",
            "schedule": max(30, settings.monitoring_interval_seconds),
        },
        "collect-daily-quota-usage": {
            "task": "docflow.collect_quota_usage",
            "schedule": crontab(hour=0, minute=10),
        },
    },
)


@celery.task(name="docflow.render_export")
def render_export(job_id: str):
    db = SessionLocal()
    try:
        job = db.get(ExportJob, job_id)
        if not job or job.status == JobStatus.cancelled:
            return
        job.status = JobStatus.running
        job.progress = 10
        job.started_at = job.started_at or now()
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
            data = render_markdown_zip(revision.snapshot, share.token if share else None)
        db.refresh(job)
        if job.status == JobStatus.cancelled:
            return
        extension = {"pdf": "pdf", "mp4": "mp4", "markdown": "zip"}[job.kind]
        result_key = storage.write(f"exports/{job.id}.{extension}", data)
        db.refresh(job)
        if job.status == JobStatus.cancelled:
            storage.delete(result_key)
            return
        job.result_key = result_key
        job.result_size = len(data)
        job.status = JobStatus.complete
        job.progress = 100
        job.completed_at = now()
        db.commit()
        notify_job_result(db, job, "export", True)
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(ExportJob, job_id)
        if job:
            db.refresh(job)
            if job.status == JobStatus.cancelled:
                return
            job.status = JobStatus.failed
            job.error = f"{exc}\n{traceback.format_exc()[-1500:]}"
            job.error_code = "export.render_failed"
            job.completed_at = now()
            db.commit()
            notify_job_result(db, job, "export", False)
            db.commit()
        raise
    finally:
        db.close()


@celery.task(name="docflow.ai_generate")
def ai_generate(job_id: str):
    run_ai_generation(job_id)


@celery.task(name="docflow.collect_monitoring")
def collect_platform_monitoring():
    from app.monitoring.collector import collect_monitoring
    db = SessionLocal()
    try:
        return collect_monitoring(db)
    finally:
        db.close()


@celery.task(name="docflow.collect_quota_usage")
def collect_daily_quota_usage():
    from app.quota_analytics import collect_quota_usage
    db = SessionLocal()
    try:
        return collect_quota_usage(db)
    finally:
        db.close()
