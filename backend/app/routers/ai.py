from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.ai_jobs import enqueue_ai_job
from app.models import AIJob, Hotspot, Step, User
from app.schemas import AIJobOut
from app.services import owned_demo

router = APIRouter(prefix="/api", tags=["ai"])


def job_out(job: AIJob) -> AIJobOut:
    return AIJobOut(
        id=job.id, demo_id=job.demo_id, step_id=job.step_id, status=job.status.value,
        progress=job.progress, model=job.model, result=job.result or {}, error=job.error, error_code=job.error_code,
        can_revert=bool(job.inverse_patch and any(job.inverse_patch.get(key) for key in ["demo", "steps", "hotspots"])),
    )


def ensure_ai() -> None:
    if not settings.ai_enabled or not settings.ai_api_key:
        raise HTTPException(status_code=503, detail="AI is not configured")


@router.post("/demos/{demo_id}/ai/generate", response_model=AIJobOut, status_code=202)
def generate_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ensure_ai()
    demo = owned_demo(db, demo_id, user)
    if not demo.steps:
        raise HTTPException(status_code=400, detail="record at least one slide first")
    return job_out(enqueue_ai_job(db, demo, user))


@router.post("/demos/{demo_id}/steps/{step_id}/ai/generate", response_model=AIJobOut, status_code=202)
def generate_step(demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ensure_ai()
    demo = owned_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.demo_id == demo.id, Step.id == step_id))
    if not step:
        raise HTTPException(status_code=404, detail="step not found")
    return job_out(enqueue_ai_job(db, demo, user, step.id))


@router.get("/ai/jobs/{job_id}", response_model=AIJobOut)
def get_ai_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(AIJob, job_id)
    if not job or job.owner_id != user.id:
        raise HTTPException(status_code=404, detail="AI job not found")
    return job_out(job)


@router.get("/demos/{demo_id}/ai/latest", response_model=AIJobOut | None)
def latest_ai_job(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    job = db.scalar(select(AIJob).where(AIJob.demo_id == demo.id).order_by(AIJob.created_at.desc()))
    return job_out(job) if job else None


@router.post("/ai/jobs/{job_id}/revert", response_model=AIJobOut)
def revert_ai_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(AIJob, job_id)
    if not job or job.owner_id != user.id:
        raise HTTPException(status_code=404, detail="AI job not found")
    applied = job.applied_patch or {}
    inverse = job.inverse_patch or {}
    conflicts: list[str] = []
    demo = db.get(Demo, job.demo_id)
    if demo:
        for field, old_value in inverse.get("demo", {}).items():
            if getattr(demo, field) == applied.get("demo", {}).get(field):
                setattr(demo, field, old_value)
            else:
                conflicts.append(f"demo.{field}")
    for step_id, values in inverse.get("steps", {}).items():
        step = db.get(Step, step_id)
        if not step:
            continue
        for field, old_value in values.items():
            if getattr(step, field) == applied.get("steps", {}).get(step_id, {}).get(field):
                setattr(step, field, old_value)
            else:
                conflicts.append(f"step.{step_id}.{field}")
    for hotspot_id, values in inverse.get("hotspots", {}).items():
        hotspot = db.get(Hotspot, hotspot_id)
        if not hotspot:
            continue
        for field, old_value in values.items():
            if getattr(hotspot, field) == applied.get("hotspots", {}).get(hotspot_id, {}).get(field):
                setattr(hotspot, field, old_value)
            else:
                conflicts.append(f"hotspot.{hotspot_id}.{field}")
    job.inverse_patch = {}
    job.result = {**(job.result or {}), "reverted": True, "revert_conflicts": conflicts}
    db.commit()
    return job_out(job)
