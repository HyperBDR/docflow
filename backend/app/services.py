from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.defaults import DEFAULT_PLAYBACK, DEFAULT_THEME, DEFAULT_TOOLTIP, DEFAULT_HOTSPOT_STYLE, navigation_defaults
from app.models import Demo, PublishedRevision, ShareToken, Step, User
from app.schemas import DemoOut, HotspotOut, StepOut


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
    result.snapshot_url = (
        f"{settings.public_base_url}/api/demos/{demo_id}/steps/{step.id}/snapshot"
        if step.dom_snapshot_key else None
    )
    result.hotspots = [HotspotOut.model_validate(item) for item in step.hotspots]
    if not result.hotspots and step.hotspot:
        result.hotspots = [HotspotOut(
            id=f"legacy-{step.id}", position=0, selector={}, fallback_rect=step.hotspot,
            trigger="click", action={"type": "next"}, tooltip=DEFAULT_TOOLTIP,
            style=DEFAULT_HOTSPOT_STYLE,
        )]
    return result


def demo_out(db: Session, demo: Demo, include_steps: bool = True) -> DemoOut:
    share = active_share(db, demo.id)
    first_step = min(demo.steps, key=lambda item: item.position, default=None)
    return DemoOut(
        id=demo.id,
        title=demo.title,
        description=demo.description,
        content_locale=demo.content_locale or "zh-CN",
        status=demo.status.value,
        created_at=demo.created_at,
        updated_at=demo.updated_at,
        steps=[step_out(step, demo.id) for step in demo.steps] if include_steps else [],
        thumbnail_url=(
            f"{settings.public_base_url}/api/demos/{demo.id}/steps/{first_step.id}/image"
            if first_step else None
        ),
        share_url=f"{settings.web_origin}/p/{share.token}" if share else None,
        theme={**DEFAULT_THEME, **(demo.theme or {})},
        navigation={**navigation_defaults(demo.content_locale), **(demo.navigation or {})},
        playback={**DEFAULT_PLAYBACK, **(demo.playback or {})},
        manual_fields=demo.manual_fields or [],
        ai_enabled=settings.ai_enabled and bool(settings.ai_api_key),
        category_id=demo.category_id,
        tags=demo.tags,
    )


def next_revision_number(db: Session, demo_id: str) -> int:
    value = db.scalar(select(func.max(PublishedRevision.number)).where(PublishedRevision.demo_id == demo_id))
    return (value or 0) + 1
