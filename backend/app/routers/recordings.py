import json
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import Step, User
from app.schemas import RecordingStepMeta, StepOut
from app.services import owned_demo, step_out
from app.storage import storage

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.post("/{demo_id}/steps", response_model=StepOut, status_code=201)
async def upload_step(
    demo_id: str,
    meta: str = Form(...),
    screenshot: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    demo = owned_demo(db, demo_id, user)
    try:
        parsed = RecordingStepMeta.model_validate(json.loads(meta))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="invalid step metadata") from exc
    existing = db.scalar(select(Step).where(Step.demo_id == demo.id, Step.event_id == parsed.event_id))
    if existing:
        return step_out(existing, demo.id)
    count = db.scalar(select(func.count()).select_from(Step).where(Step.demo_id == demo.id)) or 0
    if count >= 100:
        raise HTTPException(status_code=400, detail="demo step limit reached")
    content = await screenshot.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="screenshot exceeds 10 MB")
    try:
        key, width, height = storage.save_screenshot(f"assets/drafts/{demo.id}/{uuid.uuid4()}", content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid screenshot") from exc
    redactions = [parsed.password_rect.model_dump()] if parsed.password_rect else []
    step = Step(
        demo_id=demo.id,
        event_id=parsed.event_id,
        position=count,
        title=parsed.title,
        body=parsed.body,
        asset_key=key,
        viewport_width=parsed.viewport_width or width,
        viewport_height=parsed.viewport_height or height,
        hotspot=parsed.hotspot.model_dump(),
        redactions=redactions,
        duration=parsed.duration,
    )
    db.add(step)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        step = db.scalar(select(Step).where(Step.demo_id == demo.id, Step.event_id == parsed.event_id))
    return step_out(step, demo.id)

