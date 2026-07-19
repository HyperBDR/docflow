import shutil
import time
from datetime import timedelta

import redis
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AIJob, AIModelConfig, AIUsageRecord, AlertEvent, ExportJob, JobStatus, MonitoringSnapshot, Organization, OrganizationQuotaAssignment, QuotaPlan, QuotaUsageSnapshot, StorageConfig, now
from app.platform_settings import monitoring_runtime_config
from app.monitoring.alert_engine import evaluate_rules
from app.monitoring.request_metrics import read_http_metrics
from app.storage import storage, target_from_model


def _service_check(name: str, callback) -> tuple[MonitoringSnapshot, float]:
    started = time.perf_counter()
    try:
        details = callback() or {}
        latency = round((time.perf_counter() - started) * 1000, 1)
        return MonitoringSnapshot(category="service", metric_key=name, status="healthy", value=latency, unit="ms", metrics=details), 1
    except Exception as exc:
        latency = round((time.perf_counter() - started) * 1000, 1)
        return MonitoringSnapshot(category="service", metric_key=name, status="critical", value=latency, unit="ms", message=str(exc)[:500], metrics={}), 0


def _redis_ping() -> dict:
    client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
    try:
        return {"pong": client.ping()}
    finally:
        client.close()


def _job_metrics(db: Session) -> dict[str, float]:
    since = now() - timedelta(minutes=10)
    jobs = [*db.scalars(select(ExportJob).where(ExportJob.created_at >= since)).all(), *db.scalars(select(AIJob).where(AIJob.created_at >= since)).all()]
    all_active = [*db.scalars(select(ExportJob).where(ExportJob.status.in_([JobStatus.queued, JobStatus.running]))).all(), *db.scalars(select(AIJob).where(AIJob.status.in_([JobStatus.queued, JobStatus.running]))).all()]
    failed = sum(item.status == JobStatus.failed for item in jobs)
    finished = sum(item.status in [JobStatus.complete, JobStatus.failed, JobStatus.cancelled] for item in jobs)
    current_time = now()
    def age(item):
        created = item.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=current_time.tzinfo)
        return (current_time - created).total_seconds()
    return {
        "queued": sum(item.status == JobStatus.queued for item in all_active),
        "running": sum(item.status == JobStatus.running for item in all_active),
        "long_running": sum(age(item) > 1200 for item in all_active),
        "failure_rate_10m": round(failed / finished * 100, 2) if finished else 0,
        "completed_10m": sum(item.status == JobStatus.complete for item in jobs),
        "failed_10m": failed,
    }


def _ai_metrics(db: Session) -> dict[str, float]:
    since = now() - timedelta(minutes=10)
    usage = db.scalars(select(AIUsageRecord).where(AIUsageRecord.created_at >= since)).all()
    failed = sum(item.status == "failed" for item in usage)
    return {
        "enabled_models": db.scalar(select(func.count(AIModelConfig.id)).where(AIModelConfig.enabled.is_(True))) or 0,
        "requests_10m": len(usage),
        "failure_rate_10m": round(failed / len(usage) * 100, 2) if usage else 0,
        "avg_latency_ms": round(sum(item.latency_ms for item in usage) / len(usage), 1) if usage else 0,
        "tokens_10m": sum(item.total_tokens for item in usage),
    }


def _quota_metrics(db: Session) -> dict[str, float]:
    from app.quota import DEFAULT_LIMITS
    latest_date = db.scalar(select(func.max(QuotaUsageSnapshot.snapshot_date)))
    rows = db.scalars(select(QuotaUsageSnapshot).where(QuotaUsageSnapshot.snapshot_date == latest_date)).all() if latest_date else []
    by_space: dict[str, list[QuotaUsageSnapshot]] = {}
    by_metric: dict[str, list[QuotaUsageSnapshot]] = {key: [] for key in DEFAULT_LIMITS}
    for row in rows:
        by_space.setdefault(row.organization_id, []).append(row)
        by_metric.setdefault(row.metric_key, []).append(row)
    warning = sum(any(item.limit and 80 <= item.usage_percent < 100 for item in items) and not any(item.limit and item.usage_percent >= 100 for item in items) for items in by_space.values())
    exceeded = sum(any(item.limit and item.usage_percent >= 100 for item in items) for items in by_space.values())
    result: dict[str, float] = {
        "quota.spaces.warning_count": float(warning),
        "quota.spaces.exceeded_count": float(exceeded),
    }
    all_utilization = []
    for key in DEFAULT_LIMITS:
        metric_rows = by_metric.get(key, [])
        maximum = max((item.usage_percent for item in metric_rows if item.limit), default=0)
        result[f"quota.{key}.max_utilization_percent"] = round(float(maximum), 2)
        all_utilization.append(maximum)
    result["quota.spaces.max_utilization_percent"] = round(float(max(all_utilization, default=0)), 2)
    totals = {key: float(sum(item.used for item in by_metric.get(key, []))) for key in DEFAULT_LIMITS}
    result.update({
        "quota.storage.total_used_bytes": totals["storage_bytes"],
        "quota.ai_tokens.monthly_used": totals["monthly_ai_tokens"],
        "quota.download_bytes.monthly_used": totals["monthly_download_bytes"],
        "quota.exports.monthly_used": totals["monthly_exports"],
        "quota.video_minutes.monthly_used": totals["monthly_video_minutes"],
        "quota.spaces.total": float(db.scalar(select(func.count(Organization.id)).where(Organization.status == "active")) or 0),
        "quota.plans.total": float(db.scalar(select(func.count(QuotaPlan.id))) or 0),
    })
    storage_capacity = sum(item.limit or 0 for item in by_metric.get("storage_bytes", []))
    result["quota.storage.capacity_percent"] = round(totals["storage_bytes"] / storage_capacity * 100, 2) if storage_capacity else 0
    previous_date = db.scalar(select(func.max(QuotaUsageSnapshot.snapshot_date)).where(QuotaUsageSnapshot.snapshot_date < latest_date)) if latest_date else None
    previous_storage = db.scalar(select(func.sum(QuotaUsageSnapshot.used)).where(QuotaUsageSnapshot.snapshot_date == previous_date, QuotaUsageSnapshot.metric_key == "storage_bytes")) if previous_date else 0
    result["quota.storage.growth_24h_percent"] = round((totals["storage_bytes"] - float(previous_storage or 0)) / float(previous_storage) * 100, 2) if previous_storage else (100.0 if totals["storage_bytes"] else 0)
    thirty_days_ago = now() - timedelta(days=30)
    existing_spaces = db.scalar(select(func.count(Organization.id)).where(Organization.status == "active", Organization.created_at < thirty_days_ago)) or 0
    result["quota.spaces.growth_30d_percent"] = round((result["quota.spaces.total"] - existing_spaces) / existing_spaces * 100, 2) if existing_spaces else (100.0 if result["quota.spaces.total"] else 0)
    plans = db.scalars(select(QuotaPlan)).all()
    default_plan = next((plan for plan in plans if plan.is_default), plans[0] if plans else None)
    assignments = {item.organization_id: item.plan_id for item in db.scalars(select(OrganizationQuotaAssignment)).all()}
    plan_totals: dict[str, int] = {}
    plan_existing: dict[str, int] = {}
    for organization in db.scalars(select(Organization).where(Organization.status == "active")).all():
        plan_id = assignments.get(organization.id) or (default_plan.id if default_plan else "unassigned")
        plan_totals[plan_id] = plan_totals.get(plan_id, 0) + 1
        if organization.created_at.date() < thirty_days_ago.date():
            plan_existing[plan_id] = plan_existing.get(plan_id, 0) + 1
    plan_growth = [round((total - plan_existing.get(plan_id, 0)) / plan_existing[plan_id] * 100, 2) if plan_existing.get(plan_id) else (100.0 if total else 0) for plan_id, total in plan_totals.items()]
    result["quota.plans.largest_space_count"] = float(max(plan_totals.values(), default=0))
    result["quota.plans.max_growth_30d_percent"] = float(max(plan_growth, default=0))
    return result


def collect_monitoring(db: Session) -> dict[str, float]:
    collected_at = now()
    postgres, postgres_ok = _service_check("postgres", lambda: {"result": db.execute(text("SELECT 1")).scalar_one()})
    redis_snapshot, redis_ok = _service_check("redis", _redis_ping)
    disk = shutil.disk_usage(storage.root)
    storage_metrics = {"total_bytes": disk.total, "used_bytes": disk.used, "free_bytes": disk.free, "free_percent": round(disk.free / disk.total * 100, 2)}
    storage_snapshot = MonitoringSnapshot(category="service", metric_key="storage", status="critical" if storage_metrics["free_percent"] <= 10 else "warning" if storage_metrics["free_percent"] <= 20 else "healthy", value=storage_metrics["free_percent"], unit="percent", metrics=storage_metrics)
    configured = db.scalars(select(StorageConfig).where(StorageConfig.enabled.is_(True))).all()
    if configured:
        try:
            latency = storage.test_target(target_from_model(configured[0]))
            storage_snapshot.metrics = {**storage_metrics, "target": configured[0].name, "latency_ms": latency}
        except Exception as exc:
            storage_snapshot.status = "critical"; storage_snapshot.message = str(exc)[:500]

    http = read_http_metrics(5)
    api_snapshot = MonitoringSnapshot(category="traffic", metric_key="api", status="critical" if http["error_rate"] >= 10 else "warning" if http["error_rate"] >= 5 else "healthy", value=http["p95_latency_ms"], unit="ms", metrics=http)
    jobs = _job_metrics(db)
    job_snapshot = MonitoringSnapshot(category="jobs", metric_key="jobs", status="critical" if jobs["queued"] >= 50 else "warning" if jobs["queued"] >= 20 or jobs["long_running"] else "healthy", value=jobs["queued"], unit="jobs", metrics=jobs)
    ai = _ai_metrics(db)
    quota = _quota_metrics(db)
    ai_snapshot = MonitoringSnapshot(category="ai", metric_key="ai", status="warning" if ai["failure_rate_10m"] >= 30 else "healthy", value=ai["failure_rate_10m"], unit="percent", metrics=ai)
    worker_snapshot = MonitoringSnapshot(category="service", metric_key="worker", status="healthy", value=0, unit="seconds", metrics={"collector": "online"})
    quota_snapshot = MonitoringSnapshot(category="quota", metric_key="quota", status="critical" if quota["quota.spaces.exceeded_count"] else "warning" if quota["quota.spaces.warning_count"] else "healthy", value=quota["quota.spaces.max_utilization_percent"], unit="percent", metrics=quota)
    for item in [postgres, redis_snapshot, storage_snapshot, api_snapshot, job_snapshot, ai_snapshot, worker_snapshot, quota_snapshot]:
        item.collected_at = collected_at
        db.add(item)
    retention_days = monitoring_runtime_config(db).retention_days
    db.execute(delete(MonitoringSnapshot).where(MonitoringSnapshot.collected_at < collected_at - timedelta(days=retention_days)))
    db.commit()

    observations = {
        "service.postgres.available": postgres_ok,
        "service.redis.available": redis_ok,
        "api.error_rate_5m": http["error_rate"],
        "jobs.queued": jobs["queued"],
        "jobs.failure_rate_10m": jobs["failure_rate_10m"],
        "jobs.long_running": jobs["long_running"],
        "storage.free_percent": storage_metrics["free_percent"],
        "ai.failure_rate_10m": ai["failure_rate_10m"],
        **quota,
    }
    evaluate_rules(db, observations)
    return observations
