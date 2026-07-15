from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import AnalyticsEvent, Category, Demo, StepComment, Tag, User
from app.schemas import CategoryCreate, CategoryOut, CategoryUpdate, CommentOut, TagCreate, TagOut, TagUpdate
from app.services import current_organization_id, owned_demo, require_organization_role

router = APIRouter(prefix="/api", tags=["library"])


def owned_category(db: Session, category_id: str, user: User) -> Category:
    category = db.get(Category, category_id)
    if not category or category.organization_id != current_organization_id(db, user):
        raise HTTPException(status_code=404, detail="category not found")
    require_organization_role(db, user, category.organization_id, {"owner", "admin", "editor"})
    return category


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.scalars(select(Category).where(Category.organization_id == current_organization_id(db, user)).order_by(Category.position, Category.name)).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    organization_id = current_organization_id(db, user)
    require_organization_role(db, user, organization_id, {"owner", "admin", "editor"})
    if payload.parent_id:
        parent = owned_category(db, payload.parent_id, user)
        if parent.parent_id:
            raise HTTPException(status_code=400, detail="categories support a maximum of two levels")
    duplicate = db.scalar(select(Category).where(
        Category.organization_id == organization_id, Category.parent_id == payload.parent_id, Category.name == payload.name.strip()
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="a category with this name already exists")
    category = Category(owner_id=user.id, organization_id=organization_id, name=payload.name.strip(), parent_id=payload.parent_id, color=payload.color)
    db.add(category); db.commit(); db.refresh(category)
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(payload: CategoryUpdate, category_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    category = owned_category(db, category_id, user)
    values = payload.model_dump(exclude_unset=True)
    if "parent_id" in values:
        if values["parent_id"] == category.id:
            raise HTTPException(status_code=400, detail="a category cannot contain itself")
        children = db.scalar(select(Category.id).where(Category.parent_id == category.id))
        if children and values["parent_id"]:
            raise HTTPException(status_code=400, detail="a category with children must stay at the top level")
        if values["parent_id"]:
            parent = owned_category(db, values["parent_id"], user)
            if parent.parent_id:
                raise HTTPException(status_code=400, detail="categories support a maximum of two levels")
    for key, value in values.items():
        setattr(category, key, value.strip() if key == "name" else value)
    db.commit(); db.refresh(category)
    return category


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.delete(owned_category(db, category_id, user)); db.commit()


@router.get("/tags", response_model=list[TagOut])
def list_tags(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.scalars(select(Tag).where(Tag.organization_id == current_organization_id(db, user)).order_by(Tag.name)).all()


@router.post("/tags", response_model=TagOut, status_code=201)
def create_tag(payload: TagCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    organization_id = current_organization_id(db, user)
    require_organization_role(db, user, organization_id, {"owner", "admin", "editor"})
    name = payload.name.strip()
    existing = db.scalar(select(Tag).where(Tag.organization_id == organization_id, Tag.name == name))
    if existing:
        return existing
    tag = Tag(owner_id=user.id, organization_id=organization_id, name=name, color=payload.color)
    db.add(tag); db.commit(); db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}", status_code=204)
def delete_tag(tag_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.organization_id != current_organization_id(db, user):
        raise HTTPException(status_code=404, detail="tag not found")
    require_organization_role(db, user, tag.organization_id, {"owner", "admin", "editor"})
    db.delete(tag); db.commit()


@router.patch("/tags/{tag_id}", response_model=TagOut)
def update_tag(payload: TagUpdate, tag_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    tag = db.get(Tag, tag_id)
    if not tag or tag.organization_id != current_organization_id(db, user):
        raise HTTPException(status_code=404, detail="tag not found")
    require_organization_role(db, user, tag.organization_id, {"owner", "admin", "editor"})
    values = payload.model_dump(exclude_unset=True)
    for key, value in values.items():
        setattr(tag, key, value.strip() if key == "name" else value)
    db.commit(); db.refresh(tag)
    return tag


def parse_date(value: str | None, fallback: datetime, end: bool = False) -> datetime:
    if not value:
        return fallback
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if end and len(value) <= 10:
            parsed += timedelta(days=1)
        return parsed
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid date filter") from exc


def distribution(events: list[AnalyticsEvent], field: str) -> list[dict]:
    # One sample per session prevents active viewers from skewing device data.
    sessions = {}
    for event in events:
        value = getattr(event, field) or ""
        if value and event.session_id not in sessions:
            sessions[event.session_id] = value
    counts = Counter(sessions.values())
    return [{"name": name, "value": value} for name, value in counts.most_common()]


@router.get("/demos/{demo_id}/analytics")
def demo_analytics(
    demo_id: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    tag: list[str] = Query(default=[]),
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    demo = owned_demo(db, demo_id, user)
    if tag and not set(tag).intersection(item.id for item in demo.tags):
        return {"filtered_out": True, "summary": {"total_views": 0, "unique_viewers": 0, "engagement": 0, "completion": 0}, "steps": [], "devices": {}, "leads": []}
    start = parse_date(date_from, datetime.now(timezone.utc) - timedelta(days=30))
    end = parse_date(date_to, datetime.now(timezone.utc), end=True)
    events = db.scalars(select(AnalyticsEvent).where(
        AnalyticsEvent.demo_id == demo.id, AnalyticsEvent.created_at >= start, AnalyticsEvent.created_at < end
    ).order_by(AnalyticsEvent.created_at)).all()
    comments = db.scalars(select(StepComment).where(
        StepComment.demo_id == demo.id, StepComment.created_at >= start, StepComment.created_at < end
    ).order_by(StepComment.created_at.desc())).all()

    # Count a session even when its initial beacon was blocked but a later step beacon arrived.
    sessions = {event.session_id for event in events}
    visitors = {event.visitor_id for event in events}
    completed = {event.session_id for event in events if event.event_type == "complete"}
    interacted = {event.session_id for event in events if event.event_type == "interaction"}
    session_steps: dict[str, set[str]] = defaultdict(set)
    for event in events:
        if event.event_type == "step_view" and event.step_id:
            session_steps[event.session_id].add(event.step_id)
    engaged = interacted | {session_id for session_id, steps in session_steps.items() if len(steps) > 1}
    total = len(sessions)
    step_counts = Counter(event.step_id for event in events if event.event_type == "step_view" and event.step_id)
    ordered_steps = sorted(demo.steps, key=lambda item: item.position)
    step_data = [{
        "id": step.id, "position": step.position, "title": step.title or f"步骤 {index + 1}",
        "viewers": step_counts[step.id], "conversion": round(step_counts[step.id] / total * 100, 1) if total else 0,
    } for index, step in enumerate(ordered_steps)]
    locations = Counter(", ".join(filter(None, [event.city, event.region, event.country])) for event in events)
    return {
        "filtered_out": False,
        "range": {"from": start.isoformat(), "to": end.isoformat()},
        "summary": {
            "total_views": total, "unique_viewers": len(visitors),
            "engagement": round(len(engaged) / total * 100, 1) if total else 0,
            "completion": round(len(completed) / total * 100, 1) if total else 0,
        },
        "steps": step_data,
        "devices": {
            "operating_systems": distribution(events, "operating_system"),
            "browsers": distribution(events, "browser"), "device_types": distribution(events, "device"),
            "locations": [{"name": name, "value": value} for name, value in locations.most_common() if name],
        },
        "leads": [{
            "name": item.author_name, "email": item.author_email, "comment": item.content,
            "step_id": item.step_id, "created_at": item.created_at,
        } for item in comments if item.author_email or item.author_name != "访客"],
        "comments": [CommentOut.model_validate(item) for item in comments],
    }


@router.patch("/demos/{demo_id}/comments/{comment_id}", response_model=CommentOut)
def moderate_comment(demo_id: str, comment_id: str, status: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    owned_demo(db, demo_id, user)
    if status not in {"published", "hidden"}:
        raise HTTPException(status_code=400, detail="invalid comment status")
    comment = db.scalar(select(StepComment).where(StepComment.id == comment_id, StepComment.demo_id == demo_id))
    if not comment:
        raise HTTPException(status_code=404, detail="comment not found")
    comment.status = status; db.commit(); db.refresh(comment)
    return comment
