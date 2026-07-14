import secrets
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
import io

from app.database import get_db
from app.dependencies import current_user
from app.models import Demo, DemoStatus, PublishedRevision, ShareToken, Step, User
from app.schemas import DemoCreate, DemoOut, DemoUpdate, StepOut, StepUpdate
from app.services import active_share, demo_out, next_revision_number, owned_demo, step_out
from app.storage import storage

router = APIRouter(prefix="/api/demos", tags=["demos"])


@router.get("", response_model=list[DemoOut])
def list_demos(db: Session = Depends(get_db), user: User = Depends(current_user)):
    demos = db.scalars(select(Demo).where(Demo.owner_id == user.id).order_by(Demo.updated_at.desc())).all()
    return [demo_out(db, demo, include_steps=False) for demo in demos]


@router.post("", response_model=DemoOut, status_code=201)
def create_demo(payload: DemoCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = Demo(owner_id=user.id, title=payload.title, description=payload.description)
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
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(demo, key, value)
    db.commit()
    return demo_out(db, demo)


@router.delete("/{demo_id}", status_code=204)
def delete_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.delete(owned_demo(db, demo_id, user))
    db.commit()


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
        steps.append({
            "id": step.id, "position": step.position, "title": step.title, "body": step.body,
            "viewport_width": step.viewport_width, "viewport_height": step.viewport_height,
            "hotspot": step.hotspot, "duration": step.duration, "asset_key": public_key,
        })
    revision = PublishedRevision(
        id=revision_id,
        demo_id=demo.id,
        number=next_revision_number(db, demo.id),
        snapshot={"title": demo.title, "description": demo.description, "steps": steps},
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

