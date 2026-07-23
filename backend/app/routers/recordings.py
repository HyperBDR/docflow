import json
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.ai_jobs import enqueue_ai_job
from app.ai_models import active_model
from app.database import get_db
from app.dependencies import current_user
from app.defaults import DEFAULT_HOTSPOT_STYLE, DEFAULT_TOOLTIP
from app.models import DemoStatus, Hotspot as HotspotModel, RecordingSession, Step, User
from app.schemas import RecordingAuditInput, RecordingDomMeta, RecordingSessionCreate, RecordingSessionOut, RecordingStepMeta, StepOut
from app.services import owned_demo, step_out, write_audit
from app.snapshots import SnapshotError, decode_snapshot, sanitize_page_context, sanitize_snapshot, store_snapshot
from app.storage import storage
from app.quota import enforce

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def _active_session(db: Session, session_id: str | None, demo_id: str, user: User) -> RecordingSession | None:
    if not session_id:
        return None
    session = db.scalar(select(RecordingSession).where(
        RecordingSession.id == session_id,
        RecordingSession.demo_id == demo_id,
        RecordingSession.owner_id == user.id,
    ))
    if not session:
        raise HTTPException(status_code=404, detail="recording session not found")
    if session.status != "active":
        raise HTTPException(status_code=409, detail="recording session is no longer active")
    return session


def _session_out(db: Session, session: RecordingSession) -> RecordingSessionOut:
    count = db.scalar(select(func.count()).select_from(Step).where(Step.recording_session_id == session.id)) or 0
    return RecordingSessionOut(
        id=session.id, demo_id=session.demo_id, status=session.status, mode=session.mode,
        ai_enabled=session.ai_enabled, auto_created=session.auto_created, step_count=count,
    )


@router.post("/{demo_id}/sessions", response_model=RecordingSessionOut, status_code=201)
def create_recording_session(
    demo_id: str, payload: RecordingSessionCreate,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    demo = owned_demo(db, demo_id, user)
    active = db.scalar(select(RecordingSession.id).where(
        RecordingSession.demo_id == demo.id,
        RecordingSession.owner_id == user.id,
        RecordingSession.status == "active",
    ).limit(1))
    if active:
        raise HTTPException(status_code=409, detail="a recording session is already active for this resource")
    if payload.auto_created and (demo.steps or demo.status != DemoStatus.draft):
        raise HTTPException(status_code=409, detail="only an empty draft can be an automatic recording")
    session = RecordingSession(
        demo_id=demo.id, organization_id=demo.organization_id, owner_id=user.id,
        status="active", mode=payload.mode, ai_enabled=payload.ai_enabled,
        auto_created=payload.auto_created,
        original_settings={
            "content_locale": demo.content_locale,
            "ai_context": demo.ai_context,
            "navigation": dict(demo.navigation or {}),
            "manual_fields": list(demo.manual_fields or []),
        },
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(db, session)


@router.post("/sessions/{session_id}/complete", response_model=RecordingSessionOut)
def complete_recording_session(
    session_id: str, db: Session = Depends(get_db), user: User = Depends(current_user),
):
    session = db.scalar(select(RecordingSession).where(RecordingSession.id == session_id, RecordingSession.owner_id == user.id))
    if not session:
        raise HTTPException(status_code=404, detail="recording session not found")
    if session.status == "cancelled":
        raise HTTPException(status_code=409, detail="recording session was cancelled")
    if session.status == "active":
        session.status = "completed"
        session.completed_at = datetime.now(timezone.utc)
        db.commit()
    return _session_out(db, session)


@router.post("/sessions/{session_id}/cancel", response_model=RecordingSessionOut)
def cancel_recording_session(
    session_id: str, request: Request,
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    session = db.scalar(select(RecordingSession).where(RecordingSession.id == session_id, RecordingSession.owner_id == user.id))
    if not session:
        raise HTTPException(status_code=404, detail="recording session not found")
    if session.status == "completed":
        raise HTTPException(status_code=409, detail="completed recording sessions cannot be cancelled")
    if session.status == "cancelled":
        return _session_out(db, session)
    demo = owned_demo(db, session.demo_id or "", user)
    steps = db.scalars(select(Step).where(Step.recording_session_id == session.id)).all()
    keys = {key for step in steps for key in (step.asset_key, step.dom_snapshot_key) if key}
    original = dict(session.original_settings or {})
    demo_label, demo_id, organization_id = demo.title, demo.id, demo.organization_id
    session.status = "cancelled"
    session.cancelled_at = datetime.now(timezone.utc)
    if session.auto_created:
        session.demo_id = None
        db.delete(demo)
    else:
        for step in steps:
            db.delete(step)
        db.flush()
        remaining = db.scalars(select(Step).where(Step.demo_id == demo.id).order_by(Step.position, Step.id)).all()
        for position, step in enumerate(remaining):
            step.position = position
        for field in ("content_locale", "ai_context", "navigation", "manual_fields"):
            if field in original:
                setattr(demo, field, original[field])
    write_audit(
        db, user, "recording.cancelled", "recording", demo_id, demo_label, organization_id,
        after={"session_id": session.id, "step_count": len(steps), "auto_created": session.auto_created},
        request=request, source="extension",
    )
    db.commit()
    for key in keys:
        referenced = db.scalar(select(Step.id).where(or_(Step.asset_key == key, Step.dom_snapshot_key == key)).limit(1))
        if not referenced:
            storage.delete(key)
    return _session_out(db, session)


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
    session = _active_session(db, parsed.recording_session_id, demo.id, user)
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
    # password_rect is accepted for compatibility with older extensions but
    # no longer becomes a permanent black bar. Native password bullets and
    # rrweb input masking already protect the value. Explicit redactions use
    # the dedicated field and remain available for intentional masking.
    redactions = [item.model_dump() for item in parsed.redactions]
    step = Step(
        demo_id=demo.id,
        recording_session_id=session.id if session else None,
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
    if parsed.ai_enabled and active_model(db) and step and not session:
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
    session = _active_session(db, parsed.recording_session_id, demo.id, user)
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
    # Ignore legacy automatic input rectangles; they drifted when screenshots
    # were scaled and produced misplaced black bars in published/PDF output.
    redactions = [item.model_dump() for item in parsed.redactions]
    safe_page_context = sanitize_page_context(parsed.page_context)
    if redactions:
        safe_page_context["explicit_redactions"] = True
    step = Step(
        demo_id=demo.id,
        recording_session_id=session.id if session else None,
        event_id=parsed.event_id,
        position=count,
        title=title,
        body=body,
        asset_key=image_key,
        # Authentication and secret-entry pages prioritize an exact, blanked
        # pixel capture. Keep the sanitized DOM snapshot available so an
        # editor can still opt into HTML mode after reviewing it.
        render_mode="image" if safe_page_context.get("sensitive_form") else ("dom" if snapshot_key else "image"),
        dom_snapshot_key=snapshot_key,
        viewport_width=parsed.viewport_width or width,
        viewport_height=parsed.viewport_height or height,
        hotspot=parsed.hotspot.model_dump() if parsed.hotspot else {},
        redactions=redactions,
        page_context=safe_page_context,
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
    if parsed.ai_enabled and active_model(db) and step and not session:
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
