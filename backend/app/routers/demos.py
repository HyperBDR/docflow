import secrets
from copy import deepcopy
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session
import io

from app.config import settings
from app.database import get_db
from app.defaults import navigation_defaults
from app.dependencies import current_user
from app.models import Category, Demo, DemoStatus, Hotspot, PublishedRevision, ShareToken, Step, Tag, User
from app.schemas import DemoCreate, DemoOut, DemoUpdate, MergeDemos, ShareLinkCreate, ShareLinkUpdate, StepOut, StepUpdate
from app.security import hash_password
from app.quota import enforce
from app.services import active_share, current_organization_id, demo_out, next_revision_number, owned_demo, require_organization_role, step_out, viewable_demo, write_audit
from app.storage import storage
from app.quota_estimates import estimate_publish_bytes

router = APIRouter(prefix="/api/demos", tags=["demos"])


@router.get("", response_model=list[DemoOut])
def list_demos(db: Session = Depends(get_db), user: User = Depends(current_user)):
    organization_id = current_organization_id(db, user)
    demos = db.scalars(select(Demo).where(
        Demo.organization_id == organization_id, Demo.deleted_at.is_(None)
    ).order_by(Demo.updated_at.desc())).all()
    return [demo_out(db, demo, include_steps=False) for demo in demos]


@router.post("", response_model=DemoOut, status_code=201)
def create_demo(payload: DemoCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    organization_id = current_organization_id(db, user)
    enforce(db, organization_id, "resources")
    require_organization_role(db, user, organization_id, {"owner", "admin", "editor"})
    manual_fields = []
    if payload.title != "未命名演示" and not payload.auto_title:
        manual_fields.append("title")
    if payload.description:
        manual_fields.append("description")
    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if not category or category.organization_id != organization_id:
            raise HTTPException(status_code=400, detail="category not found")
    demo = Demo(
        owner_id=user.id, organization_id=organization_id, title=payload.title, description=payload.description,
        ai_context=payload.ai_context.strip(),
        content_locale=payload.content_locale, navigation=navigation_defaults(payload.content_locale),
        category_id=payload.category_id, manual_fields=manual_fields,
    )
    db.add(demo)
    db.commit()
    db.refresh(demo)
    return demo_out(db, demo)


@router.get("/{demo_id}", response_model=DemoOut)
def get_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return demo_out(db, viewable_demo(db, demo_id, user))


@router.patch("/{demo_id}", response_model=DemoOut)
def update_demo(payload: DemoUpdate, demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    values = payload.model_dump(exclude_unset=True)
    if "ai_context" in values:
        values["ai_context"] = (values["ai_context"] or "").strip()
    tag_ids = values.pop("tag_ids", None)
    if values.get("content_locale") and values["content_locale"] != demo.content_locale:
        # Preserve all visible content when only the future AI language changes.
        current_navigation = dict(demo.navigation or {})
        old_defaults = navigation_defaults(demo.content_locale)
        current_navigation.setdefault("previous_label", old_defaults["previous_label"])
        current_navigation.setdefault("next_label", old_defaults["next_label"])
        demo.navigation = current_navigation
    if "category_id" in values and values["category_id"]:
        category = db.get(Category, values["category_id"])
        if not category or category.organization_id != demo.organization_id:
            raise HTTPException(status_code=400, detail="category not found")
    if tag_ids is not None:
        tags = db.scalars(select(Tag).where(Tag.organization_id == demo.organization_id, Tag.id.in_(tag_ids))).all() if tag_ids else []
        if len(tags) != len(set(tag_ids)):
            raise HTTPException(status_code=400, detail="one or more tags were not found")
        demo.tags = list(tags)
    for key, value in values.items():
        setattr(demo, key, value)
    demo.manual_fields = sorted(set(demo.manual_fields or []) | set(values))
    db.commit()
    return demo_out(db, demo)


@router.delete("/{demo_id}", status_code=204)
def delete_demo(demo_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    demo.deleted_at = datetime.now(timezone.utc)
    demo.deleted_by_id = user.id
    db.execute(update(ShareToken).where(ShareToken.demo_id == demo.id).values(revoked=True))
    write_audit(db, user, "resource.deleted", "resource", demo.id, demo.title, demo.organization_id, request=request)
    db.commit()


@router.post("/{demo_id}/duplicate", response_model=DemoOut, status_code=201)
def duplicate_demo(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    source = owned_demo(db, demo_id, user)
    enforce(db, source.organization_id, "resources")
    enforce(db, source.organization_id, "max_steps_per_resource", len(source.steps), current=0)
    duplicate = Demo(
        owner_id=user.id,
        organization_id=source.organization_id,
        title=f"{source.title}{' (Copy)' if source.content_locale == 'en' else '（副本）'}"[:200],
        description=source.description,
        ai_context=source.ai_context,
        content_locale=source.content_locale,
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
    first = sources[0]
    if any(source.organization_id != first.organization_id for source in sources):
        raise HTTPException(status_code=400, detail="demos must belong to the same organization")
    enforce(db, first.organization_id, "resources")
    enforce(db, first.organization_id, "max_steps_per_resource", sum(len(source.steps) for source in sources), current=0)
    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if not category or category.organization_id != first.organization_id:
            raise HTTPException(status_code=400, detail="category not found")
    merged = Demo(
        owner_id=user.id, organization_id=first.organization_id, title=payload.title,
        description=(f"Merged from {len(sources)} demos" if first.content_locale == "en" else f"由 {len(sources)} 个演示合并生成"),
        ai_context=first.ai_context,
        content_locale=first.content_locale,
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
    demo = viewable_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step or not storage.exists(step.asset_key):
        raise HTTPException(status_code=404, detail="image not found")
    direct = storage.direct_url(step.asset_key)
    if direct: return RedirectResponse(direct, status_code=307, headers={"Cache-Control": "private, no-store"})
    return StreamingResponse(io.BytesIO(storage.read(step.asset_key)), media_type="image/webp")


@router.get("/{demo_id}/steps/{step_id}/snapshot")
def step_snapshot(demo_id: str, step_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = viewable_demo(db, demo_id, user)
    step = db.scalar(select(Step).where(Step.id == step_id, Step.demo_id == demo.id))
    if not step or not step.dom_snapshot_key:
        raise HTTPException(status_code=404, detail="DOM snapshot not found")
    if not storage.exists(step.dom_snapshot_key):
        raise HTTPException(status_code=404, detail="DOM snapshot not found")
    version = step.dom_snapshot_key.rsplit("/", 1)[-1].split(".", 1)[0]
    return Response(
        content=storage.read(step.dom_snapshot_key), media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "private, max-age=300", "ETag": f'"{version}"'},
    )


@router.post("/{demo_id}/publish", response_model=DemoOut)
def publish_demo(demo_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    if not demo.steps:
        raise HTTPException(status_code=400, detail="cannot publish an empty demo")
    if not active_share(db, demo.id):
        enforce(db, demo.organization_id, "active_shares")
    enforce(db, demo.organization_id, "storage_bytes", estimate_publish_bytes(demo))
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
            # Public playback only needs the visual fallback geometry. Do not
            # publish captured page text or source URLs with the revision.
            "page_context": {"raster_regions": (step.page_context or {}).get("raster_regions", [])},
            "capture_warnings": step.capture_warnings,
            "animation": step.animation or {},
        })
    revision = PublishedRevision(
        id=revision_id,
        demo_id=demo.id,
        number=next_revision_number(db, demo.id),
        snapshot={
            "title": demo.title, "description": demo.description, "steps": steps,
            "content_locale": demo.content_locale,
            "theme": demo.theme, "navigation": {**navigation_defaults(demo.content_locale), **(demo.navigation or {})}, "playback": demo.playback,
        },
    )
    db.add(revision)
    db.flush()
    shares = db.scalars(select(ShareToken).where(ShareToken.demo_id == demo.id, ShareToken.revoked.is_(False))).all()
    for share in shares:
        share.revision_id = revision.id
    if not active_share(db, demo.id):
        share = ShareToken(
            demo_id=demo.id, revision_id=revision.id, token=secrets.token_urlsafe(24),
            name="Default link", created_by_id=user.id,
        )
        db.add(share)
    demo.current_revision_id = revision.id
    demo.status = DemoStatus.published
    write_audit(db, user, "resource.published", "resource", demo.id, demo.title, demo.organization_id,
                after={"revision_id": revision.id, "share_count": max(1, len(shares))}, request=request)
    db.commit()
    return demo_out(db, demo)


@router.post("/{demo_id}/revoke", response_model=DemoOut)
def revoke_demo(demo_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    db.execute(update(ShareToken).where(ShareToken.demo_id == demo.id).values(revoked=True))
    demo.status = DemoStatus.draft
    write_audit(db, user, "resource.unpublished", "resource", demo.id, demo.title, demo.organization_id, request=request)
    db.commit()
    return demo_out(db, demo)


def share_link_out(db: Session, share: ShareToken) -> dict:
    creator = db.get(User, share.created_by_id) if share.created_by_id else None
    expired = bool(share.expires_at and share.expires_at <= datetime.now(timezone.utc))
    return {
        "id": share.id, "name": share.name or "", "url": f"{settings.web_origin.rstrip('/')}/p/{share.token}",
        "token": share.token, "revoked": share.revoked, "expired": expired,
        "password_protected": bool(share.password_hash), "expires_at": share.expires_at,
        "access_count": share.access_count, "last_accessed_at": share.last_accessed_at,
        "created_by": ({"id": creator.id, "name": creator.name or "", "email": creator.email} if creator else None),
        "created_at": share.created_at,
    }


@router.get("/{demo_id}/shares")
def list_share_links(demo_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = viewable_demo(db, demo_id, user)
    return [share_link_out(db, item) for item in db.scalars(select(ShareToken).where(
        ShareToken.demo_id == demo.id
    ).order_by(ShareToken.created_at.desc())).all()]


@router.post("/{demo_id}/shares", status_code=201)
def create_share_link(payload: ShareLinkCreate, demo_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    if not demo.current_revision_id:
        raise HTTPException(status_code=400, detail="publish the demo before creating a share link")
    if payload.expires_at and payload.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="expiration must be in the future")
    enforce(db, demo.organization_id, "active_shares")
    share = ShareToken(
        demo_id=demo.id, revision_id=demo.current_revision_id, token=secrets.token_urlsafe(24),
        name=payload.name.strip(), created_by_id=user.id, expires_at=payload.expires_at,
        password_hash=hash_password(payload.password) if payload.password else None,
    )
    db.add(share); db.flush()
    write_audit(db, user, "share.created", "share", share.id, share.name or demo.title, demo.organization_id,
                after={"demo_id": demo.id, "expires_at": payload.expires_at.isoformat() if payload.expires_at else None, "password_protected": bool(payload.password)}, request=request)
    db.commit(); db.refresh(share)
    return share_link_out(db, share)


@router.patch("/{demo_id}/shares/{share_id}")
def update_share_link(payload: ShareLinkUpdate, demo_id: str, share_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    demo = owned_demo(db, demo_id, user)
    share = db.scalar(select(ShareToken).where(ShareToken.id == share_id, ShareToken.demo_id == demo.id))
    if not share:
        raise HTTPException(status_code=404, detail="share link not found")
    before = {"name": share.name, "expires_at": share.expires_at.isoformat() if share.expires_at else None, "revoked": share.revoked, "password_protected": bool(share.password_hash)}
    current = datetime.now(timezone.utc)
    previous_expiry = share.expires_at if not share.expires_at or share.expires_at.tzinfo else share.expires_at.replace(tzinfo=timezone.utc)
    was_active = not share.revoked and (previous_expiry is None or previous_expiry > current)
    values = payload.model_dump(exclude_unset=True)
    if "name" in values: share.name = (values["name"] or "").strip()
    if "expires_at" in values: share.expires_at = values["expires_at"]
    if "password" in values: share.password_hash = hash_password(values["password"]) if values["password"] else None
    if "revoked" in values: share.revoked = values["revoked"]
    next_expiry = share.expires_at if not share.expires_at or share.expires_at.tzinfo else share.expires_at.replace(tzinfo=timezone.utc)
    will_be_active = not share.revoked and (next_expiry is None or next_expiry > current)
    if not was_active and will_be_active:
        enforce(db, demo.organization_id, "active_shares")
    write_audit(db, user, "share.updated", "share", share.id, share.name or demo.title, demo.organization_id,
                before=before, after={"name": share.name, "expires_at": share.expires_at.isoformat() if share.expires_at else None, "revoked": share.revoked, "password_protected": bool(share.password_hash)}, request=request)
    db.commit(); db.refresh(share)
    return share_link_out(db, share)
