import shutil
import time
from datetime import timedelta

import redis
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AIJob, AIModelConfig, AIUsageRecord, AlertEvent, ExportJob, JobStatus, MonitoringSnapshot, StorageConfig, now
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
    ai_snapshot = MonitoringSnapshot(category="ai", metric_key="ai", status="warning" if ai["failure_rate_10m"] >= 30 else "healthy", value=ai["failure_rate_10m"], unit="percent", metrics=ai)
    worker_snapshot = MonitoringSnapshot(category="service", metric_key="worker", status="healthy", value=0, unit="seconds", metrics={"collector": "online"})
    for item in [postgres, redis_snapshot, storage_snapshot, api_snapshot, job_snapshot, ai_snapshot, worker_snapshot]:
        item.collected_at = collected_at
        db.add(item)
    db.execute(delete(MonitoringSnapshot).where(MonitoringSnapshot.collected_at < collected_at - timedelta(days=settings.monitoring_retention_days)))
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
    }
    evaluate_rules(db, observations)
    return observations
