from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_models import active_model
from app.database import get_db
from app.dependencies import current_user
from app.ai_jobs import enqueue_ai_job
from app.models import AIJob, Demo, Hotspot, Step, User
from app.schemas import AIJobOut
from app.services import owned_demo

router = APIRouter(prefix="/api", tags=["ai"])


def _legacy_change_report(db: Session, job: AIJob, result: dict) -> dict:
    applied = job.applied_patch or {}
    inverse = job.inverse_patch or {}
    demo = db.get(Demo, job.demo_id)
    outline = result.get("outline") if isinstance(result.get("outline"), dict) else {}
    report: dict = {"demo": {"fields": {}}, "steps": []}
    if not job.step_id and demo:
        for field in ["title", "description"]:
            report["demo"]["fields"][field] = {
                "before": inverse.get("demo", {}).get(field, getattr(demo, field)),
                "after": outline.get(field, applied.get("demo", {}).get(field, getattr(demo, field))),
                "applied": field in applied.get("demo", {}),
            }
    generated = result.get("steps") if isinstance(result.get("steps"), list) else []
    for item in generated:
        if not isinstance(item, dict):
            continue
        step = db.get(Step, str(item.get("id", "")))
        if not step:
            continue
        step_applied = applied.get("steps", {}).get(step.id, {})
        step_inverse = inverse.get("steps", {}).get(step.id, {})
        fields = {}
        for field in ["title", "body"]:
            fields[field] = {
                "before": step_inverse.get(field, getattr(step, field)),
                "after": item.get(field, step_applied.get(field, getattr(step, field))),
                "applied": field in step_applied,
            }
        hotspot = step.hotspots[0] if step.hotspots else None
        hotspot_applied = applied.get("hotspots", {}).get(hotspot.id, {}) if hotspot else {}
        hotspot_inverse = inverse.get("hotspots", {}).get(hotspot.id, {}) if hotspot else {}
        current_tooltip = dict(hotspot.tooltip or {}) if hotspot else {}
        fields["tooltip"] = {
            "before": dict(hotspot_inverse.get("tooltip") or current_tooltip).get("content", ""),
            "after": item.get("tooltip", dict(hotspot_applied.get("tooltip") or current_tooltip).get("content", "")),
            "applied": "tooltip" in hotspot_applied,
        }
        report["steps"].append({
            "id": step.id, "position": step.position, "fields": fields,
            "warnings": item.get("warnings", []), "redundant": bool(item.get("redundant", False)),
        })
    return report


def job_out(job: AIJob, db: Session) -> AIJobOut:
    result = dict(job.result or {})
    if job.status.value == "complete" and "changes" not in result:
        result["changes"] = _legacy_change_report(db, job, result)
    return AIJobOut(
        id=job.id, demo_id=job.demo_id, step_id=job.step_id, status=job.status.value,
        progress=job.progress, model=job.model, result=result, error=job.error, error_code=job.error_code,
        can_revert=bool(job.inverse_patch and any(job.inverse_patch.get(key) for key in ["demo", "steps", "hotspots"])),
    )


def ensure_ai(db: Session) -> None:
    if not active_model(db):
        raise HTTPException(status_code=503, detail="AI is not configured")


@router.post("/demos/{demo_id}/ai/generate", response_model=AIJobOut, status_code=202)
def generate_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ensure_ai(db)
    demo = owned_demo(db, demo_id, user)
    if not demo.steps:
        raise HTTPException(status_code=400, detail="record at least one slide first")
    return job_out(enqueue_ai_job(db, demo, user), db)


@router.post("/demos/{demo_id}/steps/{step_id}/ai/generate", response_model=AIJobOut, status_code=202)
def generate_step(demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ensure_ai(db)
    demo = owned_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.demo_id == demo.id, Step.id == step_id))
    if not step:
        raise HTTPException(status_code=404, detail="step not found")
    return job_out(enqueue_ai_job(db, demo, user, step.id), db)


@router.get("/ai/jobs/{job_id}", response_model=AIJobOut)
def get_ai_job(job_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    job = db.get(AIJob, job_id)
    if not job or job.owner_id != user.id:
        raise HTTPException(status_code=404, detail="AI job not found")
    return job_out(job, db)


@router.get("/demos/{demo_id}/ai/latest", response_model=AIJobOut | None)
def latest_ai_job(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    job = db.scalar(select(AIJob).where(AIJob.demo_id == demo.id).order_by(AIJob.created_at.desc()))
    return job_out(job, db) if job else None


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
    return job_out(job, db)
