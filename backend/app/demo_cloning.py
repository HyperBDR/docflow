from copy import deepcopy

from sqlalchemy.orm import Session

from app.models import Demo, Hotspot, Step, User


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
    return duplicate
