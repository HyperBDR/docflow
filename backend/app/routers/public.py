import io
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import AnalyticsEvent, PublishedRevision, ShareToken, StepComment
from app.schemas import AnalyticsEventCreate, CommentCreate
from app.storage import storage

router = APIRouter(prefix="/public", tags=["public"])


def published(db: Session, token: str) -> tuple[ShareToken, PublishedRevision]:
    share = db.scalar(select(ShareToken).where(ShareToken.token == token, ShareToken.revoked.is_(False)))
    if not share:
        raise HTTPException(status_code=404, detail="published demo not found")
    revision = db.get(PublishedRevision, share.revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="published demo not found")
    return share, revision


def user_agent_info(value: str) -> tuple[str, str, str]:
    lower = value.lower()
    if "edg/" in lower: browser = "Microsoft Edge"
    elif "chrome/" in lower and "chromium" not in lower: browser = "Chrome"
    elif "firefox/" in lower: browser = "Firefox"
    elif "safari/" in lower: browser = "Safari"
    else: browser = "Other"
    if "windows" in lower: operating_system = "Windows"
    elif "android" in lower: operating_system = "Android"
    elif "iphone" in lower or "ipad" in lower: operating_system = "iOS"
    elif "mac os" in lower or "macintosh" in lower: operating_system = "macOS"
    elif "linux" in lower: operating_system = "Linux"
    else: operating_system = "Other"
    device = "mobile" if any(item in lower for item in ("mobile", "iphone", "android")) else "desktop"
    return operating_system, browser, device


@router.post("/{token}/events", status_code=204)
def collect_event(token: str, payload: AnalyticsEventCreate, request: Request, db: Session = Depends(get_db)):
    share, revision = published(db, token)
    step_ids = {item["id"] for item in revision.snapshot.get("steps", [])}
    if payload.step_id and payload.step_id not in step_ids:
        raise HTTPException(status_code=400, detail="step not found")
    duplicate = db.scalar(select(AnalyticsEvent.id).where(
        AnalyticsEvent.share_id == share.id, AnalyticsEvent.session_id == payload.session_id,
        AnalyticsEvent.event_type == payload.event_type, AnalyticsEvent.step_id == payload.step_id,
    ))
    if duplicate:
        return
    ua = request.headers.get("user-agent", "")[:1000]
    operating_system, browser, device = user_agent_info(ua)
    event = AnalyticsEvent(
        share_id=share.id, demo_id=share.demo_id, revision_id=revision.id, step_id=payload.step_id,
        visitor_id=payload.visitor_id, session_id=payload.session_id, event_type=payload.event_type,
        operating_system=operating_system, browser=browser, device=device, user_agent=ua,
        country=(request.headers.get("cf-ipcountry") or request.headers.get("x-country") or "")[:100],
        region=(request.headers.get("x-region") or "")[:100], city=(request.headers.get("x-city") or "")[:100],
    )
    db.add(event); db.commit()


@router.get("/{token}/comments")
def public_comments(token: str, step_id: str, db: Session = Depends(get_db)):
    share, revision = published(db, token)
    if step_id not in {item["id"] for item in revision.snapshot.get("steps", [])}:
        raise HTTPException(status_code=404, detail="step not found")
    comments = db.scalars(select(StepComment).where(
        StepComment.share_id == share.id, StepComment.step_id == step_id, StepComment.status == "published"
    ).order_by(StepComment.created_at.desc()).limit(100)).all()
    return [{
        "id": item.id, "step_id": item.step_id, "author_name": item.author_name,
        "content": item.content, "created_at": item.created_at,
    } for item in comments]


@router.post("/{token}/comments", status_code=201)
def create_comment(token: str, payload: CommentCreate, db: Session = Depends(get_db)):
    share, revision = published(db, token)
    if payload.step_id not in {item["id"] for item in revision.snapshot.get("steps", [])}:
        raise HTTPException(status_code=400, detail="step not found")
    comment = StepComment(
        share_id=share.id, demo_id=share.demo_id, revision_id=revision.id, step_id=payload.step_id,
        visitor_id=payload.visitor_id,
        author_name=payload.author_name.strip() or ("Guest" if revision.snapshot.get("content_locale") == "en" else "访客"),
        author_email=payload.author_email.strip(), content=payload.content.strip(),
    )
    db.add(comment); db.commit(); db.refresh(comment)
    return {"id": comment.id, "step_id": comment.step_id, "author_name": comment.author_name, "content": comment.content, "created_at": comment.created_at}


@router.get("/{token}")
def public_demo(token: str, db: Session = Depends(get_db)):
    _, revision = published(db, token)
    snapshot = dict(revision.snapshot)
    snapshot["steps"] = [
        {
            **step,
            "image_url": f"{settings.public_base_url}/public/{token}/assets/{step['id']}.webp",
            "snapshot_url": (
                f"{settings.public_base_url}/public/{token}/slides/{step['id']}/snapshot"
                if step.get("dom_snapshot_key") else None
            ),
            "snapshot_version": (
                step.get("dom_snapshot_key", "").rsplit("/", 1)[-1].split(".", 1)[0]
                if step.get("dom_snapshot_key") else None
            ),
            "asset_key": None,
            "dom_snapshot_key": None,
        }
        for step in snapshot["steps"]
    ]
    return snapshot


@router.get("/{token}/assets/{step_id}.webp")
def public_asset(token: str, step_id: str, db: Session = Depends(get_db)):
    _, revision = published(db, token)
    step = next((item for item in revision.snapshot["steps"] if item["id"] == step_id), None)
    if not step or not storage.exists(step["asset_key"]):
        raise HTTPException(status_code=404, detail="asset not found")
    return StreamingResponse(io.BytesIO(storage.read(step["asset_key"])), media_type="image/webp", headers={"Cache-Control": "public, max-age=300"})


@router.get("/{token}/slides/{step_id}/snapshot")
def public_snapshot(token: str, step_id: str, v: str | None = None, db: Session = Depends(get_db)):
    _, revision = published(db, token)
    step = next((item for item in revision.snapshot["steps"] if item["id"] == step_id), None)
    if not step or not step.get("dom_snapshot_key"):
        raise HTTPException(status_code=404, detail="DOM snapshot not found")
    key = step["dom_snapshot_key"]
    version = key.rsplit("/", 1)[-1].split(".", 1)[0]
    if not storage.exists(key):
        raise HTTPException(status_code=404, detail="DOM snapshot not found")
    # Snapshots are already stored as gzip. Returning those bytes directly
    # avoids expanding a 0.6–1.3 MB object into 4–5 MB of JSON on every step.
    return Response(
        content=storage.read(key), media_type="application/json",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": "public, max-age=31536000, immutable" if v == version else "public, max-age=300",
            "ETag": f'"{version}"',
        },
    )


@router.get("/{token}/markdown", response_class=PlainTextResponse)
def public_markdown(token: str, db: Session = Depends(get_db)):
    _, revision = published(db, token)
    snapshot = revision.snapshot
    lines = [f"# {snapshot['title']}", ""]
    if snapshot.get("description"):
        lines += [snapshot["description"], ""]
    for index, step in enumerate(snapshot["steps"], 1):
        fallback = f"Step {index}" if snapshot.get("content_locale") == "en" else f"步骤 {index}"
        lines += [f"## {index}. {step['title'] or fallback}", "", step.get("body", ""), "", f"![{step['title'] or fallback}]({settings.public_base_url}/public/{token}/assets/{step['id']}.webp)", ""]
    return "\n".join(lines)
