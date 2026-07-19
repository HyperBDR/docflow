from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Demo, ShareToken
from app.quota import quota_summary
from app.quota_estimates import estimate_ai_tokens, estimate_ai_tokens_for_steps, estimate_export_bytes, estimate_publish_bytes, estimate_video_minutes


ACTION_METRICS = {
    "create_resource": ("resources",),
    "duplicate_resource": ("resources", "max_steps_per_resource"),
    "merge_resources": ("resources", "max_steps_per_resource"),
    "record_step": ("storage_bytes", "max_steps_per_resource"),
    "use_ai": ("monthly_ai_tokens",),
    "create_share": ("active_shares",),
    "publish": ("active_shares", "storage_bytes"),
    "export": ("monthly_exports", "storage_bytes"),
    "export_video": ("monthly_exports", "monthly_video_minutes", "storage_bytes"),
    "invite_member": ("members",),
}


def _has_active_share(db: Session, demo_id: str) -> bool:
    current = datetime.now(timezone.utc)
    return db.scalar(select(ShareToken.id).where(
        ShareToken.demo_id == demo_id,
        ShareToken.revoked.is_(False),
        or_(ShareToken.expires_at.is_(None), ShareToken.expires_at > current),
    ).limit(1)) is not None


def quota_capabilities(db: Session, organization_id: str, demo: Demo | None = None) -> dict:
    """Return live, advisory UI guards for one workspace.

    The mutation endpoints remain the source of truth and run ``enforce`` in
    their own transaction. This response is intentionally not persisted so a
    quota-plan or override change becomes visible on the next refresh.
    """
    summary = quota_summary(db, organization_id)
    items = {item["key"]: item for item in summary["items"]}
    step_count = len(demo.steps) if demo else 0
    video_minutes = estimate_video_minutes(demo) if demo else 1
    needs_share = bool(demo and not _has_active_share(db, demo.id))

    def blocker(metric: str, *, current: int | None = None, increment: int = 1) -> dict | None:
        item = items[metric]
        used = int(item["used"] if current is None else current)
        limit = item["limit"]
        if item["enforcement"] != "hard" or limit is None or used + max(0, increment) <= int(limit):
            return None
        return {
            "metric": metric,
            "code": f"quota.{metric}_exceeded",
            "used": used,
            "limit": int(limit),
            "remaining": max(0, int(limit) - used),
            "resets_at": summary["period"]["resets_at"],
        }

    actions: dict[str, dict] = {}
    for action, metrics in ACTION_METRICS.items():
        blockers = []
        for metric in metrics:
            if action in {"duplicate_resource", "merge_resources"} and metric == "max_steps_per_resource":
                value = blocker(metric, current=0, increment=step_count)
            elif action == "record_step" and metric == "max_steps_per_resource":
                value = blocker(metric, current=step_count)
            elif action == "publish" and metric == "active_shares" and demo and not needs_share:
                value = None
            elif action == "publish" and metric == "storage_bytes" and demo:
                value = blocker(metric, increment=estimate_publish_bytes(demo))
            elif action == "use_ai" and metric == "monthly_ai_tokens":
                value = blocker(metric, increment=estimate_ai_tokens(demo) if demo else estimate_ai_tokens_for_steps(1))
            elif action == "export" and metric == "storage_bytes" and demo:
                value = blocker(metric, increment=estimate_export_bytes(demo, "pdf"))
            elif action == "export_video" and metric == "storage_bytes" and demo:
                value = blocker(metric, increment=estimate_export_bytes(demo, "mp4"))
            elif action == "export_video" and metric == "monthly_video_minutes":
                value = blocker(metric, increment=video_minutes)
            else:
                value = blocker(metric)
            if value:
                blockers.append(value)
        actions[action] = {"allowed": not blockers, "blockers": blockers}

    return {
        "organization_id": organization_id,
        "generated_at": datetime.now(timezone.utc),
        "plan": summary["plan"],
        "period": summary["period"],
        "items": summary["items"],
        "actions": actions,
    }
