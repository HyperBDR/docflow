import json
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.ai_jobs import enqueue_ai_job
from app.ai_models import active_model
from app.database import get_db
from app.dependencies import current_user
from app.defaults import DEFAULT_HOTSPOT_STYLE, DEFAULT_TOOLTIP
from app.models import Hotspot as HotspotModel, Step, User
from app.schemas import RecordingAuditInput, RecordingDomMeta, RecordingStepMeta, StepOut
from app.services import owned_demo, step_out, write_audit
from app.snapshots import SnapshotError, decode_snapshot, sanitize_page_context, sanitize_snapshot, store_snapshot
from app.storage import storage
from app.quota import enforce

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.post("/{demo_id}/steps", response_model=StepOut, status_code=201)
async def upload_step(
    demo_id: str,
    request: Request,
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
    enforce(db,demo.organization_id,"max_steps_per_resource",current=count)
    content = await screenshot.read(10 * 1024 * 1024 + 1)
    enforce(db,demo.organization_id,"storage_bytes",len(content))
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
        db.flush()
        db.add(HotspotModel(
            step_id=step.id,
            position=0,
            selector={},
            fallback_rect=parsed.hotspot.model_dump(),
            trigger="click",
            action={"type": "next"},
            tooltip={**DEFAULT_TOOLTIP, "content": parsed.body},
            style=DEFAULT_HOTSPOT_STYLE,
        ))
        db.commit()
    except IntegrityError:
        db.rollback()
        step = db.scalar(select(Step).where(Step.demo_id == demo.id, Step.event_id == parsed.event_id))
    write_audit(db, user, "recording.step_captured", "recording", demo.id, demo.title, demo.organization_id,
                after={"step_id": step.id, "position": step.position, "mode": "screenshot", "ai_enabled": parsed.ai_enabled},
                request=request, source="extension")
    db.commit()
    if parsed.ai_enabled and active_model(db) and step:
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
    request: Request,
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
    enforce(db,demo.organization_id,"max_steps_per_resource",current=count)

    screenshot_content = await screenshot.read(10 * 1024 * 1024 + 1)
    if len(screenshot_content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="screenshot exceeds 10 MB")

    warnings = list(parsed.capture_warnings)
    snapshot_key = None
    snapshot_content = b""
    sanitized_snapshot = None
    if snapshot and settings.dom_slides_enabled:
        try:
            snapshot_content = await snapshot.read(settings.snapshot_compressed_limit_mb * 1024 * 1024 + 1)
            decoded = decode_snapshot(snapshot_content)
            sanitized_snapshot, sanitizer_warnings = sanitize_snapshot(decoded)
            warnings.extend(sanitizer_warnings)
        except SnapshotError as exc:
            snapshot_content = b""
            warnings.append(f"DOM fallback: {exc}")
    elif snapshot:
        warnings.append("DOM slides are disabled; stored as an image slide")

    enforce(db,demo.organization_id,"storage_bytes",len(screenshot_content)+len(snapshot_content))
    try:
        image_key, width, height = storage.save_screenshot(f"assets/drafts/{demo.id}/{uuid.uuid4()}", screenshot_content)
        if sanitized_snapshot is not None:
            snapshot_key = store_snapshot(sanitized_snapshot)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid screenshot") from exc

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
    write_audit(db, user, "recording.step_captured", "recording", demo.id, demo.title, demo.organization_id,
                after={"step_id": step.id, "position": step.position, "mode": "html", "terminal": parsed.terminal, "ai_enabled": parsed.ai_enabled},
                request=request, source="extension")
    db.commit()
    if parsed.ai_enabled and active_model(db) and step:
        try:
            enqueue_ai_job(db, demo, user, step.id)
        except Exception:
            db.rollback()
    return step_out(step, demo.id)


@router.post("/{demo_id}/events", status_code=204)
def record_lifecycle_event(
    demo_id: str, payload: RecordingAuditInput, request: Request,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    demo = owned_demo(db, demo_id, user)
    write_audit(db, user, f"recording.{payload.action}", "recording", demo.id, demo.title, demo.organization_id,
                after={"mode": payload.mode, "ai_enabled": payload.ai_enabled, "step_count": payload.step_count},
                request=request, source="extension")
    db.commit()
