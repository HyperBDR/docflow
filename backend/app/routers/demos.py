import secrets
from copy import deepcopy
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
import io

from app.database import get_db
from app.dependencies import current_user
from app.models import Category, Demo, DemoStatus, Hotspot, PublishedRevision, ShareToken, Step, Tag, User
from app.schemas import DemoCreate, DemoOut, DemoUpdate, MergeDemos, StepOut, StepUpdate
from app.services import active_share, demo_out, next_revision_number, owned_demo, step_out
from app.storage import storage
from app.snapshots import SnapshotError, load_snapshot

router = APIRouter(prefix="/api/demos", tags=["demos"])


@router.get("", response_model=list[DemoOut])
def list_demos(db: Session = Depends(get_db), user: User = Depends(current_user)):
    demos = db.scalars(select(Demo).where(Demo.owner_id == user.id).order_by(Demo.updated_at.desc())).all()
    return [demo_out(db, demo, include_steps=False) for demo in demos]


@router.post("", response_model=DemoOut, status_code=201)
def create_demo(payload: DemoCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    manual_fields = []
    if payload.title != "未命名演示":
        manual_fields.append("title")
    if payload.description:
        manual_fields.append("description")
    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if not category or category.owner_id != user.id:
            raise HTTPException(status_code=400, detail="category not found")
    demo = Demo(owner_id=user.id, title=payload.title, description=payload.description, category_id=payload.category_id, manual_fields=manual_fields)
    db.add(demo)
    db.commit()
    db.refresh(demo)
    return demo_out(db, demo)


@router.get("/{demo_id}", response_model=DemoOut)
def get_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return demo_out(db, owned_demo(db, demo_id, user))


@router.patch("/{demo_id}", response_model=DemoOut)
def update_demo(payload: DemoUpdate, demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    values = payload.model_dump(exclude_unset=True)
    tag_ids = values.pop("tag_ids", None)
    if "category_id" in values and values["category_id"]:
        category = db.get(Category, values["category_id"])
        if not category or category.owner_id != user.id:
            raise HTTPException(status_code=400, detail="category not found")
    if tag_ids is not None:
        tags = db.scalars(select(Tag).where(Tag.owner_id == user.id, Tag.id.in_(tag_ids))).all() if tag_ids else []
        if len(tags) != len(set(tag_ids)):
            raise HTTPException(status_code=400, detail="one or more tags were not found")
        demo.tags = list(tags)
    for key, value in values.items():
        setattr(demo, key, value)
    demo.manual_fields = sorted(set(demo.manual_fields or []) | set(values))
    db.commit()
    return demo_out(db, demo)


@router.delete("/{demo_id}", status_code=204)
def delete_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.delete(owned_demo(db, demo_id, user))
    db.commit()


@router.post("/{demo_id}/duplicate", response_model=DemoOut, status_code=201)
def duplicate_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    source = owned_demo(db, demo_id, user)
    duplicate = Demo(
        owner_id=user.id,
        title=f"{source.title}（副本）"[:200],
        description=source.description,
        theme=deepcopy(source.theme or {}),
        navigation=deepcopy(source.navigation or {}),
        playback=deepcopy(source.playback or {}),
        category_id=source.category_id,
        manual_fields=sorted(set(source.manual_fields or []) | {"title"}),
    )
    db.add(duplicate)
    duplicate.tags = list(source.tags)
    db.flush()
    for source_step in sorted(source.steps, key=lambda item: item.position):
        step = Step(
            demo_id=duplicate.id,
            event_id=source_step.event_id,
            position=source_step.position,
            title=source_step.title,
            body=source_step.body,
            asset_key=source_step.asset_key,
            render_mode=source_step.render_mode,
            dom_snapshot_key=source_step.dom_snapshot_key,
            viewport_width=source_step.viewport_width,
            viewport_height=source_step.viewport_height,
            hotspot=deepcopy(source_step.hotspot or {}),
            redactions=deepcopy(source_step.redactions or []),
            page_context=deepcopy(source_step.page_context or {}),
            scroll_state=deepcopy(source_step.scroll_state or {}),
            capture_warnings=deepcopy(source_step.capture_warnings or []),
            manual_fields=deepcopy(source_step.manual_fields or []),
            ai_metadata=deepcopy(source_step.ai_metadata or {}),
            animation=deepcopy(source_step.animation or {}),
            duration=source_step.duration,
        )
        db.add(step)
        db.flush()
        for source_hotspot in source_step.hotspots:
            db.add(Hotspot(
                step_id=step.id,
                position=source_hotspot.position,
                selector=deepcopy(source_hotspot.selector or {}),
                fallback_rect=deepcopy(source_hotspot.fallback_rect or {}),
                trigger=source_hotspot.trigger,
                action=deepcopy(source_hotspot.action or {}),
                tooltip=deepcopy(source_hotspot.tooltip or {}),
                style=deepcopy(source_hotspot.style or {}),
                manual_fields=deepcopy(source_hotspot.manual_fields or []),
            ))
    db.commit()
    db.refresh(duplicate)
    return demo_out(db, duplicate)


def copy_steps(db: Session, source: Demo, target: Demo, start: int) -> int:
    position = start
    for source_step in sorted(source.steps, key=lambda item: item.position):
        step = Step(
            demo_id=target.id, event_id=f"merge-{source.id[:8]}-{source_step.event_id}"[:64], position=position,
            title=source_step.title, body=source_step.body, asset_key=source_step.asset_key,
            render_mode=source_step.render_mode, dom_snapshot_key=source_step.dom_snapshot_key,
            viewport_width=source_step.viewport_width, viewport_height=source_step.viewport_height,
            hotspot=deepcopy(source_step.hotspot or {}), redactions=deepcopy(source_step.redactions or []),
            page_context=deepcopy(source_step.page_context or {}), scroll_state=deepcopy(source_step.scroll_state or {}),
            capture_warnings=deepcopy(source_step.capture_warnings or []), manual_fields=deepcopy(source_step.manual_fields or []),
            ai_metadata=deepcopy(source_step.ai_metadata or {}), animation=deepcopy(source_step.animation or {}), duration=source_step.duration,
        )
        db.add(step); db.flush()
        for source_hotspot in source_step.hotspots:
            action = deepcopy(source_hotspot.action or {})
            # A cross-demo target/end cannot be preserved safely; merged steps continue linearly.
            if action.get("type") in {"goto", "end"}: action = {"type": "next"}
            db.add(Hotspot(
                step_id=step.id, position=source_hotspot.position, selector=deepcopy(source_hotspot.selector or {}),
                fallback_rect=deepcopy(source_hotspot.fallback_rect or {}), trigger=source_hotspot.trigger,
                action=action, tooltip=deepcopy(source_hotspot.tooltip or {}), style=deepcopy(source_hotspot.style or {}),
                manual_fields=deepcopy(source_hotspot.manual_fields or []),
            ))
        position += 1
    return position


@router.post("/merge", response_model=DemoOut, status_code=201)
def merge_demos(payload: MergeDemos, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if len(set(payload.demo_ids)) != len(payload.demo_ids):
        raise HTTPException(status_code=400, detail="demo_ids must be unique")
    sources = [owned_demo(db, demo_id, user) for demo_id in payload.demo_ids]
    if not all(source.steps for source in sources):
        raise HTTPException(status_code=400, detail="empty demos cannot be merged")
    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if not category or category.owner_id != user.id:
            raise HTTPException(status_code=400, detail="category not found")
    first = sources[0]
    merged = Demo(
        owner_id=user.id, title=payload.title, description=f"由 {len(sources)} 个演示合并生成",
        category_id=payload.category_id or first.category_id, theme=deepcopy(first.theme or {}),
        navigation=deepcopy(first.navigation or {}), playback=deepcopy(first.playback or {}), manual_fields=["title"],
    )
    db.add(merged); db.flush()
    merged.tags = list({tag.id: tag for source in sources for tag in source.tags}.values())
    position = 0
    for source in sources:
        position = copy_steps(db, source, merged, position)
    db.commit(); db.refresh(merged)
    return demo_out(db, merged)


@router.patch("/{demo_id}/steps/{step_id}", response_model=StepOut)
def update_step(payload: StepUpdate, demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step:
        raise HTTPException(status_code=404, detail="step not found")
    values = payload.model_dump(exclude_unset=True)
    if "hotspot" in values:
        values["hotspot"] = payload.hotspot.model_dump()
    if "redactions" in values:
        values["redactions"] = [item.model_dump() for item in payload.redactions or []]
    for key, value in values.items():
        setattr(step, key, value)
    step.manual_fields = sorted(set(step.manual_fields or []) | (set(values) - {"position"}))
    if "position" in values:
        ordered = sorted(demo.steps, key=lambda item: (item.position, item.id))
        for position, item in enumerate(ordered):
            item.position = position
    db.commit()
    return step_out(step, demo.id)


@router.delete("/{demo_id}/steps/{step_id}", status_code=204)
def delete_step(demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step:
        raise HTTPException(status_code=404, detail="step not found")
    db.delete(step)
    db.flush()
    remaining = db.scalars(select(Step).where(Step.demo_id == demo.id).order_by(Step.position)).all()
    for position, item in enumerate(remaining):
        item.position = position
    db.commit()


@router.get("/{demo_id}/steps/{step_id}/image")
def step_image(demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step or not storage.exists(step.asset_key):
        raise HTTPException(status_code=404, detail="image not found")
    return StreamingResponse(io.BytesIO(storage.read(step.asset_key)), media_type="image/webp")


@router.get("/{demo_id}/steps/{step_id}/snapshot")
def step_snapshot(demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step or not step.dom_snapshot_key:
        raise HTTPException(status_code=404, detail="DOM snapshot not found")
    try:
        return JSONResponse(load_snapshot(step.dom_snapshot_key), headers={"Cache-Control": "private, no-store"})
    except SnapshotError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{demo_id}/publish", response_model=DemoOut)
def publish_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    if not demo.steps:
        raise HTTPException(status_code=400, detail="cannot publish an empty demo")
    revision_id = secrets.token_hex(18)
    steps = []
    for step in sorted(demo.steps, key=lambda item: item.position):
        public_key = f"assets/published/{revision_id}/{step.id}.webp"
        storage.rendered_asset(step.asset_key, step.redactions, public_key)
        hotspots = [{
            "id": item.id, "position": item.position, "selector": item.selector,
            "fallback_rect": item.fallback_rect, "trigger": item.trigger,
            "action": item.action, "tooltip": item.tooltip, "style": item.style,
        } for item in step.hotspots]
        if not hotspots and step.hotspot:
            hotspots = [{
                "id": f"legacy-{step.id}", "position": 0, "selector": {},
                "fallback_rect": step.hotspot, "trigger": "click", "action": {"type": "next"},
                "tooltip": {"content": step.body, "placement": "auto", "offset": 12}, "style": {},
            }]
        steps.append({
            "id": step.id, "position": step.position, "title": step.title, "body": step.body,
            "viewport_width": step.viewport_width, "viewport_height": step.viewport_height,
            "hotspot": step.hotspot, "hotspots": hotspots, "duration": step.duration,
            "asset_key": public_key, "render_mode": step.render_mode,
            "dom_snapshot_key": step.dom_snapshot_key, "scroll_state": step.scroll_state,
            "animation": step.animation or {},
        })
    revision = PublishedRevision(
        id=revision_id,
        demo_id=demo.id,
        number=next_revision_number(db, demo.id),
        snapshot={
            "title": demo.title, "description": demo.description, "steps": steps,
            "theme": demo.theme, "navigation": demo.navigation, "playback": demo.playback,
        },
    )
    db.add(revision)
    db.flush()
    share = active_share(db, demo.id)
    if share:
        share.revision_id = revision.id
    else:
        share = ShareToken(demo_id=demo.id, revision_id=revision.id, token=secrets.token_urlsafe(24))
        db.add(share)
    demo.current_revision_id = revision.id
    demo.status = DemoStatus.published
    db.commit()
    return demo_out(db, demo)


@router.post("/{demo_id}/revoke", response_model=DemoOut)
def revoke_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    share = active_share(db, demo.id)
    if share:
        share.revoked = True
    demo.status = DemoStatus.draft
    db.commit()
    return demo_out(db, demo)
