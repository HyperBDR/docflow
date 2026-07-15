import json
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.ai_jobs import enqueue_ai_job
from app.database import get_db
from app.dependencies import current_user
from app.defaults import DEFAULT_HOTSPOT_STYLE, DEFAULT_TOOLTIP
from app.models import Hotspot as HotspotModel, Step, User
from app.schemas import RecordingDomMeta, RecordingStepMeta, StepOut
from app.services import owned_demo, step_out
from app.snapshots import SnapshotError, decode_snapshot, sanitize_page_context, sanitize_snapshot, store_snapshot
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
    if parsed.ai_enabled and settings.ai_enabled and settings.ai_api_key and step:
        try:
            enqueue_ai_job(db, demo, user, step.id)
        except Exception:
            # The slide is already stored. AI/Redis availability must never
            # turn a successful capture into an upload failure.
            db.rollback()
    return step_out(step, demo.id)


@router.post("/{demo_id}/slides", response_model=StepOut, status_code=201)
async def upload_dom_slide(
    demo_id: str,
    meta: str = Form(...),
    screenshot: UploadFile = File(...),
    snapshot: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    demo = owned_demo(db, demo_id, user)
    try:
        parsed = RecordingDomMeta.model_validate(json.loads(meta))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="invalid DOM slide metadata") from exc
    existing = db.scalar(select(Step).where(Step.demo_id == demo.id, Step.event_id == parsed.event_id))
    if existing:
        return step_out(existing, demo.id)
    count = db.scalar(select(func.count()).select_from(Step).where(Step.demo_id == demo.id)) or 0
    if count >= 100:
        raise HTTPException(status_code=400, detail="demo step limit reached")

    screenshot_content = await screenshot.read(10 * 1024 * 1024 + 1)
    if len(screenshot_content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="screenshot exceeds 10 MB")
    try:
        image_key, width, height = storage.save_screenshot(f"assets/drafts/{demo.id}/{uuid.uuid4()}", screenshot_content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid screenshot") from exc

    warnings = list(parsed.capture_warnings)
    snapshot_key = None
    if snapshot and settings.dom_slides_enabled:
        try:
            content = await snapshot.read(settings.snapshot_compressed_limit_mb * 1024 * 1024 + 1)
            decoded = decode_snapshot(content)
            sanitized, sanitizer_warnings = sanitize_snapshot(decoded)
            warnings.extend(sanitizer_warnings)
            snapshot_key = store_snapshot(sanitized)
        except SnapshotError as exc:
            warnings.append(f"DOM fallback: {exc}")
    elif snapshot:
        warnings.append("DOM slides are disabled; stored as an image slide")

    target_text = parsed.target.text if parsed.target and parsed.target.text else "目标元素"
    title = parsed.title or ("流程完成" if parsed.terminal else f"点击「{target_text[:60]}」")
    body = parsed.body or ("已完成此操作流程。" if parsed.terminal else title)
    redactions = [item.model_dump() for item in parsed.password_rects]
    step = Step(
        demo_id=demo.id,
        event_id=parsed.event_id,
        position=count,
        title=title,
        body=body,
        asset_key=image_key,
        render_mode="dom" if snapshot_key else "image",
        dom_snapshot_key=snapshot_key,
        viewport_width=parsed.viewport_width or width,
        viewport_height=parsed.viewport_height or height,
        hotspot=parsed.hotspot.model_dump() if parsed.hotspot else {},
        redactions=redactions,
        page_context=sanitize_page_context(parsed.page_context),
        scroll_state=parsed.scroll_state,
        capture_warnings=list(dict.fromkeys(warnings))[:100],
        duration=parsed.duration,
    )
    db.add(step)
    db.flush()
    if not parsed.terminal and parsed.hotspot:
        db.add(HotspotModel(
            step_id=step.id,
            position=0,
            selector=parsed.target.model_dump(exclude_none=True) if parsed.target else {},
            fallback_rect=parsed.hotspot.model_dump(),
            trigger="click",
            action={"type": "next"},
            tooltip={**DEFAULT_TOOLTIP, "content": body},
            style=DEFAULT_HOTSPOT_STYLE,
        ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        step = db.scalar(select(Step).where(Step.demo_id == demo.id, Step.event_id == parsed.event_id))
    if parsed.ai_enabled and settings.ai_enabled and settings.ai_api_key and step:
        try:
            enqueue_ai_job(db, demo, user, step.id)
        except Exception:
            db.rollback()
    return step_out(step, demo.id)
