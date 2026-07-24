from copy import deepcopy

from sqlalchemy.orm import Session

from app.models import Demo, Hotspot, Step, User


def clone_step(db: Session, source: Step, demo_id: str, position: int, *, event_id: str | None = None) -> Step:
    """Clone every editable step setting while reusing immutable capture assets."""
    step = Step(
        demo_id=demo_id,
        event_id=event_id or source.event_id,
        position=position,
        title=source.title,
        body=source.body,
        hotspot_mode=source.hotspot_mode or "independent",
        asset_key=source.asset_key,
        render_mode=source.render_mode,
        dom_snapshot_key=source.dom_snapshot_key,
        viewport_width=source.viewport_width,
        viewport_height=source.viewport_height,
        hotspot=deepcopy(source.hotspot or {}),
        redactions=deepcopy(source.redactions or []),
        page_context=deepcopy(source.page_context or {}),
        scroll_state=deepcopy(source.scroll_state or {}),
        capture_warnings=deepcopy(source.capture_warnings or []),
        manual_fields=deepcopy(source.manual_fields or []),
        ai_metadata=deepcopy(source.ai_metadata or {}),
        animation=deepcopy(source.animation or {}),
        duration=source.duration,
    )
    db.add(step)
    db.flush()
    for source_hotspot in source.hotspots:
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
    return step


def clone_demo(
    db: Session,
    source: Demo,
    owner: User,
    organization_id: str,
    *,
    keep_taxonomy: bool,
) -> Demo:
    """Create an editable draft that reuses immutable stored capture objects."""
    duplicate = Demo(
        owner_id=owner.id,
        organization_id=organization_id,
        title=f"{source.title}{' (Copy)' if source.content_locale == 'en' else '（副本）'}"[:200],
        description=source.description,
        ai_context=source.ai_context,
        content_locale=source.content_locale,
        theme=deepcopy(source.theme or {}),
        navigation=deepcopy(source.navigation or {}),
        playback=deepcopy(source.playback or {}),
        category_id=source.category_id if keep_taxonomy else None,
        manual_fields=sorted(set(source.manual_fields or []) | {"title"}),
    )
    db.add(duplicate)
    duplicate.tags = list(source.tags) if keep_taxonomy else []
    db.flush()
    for source_step in sorted(source.steps, key=lambda item: item.position):
        clone_step(db, source_step, duplicate.id, source_step.position)
    return duplicate
