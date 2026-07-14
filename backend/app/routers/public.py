import io
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import PublishedRevision, ShareToken
from app.storage import storage
from app.snapshots import SnapshotError, load_snapshot

router = APIRouter(prefix="/public", tags=["public"])


def published(db: Session, token: str) -> tuple[ShareToken, PublishedRevision]:
    share = db.scalar(select(ShareToken).where(ShareToken.token == token, ShareToken.revoked.is_(False)))
    if not share:
        raise HTTPException(status_code=404, detail="published demo not found")
    revision = db.get(PublishedRevision, share.revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="published demo not found")
    return share, revision


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
def public_snapshot(token: str, step_id: str, db: Session = Depends(get_db)):
    _, revision = published(db, token)
    step = next((item for item in revision.snapshot["steps"] if item["id"] == step_id), None)
    if not step or not step.get("dom_snapshot_key"):
        raise HTTPException(status_code=404, detail="DOM snapshot not found")
    try:
        return load_snapshot(step["dom_snapshot_key"])
    except SnapshotError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{token}/markdown", response_class=PlainTextResponse)
def public_markdown(token: str, db: Session = Depends(get_db)):
    _, revision = published(db, token)
    snapshot = revision.snapshot
    lines = [f"# {snapshot['title']}", ""]
    if snapshot.get("description"):
        lines += [snapshot["description"], ""]
    for index, step in enumerate(snapshot["steps"], 1):
        lines += [f"## {index}. {step['title'] or f'步骤 {index}'}", "", step.get("body", ""), "", f"![{step['title'] or f'步骤 {index}'}]({settings.public_base_url}/public/{token}/assets/{step['id']}.webp)", ""]
    return "\n".join(lines)
