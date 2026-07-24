from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.defaults import DEFAULT_HOTSPOT_STYLE, DEFAULT_TOOLTIP
from app.dependencies import current_user
from app.models import Hotspot, Step, User
from app.schemas import HotspotCreate, HotspotOut, HotspotUpdate
from app.services import owned_demo

router = APIRouter(prefix="/api/demos", tags=["interactions"])


def owned_step(db: Session, demo_id: str, step_id: str, user: User) -> Step:
    demo = owned_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step:
        raise HTTPException(status_code=404, detail="step not found")
    return step


def materialize_legacy_hotspot(db: Session, step: Step) -> Hotspot | None:
    """Turn the old Step.hotspot value into an editable database row."""
    if not step.hotspot:
        return None
    existing = db.scalars(select(Hotspot).where(Hotspot.step_id == step.id).order_by(Hotspot.position)).all()
    for item in existing:
        item.position += 1
    item = Hotspot(
        step_id=step.id,
        position=0,
        selector={},
        fallback_rect=dict(step.hotspot),
        trigger="click",
        action={"type": "next"},
        tooltip={**DEFAULT_TOOLTIP, "content": step.body or ""},
        style=dict(DEFAULT_HOTSPOT_STYLE),
        manual_fields=[],
    )
    db.add(item)
    db.flush()
    return item


def editable_hotspot(db: Session, step: Step, hotspot_id: str) -> Hotspot | None:
    item = db.scalar(select(Hotspot).where(Hotspot.id == hotspot_id, Hotspot.step_id == step.id))
    if item or hotspot_id != f"legacy-{step.id}":
        return item
    primary = db.scalar(select(Hotspot).where(Hotspot.step_id == step.id).order_by(Hotspot.position))
    # A matching primary row was already produced by a migration or a newer
    # upload. If it differs, an old browser tab is still showing a distinct
    # synthetic hotspot alongside newly created rows, so preserve both.
    if primary and dict(primary.fallback_rect or {}) == dict(step.hotspot or {}):
        return primary
    return materialize_legacy_hotspot(db, step)


@router.post("/{demo_id}/steps/{step_id}/hotspots", response_model=HotspotOut, status_code=201)
def create_hotspot(payload: HotspotCreate, demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    step = owned_step(db, demo_id, step_id, user)
    count = db.scalar(select(func.count()).select_from(Hotspot).where(Hotspot.step_id == step.id)) or 0
    # Older screenshot uploads exposed Step.hotspot as a synthetic `legacy-*`
    # item. Persist it before adding another hotspot so it does not disappear
    # on refresh and so the new item remains scoped to this step.
    primary = db.scalar(select(Hotspot).where(Hotspot.step_id == step.id).order_by(Hotspot.position))
    if step.hotspot and (not primary or dict(primary.fallback_rect or {}) != dict(step.hotspot)):
        materialize_legacy_hotspot(db, step)
        count += 1
    if count >= 10:
        raise HTTPException(status_code=400, detail="hotspot limit reached")
    item = Hotspot(
        step_id=step.id, position=count, selector=payload.selector.model_dump(exclude_none=True),
        fallback_rect=payload.fallback_rect.model_dump(), trigger=payload.trigger,
        action=payload.action.model_dump(exclude_none=True), tooltip=payload.tooltip.model_dump(),
        style=payload.style.model_dump(), manual_fields=["selector", "fallback_rect", "trigger", "action", "tooltip", "style"],
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{demo_id}/steps/{step_id}/hotspots/{hotspot_id}", response_model=HotspotOut)
def update_hotspot(payload: HotspotUpdate, demo_id: str, step_id: str, hotspot_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    step = owned_step(db, demo_id, step_id, user)
    item = editable_hotspot(db, step, hotspot_id)
    if not item:
        raise HTTPException(status_code=404, detail="hotspot not found")
    values = payload.model_dump(exclude_unset=True)
    for field in ["selector", "fallback_rect", "action", "tooltip", "style"]:
        value = getattr(payload, field)
        if field in values and value is not None:
            values[field] = value.model_dump(exclude_none=True)
    requested_position = values.pop("position", None)
    for key, value in values.items():
        setattr(item, key, value)
    if requested_position is not None:
        ordered = list(db.scalars(
            select(Hotspot).where(Hotspot.step_id == step.id).order_by(Hotspot.position, Hotspot.id)
        ).all())
        ordered = [hotspot for hotspot in ordered if hotspot.id != item.id]
        target = max(0, min(len(ordered), requested_position))
        ordered.insert(target, item)
        for position, hotspot in enumerate(ordered):
            hotspot.position = position
        step.hotspot = dict(ordered[0].fallback_rect or {}) if ordered else {}
    if item.position == 0 and "fallback_rect" in values:
        step.hotspot = dict(item.fallback_rect)
    item.manual_fields = sorted(set(item.manual_fields or []) | set(values) | ({"position"} if requested_position is not None else set()))
    db.commit()
    return item


@router.delete("/{demo_id}/steps/{step_id}/hotspots/{hotspot_id}", status_code=204)
def delete_hotspot(demo_id: str, step_id: str, hotspot_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    step = owned_step(db, demo_id, step_id, user)
    item = editable_hotspot(db, step, hotspot_id)
    if not item:
        raise HTTPException(status_code=404, detail="hotspot not found")
    db.delete(item)
    db.flush()
    remaining = db.scalars(select(Hotspot).where(Hotspot.step_id == step.id).order_by(Hotspot.position)).all()
    for position, hotspot in enumerate(remaining):
        hotspot.position = position
    # Clearing the compatibility field is essential when the last persisted
    # hotspot is removed; otherwise step_out() recreates a ghost legacy item.
    step.hotspot = dict(remaining[0].fallback_rect) if remaining else {}
    db.commit()
