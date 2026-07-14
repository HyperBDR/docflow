from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
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


@router.post("/{demo_id}/steps/{step_id}/hotspots", response_model=HotspotOut, status_code=201)
def create_hotspot(payload: HotspotCreate, demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    step = owned_step(db, demo_id, step_id, user)
    count = db.scalar(select(func.count()).select_from(Hotspot).where(Hotspot.step_id == step.id)) or 0
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
    item = db.scalar(select(Hotspot).where(Hotspot.id == hotspot_id, Hotspot.step_id == step.id))
    if not item:
        raise HTTPException(status_code=404, detail="hotspot not found")
    values = payload.model_dump(exclude_unset=True)
    for field in ["selector", "fallback_rect", "action", "tooltip", "style"]:
        value = getattr(payload, field)
        if field in values and value is not None:
            values[field] = value.model_dump(exclude_none=True)
    for key, value in values.items():
        setattr(item, key, value)
    item.manual_fields = sorted(set(item.manual_fields or []) | set(values))
    db.commit()
    return item


@router.delete("/{demo_id}/steps/{step_id}/hotspots/{hotspot_id}", status_code=204)
def delete_hotspot(demo_id: str, step_id: str, hotspot_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    step = owned_step(db, demo_id, step_id, user)
    item = db.scalar(select(Hotspot).where(Hotspot.id == hotspot_id, Hotspot.step_id == step.id))
    if not item:
        raise HTTPException(status_code=404, detail="hotspot not found")
    db.delete(item)
    db.flush()
    remaining = db.scalars(select(Hotspot).where(Hotspot.step_id == step.id).order_by(Hotspot.position)).all()
    for position, hotspot in enumerate(remaining):
        hotspot.position = position
    db.commit()
