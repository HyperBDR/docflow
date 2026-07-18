from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Organization, OrganizationQuotaAssignment, PlatformQuotaPolicy, QuotaPlan, QuotaUsageSnapshot, now
from app.quota import DEFAULT_LIMITS


PLATFORM_MAX_LIMITS = {
    "storage_bytes": 1024 ** 4,
    "resources": 100_000,
    "max_steps_per_resource": 5_000,
    "members": 10_000,
    "active_shares": 100_000,
    "monthly_ai_tokens": 1_000_000_000,
    "monthly_exports": 1_000_000,
    "monthly_video_minutes": 100_000,
    "monthly_public_views": 1_000_000_000,
    "monthly_download_bytes": 10 * 1024 ** 4,
}


def policy_values(db: Session) -> tuple[dict[str, int], dict[str, bool], PlatformQuotaPolicy | None]:
    policy = db.get(PlatformQuotaPolicy, "default")
    maximums = {**PLATFORM_MAX_LIMITS, **((policy.maximums or {}) if policy else {})}
    unlimited = {key: bool((policy.allow_unlimited or {}).get(key, False)) if policy else False for key in DEFAULT_LIMITS}
    return maximums, unlimited, policy


def normalized_policy(payload: dict, current_maximums: dict, current_unlimited: dict) -> tuple[dict, dict]:
    proposed_maximums = {**current_maximums}
    proposed_unlimited = {**current_unlimited}
    for key, value in (payload.get("maximums") or {}).items():
        if key not in DEFAULT_LIMITS:
            raise HTTPException(422, {"message": f"unknown quota metric: {key}", "code": "quota.metric_unknown"})
        if value is None or isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            raise HTTPException(422, {"message": f"invalid platform limit for {key}", "code": "quota.platform_limit_invalid"})
        proposed_maximums[key] = int(value)
    for key, value in (payload.get("allow_unlimited") or {}).items():
        if key not in DEFAULT_LIMITS:
            raise HTTPException(422, {"message": f"unknown quota metric: {key}", "code": "quota.metric_unknown"})
        proposed_unlimited[key] = bool(value)
    return proposed_maximums, proposed_unlimited


def violations(limits: dict, maximums: dict, allow_unlimited: dict) -> list[str]:
    result = []
    for key in DEFAULT_LIMITS:
        value = limits.get(key, DEFAULT_LIMITS[key])
        if value is None:
            if not allow_unlimited.get(key, False):
                result.append(key)
        elif int(value) > int(maximums[key]):
            result.append(key)
    return result


def validate_limits(db: Session, limits: dict) -> None:
    maximums, unlimited, _policy = policy_values(db)
    invalid = violations(limits, maximums, unlimited)
    if invalid:
        raise HTTPException(422, {
            "message": "quota configuration exceeds the platform limit",
            "code": "quota.platform_limit_exceeded",
            "quota": {"metrics": invalid},
        })


def impact(db: Session, maximums: dict, allow_unlimited: dict) -> dict:
    plans = db.scalars(select(QuotaPlan).order_by(QuotaPlan.name)).all()
    if not plans:
        plan = QuotaPlan(name="Default", description="Default workspace quota", is_default=True, limits=DEFAULT_LIMITS)
        db.add(plan)
        db.commit()
        db.refresh(plan)
        plans = [plan]
    default = next((plan for plan in plans if plan.is_default), plans[0] if plans else None)
    plan_by_id = {plan.id: plan for plan in plans}
    plan_violations = {
        plan.id: violations({**DEFAULT_LIMITS, **(plan.limits or {})}, maximums, allow_unlimited)
        for plan in plans
    }
    affected_plans = [{"id": plan.id, "name": plan.name, "metrics": plan_violations[plan.id]} for plan in plans if plan_violations[plan.id]]
    assignments = {item.organization_id: item for item in db.scalars(select(OrganizationQuotaAssignment)).all()}
    affected_spaces = []
    metric_plan_counts = {key: 0 for key in DEFAULT_LIMITS}
    metric_space_counts = {key: 0 for key in DEFAULT_LIMITS}
    for plan in affected_plans:
        for key in plan["metrics"]:
            metric_plan_counts[key] += 1
    for organization in db.scalars(select(Organization).where(Organization.status == "active").order_by(Organization.name)).all():
        assignment = assignments.get(organization.id)
        plan = plan_by_id.get(assignment.plan_id) if assignment else default
        effective = {**DEFAULT_LIMITS, **((plan.limits or {}) if plan else {}), **((assignment.overrides or {}) if assignment else {})}
        metrics = set(violations(effective, maximums, allow_unlimited))
        if metrics:
            for key in metrics:
                metric_space_counts[key] += 1
            affected_spaces.append({"id": organization.id, "name": organization.name, "kind": organization.kind, "plan_name": plan.name if plan else "", "metrics": sorted(metrics)})
    return {
        "affected_plans": affected_plans,
        "affected_spaces": affected_spaces,
        "affected_plan_count": len(affected_plans),
        "affected_space_count": len(affected_spaces),
        "metric_plan_counts": metric_plan_counts,
        "metric_space_counts": metric_space_counts,
    }


def preview(db: Session, payload: dict) -> dict:
    current_maximums, current_unlimited, _policy = policy_values(db)
    maximums, allow_unlimited = normalized_policy(payload, current_maximums, current_unlimited)
    return {"maximums": maximums, "allow_unlimited": allow_unlimited, **impact(db, maximums, allow_unlimited)}


def platform_limits(db: Session) -> dict:
    maximums, allow_unlimited, policy = policy_values(db)
    impact_value = impact(db, maximums, allow_unlimited)
    plans = db.scalars(select(QuotaPlan).order_by(QuotaPlan.is_default.desc(), QuotaPlan.name)).all()
    default = next((plan for plan in plans if plan.is_default), plans[0] if plans else None)
    latest_date = db.scalar(select(func.max(QuotaUsageSnapshot.snapshot_date)))
    totals = dict(db.execute(select(QuotaUsageSnapshot.metric_key, func.sum(QuotaUsageSnapshot.used)).where(
        QuotaUsageSnapshot.snapshot_date == latest_date
    ).group_by(QuotaUsageSnapshot.metric_key)).all()) if latest_date else {}
    start = now().date() - timedelta(days=29)
    history_rows = db.execute(select(
        QuotaUsageSnapshot.metric_key, QuotaUsageSnapshot.snapshot_date, func.sum(QuotaUsageSnapshot.used),
    ).where(QuotaUsageSnapshot.snapshot_date >= start).group_by(
        QuotaUsageSnapshot.metric_key, QuotaUsageSnapshot.snapshot_date,
    ).order_by(QuotaUsageSnapshot.metric_key, QuotaUsageSnapshot.snapshot_date)).all()
    history: dict[str, list[dict]] = {key: [] for key in DEFAULT_LIMITS}
    for key, snapshot_date, used in history_rows:
        history.setdefault(key, []).append({"date": snapshot_date.isoformat(), "used": int(used or 0)})
    metrics = []
    for key in DEFAULT_LIMITS:
        finite_plan_values = [int(({**DEFAULT_LIMITS, **(plan.limits or {})}).get(key)) for plan in plans if ({**DEFAULT_LIMITS, **(plan.limits or {})}).get(key) is not None]
        current_history = history.get(key, [])
        first = current_history[0]["used"] if current_history else 0
        last = current_history[-1]["used"] if current_history else int(totals.get(key, 0) or 0)
        growth = round((last - first) / first * 100, 2) if first else (100.0 if last else 0.0)
        metrics.append({
            "key": key,
            "maximum": maximums[key],
            "allow_unlimited": allow_unlimited[key],
            "default_plan_value": ({**DEFAULT_LIMITS, **((default.limits or {}) if default else {})}).get(key),
            "highest_plan_value": max(finite_plan_values, default=0),
            "affected_plans": impact_value["metric_plan_counts"][key],
            "affected_spaces": impact_value["metric_space_counts"][key],
            "total_used": int(totals.get(key, 0) or 0),
            "capacity_percent": round(int(totals.get(key, 0) or 0) / maximums[key] * 100, 2) if maximums[key] else 0,
            "growth_percent": growth,
            "trend": current_history,
        })
    return {
        "maximums": maximums,
        "allow_unlimited": allow_unlimited,
        "metrics": metrics,
        "impact": impact_value,
        "updated_at": policy.updated_at if policy else None,
    }
