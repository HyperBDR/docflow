from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Demo, PublishedRevision, ShareToken, Step, User
from app.schemas import DemoOut, StepOut


def owned_demo(db: Session, demo_id: str, user: User) -> Demo:
    demo = db.get(Demo, demo_id)
    if not demo or demo.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="demo not found")
    return demo


def active_share(db: Session, demo_id: str) -> ShareToken | None:
    return db.scalar(
        select(ShareToken)
        .where(ShareToken.demo_id == demo_id, ShareToken.revoked.is_(False))
        .order_by(ShareToken.created_at.desc())
    )


def step_out(step: Step, demo_id: str) -> StepOut:
    result = StepOut.model_validate(step)
    result.image_url = f"{settings.public_base_url}/api/demos/{demo_id}/steps/{step.id}/image"
    return result


def demo_out(db: Session, demo: Demo, include_steps: bool = True) -> DemoOut:
    share = active_share(db, demo.id)
    return DemoOut(
        id=demo.id,
        title=demo.title,
        description=demo.description,
        status=demo.status.value,
        created_at=demo.created_at,
        updated_at=demo.updated_at,
        steps=[step_out(step, demo.id) for step in demo.steps] if include_steps else [],
        share_url=f"{settings.web_origin}/p/{share.token}" if share else None,
    )


def next_revision_number(db: Session, demo_id: str) -> int:
    value = db.scalar(select(func.max(PublishedRevision.number)).where(PublishedRevision.demo_id == demo_id))
    return (value or 0) + 1

