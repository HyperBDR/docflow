from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_models import active_model
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
    model = active_model(db)
    if not model:
        raise RuntimeError("AI is not configured")
    job = AIJob(owner_id=user.id, demo_id=demo.id, step_id=step_id, model_config_id=model.id, model=model.model)
    db.add(job)
    db.commit()
    db.refresh(job)
    celery.send_task("docflow.ai_generate", args=[job.id], task_id=job.id)
    return job
