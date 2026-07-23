import math
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.demo_cloning import clone_demo
from app.models import (
    AIJob,
    Demo,
    ExportJob,
    JobStatus,
    Organization,
    OrganizationMember,
    PublishedRevision,
    RecordingSession,
    ShareToken,
    Step,
    User,
)
from app.quota import enforce_increments, month_range, usage
from app.storage import storage


def _failure(status_code: int, message: str, code: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"message": message, "code": code})


def _actual_owner(db: Session, user_id: str, organization_id: str) -> OrganizationMember | None:
    return db.scalar(select(OrganizationMember).where(
        OrganizationMember.user_id == user_id,
        OrganizationMember.organization_id == organization_id,
        OrganizationMember.role == "owner",
    ))


def _step_keys(db: Session, demo_id: str) -> set[str]:
    keys: set[str] = set()
    for asset_key, snapshot_key in db.execute(select(Step.asset_key, Step.dom_snapshot_key).where(Step.demo_id == demo_id)):
        if asset_key:
            keys.add(asset_key)
        if snapshot_key:
            keys.add(snapshot_key)
    return keys


def _history_keys(db: Session, demo_id: str) -> set[str]:
    keys = {key for key in db.scalars(select(ExportJob.result_key).where(
        ExportJob.demo_id == demo_id, ExportJob.result_key.is_not(None),
    )).all() if key}
    for revision in db.scalars(select(PublishedRevision).where(PublishedRevision.demo_id == demo_id)).all():
        keys.update(
            item.get("asset_key")
            for item in (revision.snapshot or {}).get("steps", [])
            if item.get("asset_key")
        )
    return keys


def _active_share_count(db: Session, demo_id: str) -> int:
    now = datetime.now(timezone.utc)
    return len(db.scalars(select(ShareToken.id).where(
        ShareToken.demo_id == demo_id,
        ShareToken.revoked.is_(False),
        or_(ShareToken.expires_at.is_(None), ShareToken.expires_at > now),
    )).all())


def _monthly_export_usage(db: Session, demo_id: str) -> tuple[int, int]:
    start, end = month_range()
    jobs = db.scalars(select(ExportJob).where(
        ExportJob.demo_id == demo_id,
        ExportJob.created_at >= start,
        ExportJob.created_at <= end,
        ExportJob.status == JobStatus.complete,
    )).all()
    revisions = {
        revision.id: revision
        for revision in db.scalars(select(PublishedRevision).where(
            PublishedRevision.id.in_([job.revision_id for job in jobs if job.kind == "mp4"])
        )).all()
    } if jobs else {}
    seconds = sum(
        sum(float(step.get("duration", 3)) for step in (revisions[job.revision_id].snapshot or {}).get("steps", []))
        for job in jobs
        if job.kind == "mp4" and job.revision_id in revisions
    )
    return len(jobs), math.ceil(seconds / 60)


def _target_storage_increment(db: Session, target_id: str, transferred_keys: set[str]) -> int:
    target_sizes: dict[str, int] = {}
    usage(db, target_id, target_sizes)
    new_keys = transferred_keys.difference(target_sizes)
    return sum(storage.sizes(new_keys).values())


def _ensure_idle_for_transfer(db: Session, demo_id: str, action: str) -> None:
    active_recording = db.scalar(select(RecordingSession.id).where(
        RecordingSession.demo_id == demo_id, RecordingSession.status == "active",
    ).limit(1))
    if active_recording:
        raise _failure(409, "finish or cancel the active recording before transferring this resource", "resource.transfer_recording_active")
    if action != "move":
        return
    pending_ai = db.scalar(select(AIJob.id).where(
        AIJob.demo_id == demo_id, AIJob.status.in_([JobStatus.queued, JobStatus.running]),
    ).limit(1))
    pending_export = db.scalar(select(ExportJob.id).where(
        ExportJob.demo_id == demo_id, ExportJob.status.in_([JobStatus.queued, JobStatus.running]),
    ).limit(1))
    if pending_ai or pending_export:
        raise _failure(409, "wait for active resource jobs before moving this resource", "resource.transfer_job_active")


def transfer_resource(
    db: Session,
    source: Demo,
    actor: User,
    target_organization_id: str,
    action: str,
) -> tuple[Demo, str]:
    source_organization = db.get(Organization, source.organization_id)
    target = db.get(Organization, target_organization_id)
    if not source_organization or source_organization.status != "active":
        raise _failure(403, "source space is unavailable", "resource.transfer_source_unavailable")
    if not target or target.status != "active":
        raise _failure(404, "target space is unavailable", "resource.transfer_target_unavailable")
    if source.organization_id == target.id:
        raise _failure(400, "source and target spaces must be different", "resource.transfer_same_space")
    if not _actual_owner(db, actor.id, source.organization_id) or not _actual_owner(db, actor.id, target.id):
        raise _failure(403, "you must own both spaces to copy or move resources", "resource.transfer_owner_required")

    _ensure_idle_for_transfer(db, source.id, action)
    steps = len(source.steps)
    transferred_keys = _step_keys(db, source.id)
    increments = {
        "resources": 1,
        "max_steps_per_resource": steps,
        "storage_bytes": _target_storage_increment(
            db, target.id, transferred_keys | (_history_keys(db, source.id) if action == "move" else set())
        ),
    }
    if action == "move":
        monthly_exports, monthly_video_minutes = _monthly_export_usage(db, source.id)
        increments.update({
            "active_shares": _active_share_count(db, source.id),
            "monthly_exports": monthly_exports,
            "monthly_video_minutes": monthly_video_minutes,
        })
    enforce_increments(db, target.id, increments)

    source_id = source.organization_id
    if action == "copy":
        result = clone_demo(db, source, actor, target.id, keep_taxonomy=False)
    else:
        source.organization_id = target.id
        source.category_id = None
        source.tags = []
        if not db.scalar(select(OrganizationMember.id).where(
            OrganizationMember.organization_id == target.id,
            OrganizationMember.user_id == source.owner_id,
        )):
            source.owner_id = actor.id
        result = source
        db.flush()
    return result, source_id
