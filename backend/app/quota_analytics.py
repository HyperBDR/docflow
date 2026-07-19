from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Organization, OrganizationMember, OrganizationQuotaAssignment, QuotaPlan, QuotaUsageSnapshot, User
from app.in_app_notifications import create_notification, notify_admins, organization_manager_ids
from app.quota import DEFAULT_LIMITS, SOFT, effective_plan, quota_summary, usage


RETENTION_DAYS = 400


def _quota_notification_band(percent: float) -> tuple[str, str] | None:
    if percent >= 100:
        return "exceeded", "critical"
    if percent >= 85:
        return "warning", "warning"
    if percent >= 70:
        return "notice", "info"
    return None


def _quota_notification_cycle(key: str, moment: datetime) -> str:
    if key.startswith("monthly_"):
        return moment.strftime("%Y-%m")
    year, week, _ = moment.isocalendar()
    return f"{year}-W{week:02d}"


def _notify_quota_usage(db: Session, organization: Organization, key: str, used: int, limit: int | None, percent: float, moment: datetime) -> None:
    band = _quota_notification_band(percent) if limit else None
    if not band:
        return
    level, severity = band
    data = {"organization_id": organization.id, "organization_name": organization.name, "metric_key": key, "used": used, "limit": limit, "percent": percent}
    cycle = _quota_notification_cycle(key, moment)
    for recipient_id in organization_manager_ids(db, organization):
        create_notification(
            db, recipient_id, f"quota.{level}", organization_id=organization.id,
            category="quota", severity=severity, title="Workspace quota update",
            message=organization.name, action_url="/quotas", data=data,
            dedupe_key=f"quota:{organization.id}:{key}:{level}:{cycle}",
        )
    if level == "exceeded":
        notify_admins(
            db, "quota.admin_exceeded", organization_id=organization.id,
            category="quota", severity="critical", title="Workspace quota exceeded",
            message=organization.name, action_url="/admin/operations/quotas", data=data,
            dedupe_key=f"admin-quota:{organization.id}:{key}:{cycle}",
        )


def health_for(items: list[dict]) -> str:
    statuses = {item["status"] for item in items}
    return "exceeded" if "exceeded" in statuses else "warning" if "warning" in statuses else "normal"


def collect_quota_usage(db: Session, organization_ids: list[str] | None = None, collected_at: datetime | None = None) -> dict:
    moment = collected_at or datetime.now(timezone.utc)
    statement = select(Organization).where(Organization.status == "active")
    if organization_ids:
        statement = statement.where(Organization.id.in_(organization_ids))
    organizations = db.scalars(statement.order_by(Organization.created_at)).all()
    updated = 0
    for organization in organizations:
        _plan, limits, _assignment = effective_plan(db, organization.id)
        values = usage(db, organization.id)
        for key in DEFAULT_LIMITS:
            limit = limits.get(key)
            used = int(values.get(key, 0))
            percent = round(used / int(limit) * 100, 2) if limit else 0
            snapshot = db.scalar(select(QuotaUsageSnapshot).where(
                QuotaUsageSnapshot.organization_id == organization.id,
                QuotaUsageSnapshot.metric_key == key,
                QuotaUsageSnapshot.snapshot_date == moment.date(),
            ))
            if not snapshot:
                snapshot = QuotaUsageSnapshot(
                    organization_id=organization.id, metric_key=key, snapshot_date=moment.date(),
                )
            snapshot.used = used
            snapshot.limit = int(limit) if limit is not None else None
            snapshot.usage_percent = percent
            snapshot.collected_at = moment
            db.add(snapshot)
            _notify_quota_usage(db, organization, key, used, int(limit) if limit is not None else None, percent, moment)
            updated += 1
    db.execute(delete(QuotaUsageSnapshot).where(QuotaUsageSnapshot.snapshot_date < moment.date() - timedelta(days=RETENTION_DAYS)))
    db.commit()
    return {"spaces": len(organizations), "snapshots": updated, "collected_at": moment}


def _owner(db: Session, organization: Organization) -> User | None:
    if organization.personal_owner_id:
        return db.get(User, organization.personal_owner_id)
    row = db.execute(select(User).join(OrganizationMember, OrganizationMember.user_id == User.id).where(
        OrganizationMember.organization_id == organization.id,
        OrganizationMember.role == "owner",
        User.deleted_at.is_(None),
    ).order_by(OrganizationMember.created_at)).first()
    return row[0] if row else None


def live_space_rows(db: Session) -> list[dict]:
    organizations = db.scalars(select(Organization).where(Organization.status == "active").order_by(Organization.created_at.desc())).all()
    latest_dates = select(
        QuotaUsageSnapshot.organization_id.label("organization_id"),
        func.max(QuotaUsageSnapshot.snapshot_date).label("snapshot_date"),
    ).group_by(QuotaUsageSnapshot.organization_id).subquery()
    latest_snapshots = db.scalars(select(QuotaUsageSnapshot).join(
        latest_dates,
        (QuotaUsageSnapshot.organization_id == latest_dates.c.organization_id) &
        (QuotaUsageSnapshot.snapshot_date == latest_dates.c.snapshot_date),
    )).all()
    snapshots_by_space: dict[str, dict[str, QuotaUsageSnapshot]] = defaultdict(dict)
    for snapshot in latest_snapshots:
        snapshots_by_space[snapshot.organization_id][snapshot.metric_key] = snapshot
    rows = []
    for organization in organizations:
        plan, _limits, assignment = effective_plan(db, organization.id)
        snapshots = snapshots_by_space.get(organization.id, {})
        if all(key in snapshots for key in DEFAULT_LIMITS):
            items = []
            for key in DEFAULT_LIMITS:
                snapshot = snapshots[key]
                has_limit = snapshot.limit is not None
                status = "exceeded" if has_limit and snapshot.used >= snapshot.limit else "warning" if has_limit and snapshot.usage_percent >= 80 else "normal"
                items.append({
                    "key": key, "used": snapshot.used, "limit": snapshot.limit,
                    "percent": round(snapshot.usage_percent, 1), "status": status,
                    "enforcement": "soft" if key in SOFT else "hard",
                })
            summary = {"plan": {"id": plan.id, "name": plan.name, "description": plan.description}, "items": items, "has_overrides": bool(assignment and assignment.overrides)}
        else:
            summary = quota_summary(db, organization.id)
        owner = _owner(db, organization)
        items = summary["items"]
        highest = max(items, key=lambda item: item["percent"], default={"key": "storage_bytes", "percent": 0})
        rows.append({
            "id": organization.id,
            "name": organization.name,
            "slug": organization.slug,
            "kind": organization.kind,
            "owner_name": owner.name if owner else "",
            "owner_email": owner.email if owner else "",
            "created_at": organization.created_at,
            "plan": summary["plan"],
            "assignment": {"plan_id": assignment.plan_id, "overrides": assignment.overrides or {}} if assignment else None,
            "has_overrides": summary["has_overrides"],
            "health": health_for(items),
            "highest_metric": highest["key"],
            "highest_percent": highest["percent"],
            "items": items,
        })
    return rows


def _growth_map(db: Session, organization_ids: list[str], metric: str, start: date) -> dict[str, float]:
    if not organization_ids:
        return {}
    snapshots = db.scalars(select(QuotaUsageSnapshot).where(
        QuotaUsageSnapshot.organization_id.in_(organization_ids),
        QuotaUsageSnapshot.metric_key == metric,
        QuotaUsageSnapshot.snapshot_date >= start,
    ).order_by(QuotaUsageSnapshot.organization_id, QuotaUsageSnapshot.snapshot_date)).all()
    grouped: dict[str, list[int]] = defaultdict(list)
    for snapshot in snapshots:
        grouped[snapshot.organization_id].append(snapshot.used)
    result = {}
    for organization_id, values in grouped.items():
        first, last = values[0], values[-1]
        result[organization_id] = round((last - first) / first * 100, 1) if first else (100.0 if last else 0.0)
    return result


def _distribution(rows: list[dict], key) -> list[dict]:
    values: dict[str, dict] = {}
    for row in rows:
        item_key, label = key(row)
        current = values.setdefault(item_key, {"key": item_key, "label": label, "value": 0})
        current["value"] += 1
    return sorted(values.values(), key=lambda item: item["value"], reverse=True)


def operations_overview(
    db: Session, days: int = 30, metric: str = "storage_bytes", kind: str = "", plan_id: str = "", health: str = "",
) -> dict:
    if metric not in DEFAULT_LIMITS:
        metric = "storage_bytes"
    all_rows = live_space_rows(db)
    rows = [row for row in all_rows if (not kind or row["kind"] == kind) and (not plan_id or row["plan"]["id"] == plan_id) and (not health or row["health"] == health)]
    organization_ids = [row["id"] for row in rows]
    start = datetime.now(timezone.utc).date() - timedelta(days=max(1, min(days, 400)) - 1)
    growth = _growth_map(db, organization_ids, metric, start)
    for row in rows:
        row["growth_percent"] = growth.get(row["id"], 0)

    snapshot_statement = select(
        QuotaUsageSnapshot.snapshot_date,
        func.sum(QuotaUsageSnapshot.used),
        func.sum(QuotaUsageSnapshot.limit),
    ).where(
        QuotaUsageSnapshot.metric_key == metric,
        QuotaUsageSnapshot.snapshot_date >= start,
    )
    if organization_ids:
        snapshot_statement = snapshot_statement.where(QuotaUsageSnapshot.organization_id.in_(organization_ids))
    else:
        snapshot_statement = snapshot_statement.where(False)
    trend = [{
        "date": item[0].isoformat(), "used": int(item[1] or 0), "limit": int(item[2] or 0),
        "percent": round((item[1] or 0) / item[2] * 100, 2) if item[2] else 0,
    } for item in db.execute(snapshot_statement.group_by(QuotaUsageSnapshot.snapshot_date).order_by(QuotaUsageSnapshot.snapshot_date)).all()]

    item_totals = {key: 0 for key in DEFAULT_LIMITS}
    for row in rows:
        for item in row["items"]:
            item_totals[item["key"]] += item["used"]
    default_plan = db.scalar(select(QuotaPlan).where(QuotaPlan.is_default.is_(True)))
    summary = {
        "total_spaces": len(rows),
        "team_spaces": sum(row["kind"] == "team" for row in rows),
        "personal_spaces": sum(row["kind"] == "personal" for row in rows),
        "default_plan_spaces": sum(bool(default_plan and row["plan"]["id"] == default_plan.id) for row in rows),
        "assigned_spaces": sum(row["assignment"] is not None for row in rows),
        "override_spaces": sum(row["has_overrides"] for row in rows),
        "warning_spaces": sum(row["health"] == "warning" for row in rows),
        "exceeded_spaces": sum(row["health"] == "exceeded" for row in rows),
        **item_totals,
    }
    latest = db.scalar(select(func.max(QuotaUsageSnapshot.collected_at)))
    return {
        "summary": summary,
        "spaces": rows,
        "trend": trend,
        "by_kind": _distribution(rows, lambda row: (row["kind"], row["kind"])),
        "by_plan": _distribution(rows, lambda row: (row["plan"]["id"], row["plan"]["name"])),
        "by_health": _distribution(rows, lambda row: (row["health"], row["health"])),
        "ranking": sorted(rows, key=lambda row: (row["growth_percent"], next((item["percent"] for item in row["items"] if item["key"] == metric), 0)), reverse=True)[:10],
        "filters": {"days": days, "metric": metric, "kind": kind, "plan_id": plan_id, "health": health},
        "collected_at": latest,
    }


def plan_statistics(db: Session) -> list[dict]:
    rows = live_space_rows(db)
    plans = db.scalars(select(QuotaPlan).order_by(QuotaPlan.is_default.desc(), QuotaPlan.name)).all()
    assignment_counts = dict(db.execute(select(
        OrganizationQuotaAssignment.plan_id,
        func.count(OrganizationQuotaAssignment.organization_id),
    ).group_by(OrganizationQuotaAssignment.plan_id)).all())
    result = []
    for plan in plans:
        applied = [row for row in rows if row["plan"]["id"] == plan.id]
        assigned = int(assignment_counts.get(plan.id, 0))
        result.append({
            "id": plan.id, "name": plan.name, "description": plan.description, "is_default": plan.is_default,
            "limits": {**DEFAULT_LIMITS, **(plan.limits or {})}, "created_at": plan.created_at, "updated_at": plan.updated_at,
            "can_delete": not plan.is_default and assigned == 0,
            "delete_blocker": "default" if plan.is_default else "in_use" if assigned else None,
            "statistics": {
                "spaces": len(applied), "team_spaces": sum(row["kind"] == "team" for row in applied),
                "personal_spaces": sum(row["kind"] == "personal" for row in applied),
                "normal": sum(row["health"] == "normal" for row in applied),
                "warning": sum(row["health"] == "warning" for row in applied),
                "exceeded": sum(row["health"] == "exceeded" for row in applied),
                "overrides": sum(row["has_overrides"] for row in applied),
            },
        })
    return result


def space_history(db: Session, organization_id: str, days: int = 90) -> dict:
    organization = db.get(Organization, organization_id)
    if not organization:
        return {}
    start = datetime.now(timezone.utc).date() - timedelta(days=max(1, min(days, 400)) - 1)
    snapshots = db.scalars(select(QuotaUsageSnapshot).where(
        QuotaUsageSnapshot.organization_id == organization_id,
        QuotaUsageSnapshot.snapshot_date >= start,
    ).order_by(QuotaUsageSnapshot.snapshot_date, QuotaUsageSnapshot.metric_key)).all()
    points: dict[str, dict] = {}
    for snapshot in snapshots:
        point = points.setdefault(snapshot.snapshot_date.isoformat(), {"date": snapshot.snapshot_date.isoformat(), "metrics": {}})
        point["metrics"][snapshot.metric_key] = {"used": snapshot.used, "limit": snapshot.limit, "percent": snapshot.usage_percent}
    return {"organization_id": organization_id, "points": list(points.values())}
