from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AIJob, Demo, JobStatus, User
from app.worker import celery


def enqueue_ai_job(db: Session, demo: Demo, user: User, step_id: str | None = None) -> AIJob:
    """Create one durable Celery job without waiting for model inference."""
    running = db.scalar(select(AIJob).where(
        AIJob.demo_id == demo.id,
        AIJob.step_id == step_id,
        AIJob.status.in_([JobStatus.queued, JobStatus.running]),
    ))
    if running:
        return running
    job = AIJob(owner_id=user.id, demo_id=demo.id, step_id=step_id, model=settings.ai_model)
    db.add(job)
    db.commit()
    db.refresh(job)
    celery.send_task("docflow.ai_generate", args=[job.id])
    return job
