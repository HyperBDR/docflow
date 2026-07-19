from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import admin_user
from app.models import AlertEvent, AlertRule, MonitoringSnapshot, NotificationChannel, User, now
from app.platform_settings import monitoring_runtime_config
from app.monitoring.alert_engine import ensure_default_rules
from app.monitoring.notifications import test_channel
from app.monitoring_schemas import (
    AlertEventOut,
    AlertEventPage,
    AlertRuleInput,
    AlertRuleOut,
    AlertRuleUpdate,
    MetricHistoryPoint,
    MetricDefinition,
    MonitoringMetricDetail,
    MonitoringOverview,
    MonitoringServiceOut,
    MonitoringTrendPoint,
    NotificationChannelInput,
    NotificationChannelOut,
    NotificationChannelUpdate,
)
from app.secrets import decrypt_secret, encrypt_secret
from app.services import write_audit


router = APIRouter(prefix="/api/admin/monitoring", tags=["admin-monitoring"])
METRICS = [
    MetricDefinition(key="api.error_rate_5m", unit="percent", recommended_operator="gte", recommended_threshold=5),
    MetricDefinition(key="jobs.queued", unit="jobs", recommended_operator="gte", recommended_threshold=20),
    MetricDefinition(key="jobs.failure_rate_10m", unit="percent", recommended_operator="gte", recommended_threshold=20),
    MetricDefinition(key="jobs.long_running", unit="jobs", recommended_operator="gte", recommended_threshold=1),
    MetricDefinition(key="storage.free_percent", unit="percent", recommended_operator="lte", recommended_threshold=15),
    MetricDefinition(key="ai.failure_rate_10m", unit="percent", recommended_operator="gte", recommended_threshold=30),
    MetricDefinition(key="service.postgres.available", unit="boolean", recommended_operator="lt", recommended_threshold=1),
    MetricDefinition(key="service.redis.available", unit="boolean", recommended_operator="lt", recommended_threshold=1),
    MetricDefinition(key="quota.spaces.warning_count", unit="spaces", recommended_operator="gte", recommended_threshold=1),
    MetricDefinition(key="quota.spaces.exceeded_count", unit="spaces", recommended_operator="gte", recommended_threshold=1),
    MetricDefinition(key="quota.spaces.max_utilization_percent", unit="percent", recommended_operator="gte", recommended_threshold=90),
    MetricDefinition(key="quota.storage.total_used_bytes", unit="bytes", recommended_operator="gte", recommended_threshold=107374182400),
    MetricDefinition(key="quota.storage.growth_24h_percent", unit="percent", recommended_operator="gte", recommended_threshold=20),
    MetricDefinition(key="quota.storage.capacity_percent", unit="percent", recommended_operator="gte", recommended_threshold=85),
    MetricDefinition(key="quota.ai_tokens.monthly_used", unit="tokens", recommended_operator="gte", recommended_threshold=10000000),
    MetricDefinition(key="quota.download_bytes.monthly_used", unit="bytes", recommended_operator="gte", recommended_threshold=107374182400),
    MetricDefinition(key="quota.exports.monthly_used", unit="exports", recommended_operator="gte", recommended_threshold=10000),
    MetricDefinition(key="quota.video_minutes.monthly_used", unit="minutes", recommended_operator="gte", recommended_threshold=10000),
    MetricDefinition(key="quota.spaces.total", unit="spaces", recommended_operator="gte", recommended_threshold=10000),
    MetricDefinition(key="quota.spaces.growth_30d_percent", unit="percent", recommended_operator="gte", recommended_threshold=30),
    MetricDefinition(key="quota.plans.total", unit="plans", recommended_operator="gte", recommended_threshold=100),
    MetricDefinition(key="quota.plans.largest_space_count", unit="spaces", recommended_operator="gte", recommended_threshold=1000),
    MetricDefinition(key="quota.plans.max_growth_30d_percent", unit="percent", recommended_operator="gte", recommended_threshold=30),
    *[MetricDefinition(key=f"quota.{key}.max_utilization_percent", unit="percent", recommended_operator="gte", recommended_threshold=90) for key in [
        "storage_bytes", "resources", "max_steps_per_resource", "members", "active_shares", "monthly_ai_tokens", "monthly_exports", "monthly_video_minutes", "monthly_public_views", "monthly_download_bytes",
    ]],
]
METRIC_KEYS = {item.key for item in METRICS}
DETAIL_SNAPSHOTS = {
    "postgres": "postgres", "redis": "redis", "storage": "storage", "worker": "worker",
    "api.requests": "api", "api.latency": "api", "api.error_rate": "api",
    "jobs.queue": "jobs", "storage.capacity": "storage", "ai.failure_rate": "ai",
}
RANGES = {"1h": timedelta(hours=1), "6h": timedelta(hours=6), "24h": timedelta(hours=24), "7d": timedelta(days=7)}


def _latest(db: Session, key: str) -> MonitoringSnapshot | None:
    return db.scalar(select(MonitoringSnapshot).where(MonitoringSnapshot.metric_key == key).order_by(MonitoringSnapshot.collected_at.desc()).limit(1))


def _service(item: MonitoringSnapshot | None, key: str, stale: bool) -> MonitoringServiceOut:
    if not item:
        return MonitoringServiceOut(key=key, status="unknown")
    return MonitoringServiceOut(
        key=key,
        status="critical" if stale else item.status,
        value=item.value,
        unit=item.unit,
        message="Monitoring collector is stale" if stale else item.message,
        metrics=item.metrics,
        collected_at=item.collected_at,
    )


def _event_out(db: Session, event: AlertEvent) -> AlertEventOut:
    actor = db.get(User, event.acknowledged_by_id) if event.acknowledged_by_id else None
    return AlertEventOut(
        id=event.id, rule_id=event.rule_id, metric_key=event.metric_key,
        severity=event.severity, status=event.status, title=event.title,
        message=event.message, current_value=event.current_value,
        threshold=event.threshold, started_at=event.started_at,
        last_seen_at=event.last_seen_at, acknowledged_at=event.acknowledged_at,
        acknowledged_by_name=(actor.name or actor.email) if actor else "",
        resolved_at=event.resolved_at,
    )


def _mask_target(value: str, kind: str) -> str:
    if not value:
        return ""
    if kind == "email":
        name, _, domain = value.partition("@")
        return f"{name[:2]}***@{domain}" if domain else "***"
    return f"{value[:24]}…{value[-8:]}" if len(value) > 36 else f"{value[:10]}…"


def _channel_out(channel: NotificationChannel) -> NotificationChannelOut:
    target = decrypt_secret(channel.target_encrypted)
    return NotificationChannelOut(
        id=channel.id, name=channel.name, kind=channel.kind,
        target_masked=_mask_target(target, channel.kind), target_configured=bool(target),
        minimum_severity=channel.minimum_severity, enabled=channel.enabled,
        last_status=channel.last_status, last_error=channel.last_error,
        last_sent_at=channel.last_sent_at, created_at=channel.created_at, updated_at=channel.updated_at,
    )


@router.get("/overview", response_model=MonitoringOverview)
def overview(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    runtime = monitoring_runtime_config(db)
    latest = {key: _latest(db, key) for key in ["postgres", "redis", "storage", "worker", "api", "jobs", "ai"]}
    updated_at = max((item.collected_at for item in latest.values() if item), default=None)
    current_time = now()
    if updated_at and updated_at.tzinfo is None:
        current_time = current_time.replace(tzinfo=None)
    stale = runtime.monitoring_enabled and (not updated_at or updated_at < current_time - timedelta(seconds=max(180, runtime.monitoring_interval_seconds * 3)))
    services = [_service(latest.get(key), key, stale) for key in ["postgres", "redis", "storage", "worker"]]
    statuses = [item.status for item in services] + [item.status for key in ["api", "jobs", "ai"] if (item := latest.get(key))]
    overall = "critical" if "critical" in statuses else "warning" if "warning" in statuses or "unknown" in statuses else "healthy"

    since = current_time - timedelta(hours=24)
    rows = db.scalars(select(MonitoringSnapshot).where(
        MonitoringSnapshot.collected_at >= since,
        MonitoringSnapshot.metric_key.in_(["api", "jobs", "ai"]),
    ).order_by(MonitoringSnapshot.collected_at)).all()
    grouped: dict = {}
    for item in rows:
        grouped.setdefault(item.collected_at, {})[item.metric_key] = item.metrics
    points = [MonitoringTrendPoint(
        collected_at=timestamp,
        requests=values.get("api", {}).get("requests", 0),
        status_2xx=values.get("api", {}).get("status_2xx", 0),
        status_4xx=values.get("api", {}).get("status_4xx", 0),
        status_5xx=values.get("api", {}).get("status_5xx", 0),
        error_rate=values.get("api", {}).get("error_rate", 0),
        avg_latency_ms=values.get("api", {}).get("avg_latency_ms", 0),
        p95_latency_ms=values.get("api", {}).get("p95_latency_ms", 0),
        queued_jobs=values.get("jobs", {}).get("queued", 0),
        failed_jobs=values.get("jobs", {}).get("failed_10m", 0),
        ai_failure_rate=values.get("ai", {}).get("failure_rate_10m", 0),
    ) for timestamp, values in grouped.items()]
    if len(points) > 96:
        step = max(1, len(points) // 96)
        points = points[::step][-96:]
    active = db.execute(select(AlertEvent.severity, func.count(AlertEvent.id)).where(
        AlertEvent.status.in_(["active", "acknowledged"])
    ).group_by(AlertEvent.severity)).all()
    thresholds = {rule.metric_key: rule.threshold for rule in db.scalars(select(AlertRule).where(AlertRule.enabled.is_(True))).all()}
    interval = runtime.monitoring_interval_seconds
    return MonitoringOverview(
        overall_status=overall, services=services,
        api=latest["api"].metrics if latest["api"] else {},
        jobs=latest["jobs"].metrics if latest["jobs"] else {},
        storage=latest["storage"].metrics if latest["storage"] else {},
        ai=latest["ai"].metrics if latest["ai"] else {},
        active_alerts={severity: count for severity, count in active},
        trend=points, thresholds=thresholds, updated_at=updated_at,
        next_collection_at=updated_at + timedelta(seconds=interval) if updated_at and runtime.monitoring_enabled else None,
        interval_seconds=interval, automatic_collection=runtime.monitoring_enabled,
        raw_ranges=runtime.raw_ranges, collector_stale=stale,
    )


@router.post("/collect", status_code=status.HTTP_202_ACCEPTED)
def collect(_: User = Depends(admin_user)):
    from app.worker import collect_platform_monitoring
    task = collect_platform_monitoring.delay()
    return {"task_id": task.id, "queued_at": now()}


@router.get("/details/{key:path}", response_model=MonitoringMetricDetail)
def metric_detail(key: str, range_key: str = Query(default="24h", alias="range"), db: Session = Depends(get_db), _: User = Depends(admin_user)):
    snapshot_key = DETAIL_SNAPSHOTS.get(key)
    if not snapshot_key:
        raise HTTPException(status_code=404, detail="monitoring metric not found")
    duration = RANGES.get(range_key)
    if not duration:
        raise HTTPException(status_code=422, detail="unsupported monitoring range")
    rows = db.scalars(select(MonitoringSnapshot).where(
        MonitoringSnapshot.metric_key == snapshot_key,
        MonitoringSnapshot.collected_at >= now() - duration,
    ).order_by(MonitoringSnapshot.collected_at)).all()
    latest = rows[-1] if rows else _latest(db, snapshot_key)
    points = []
    for item in rows:
        values = {name: float(value) for name, value in item.metrics.items() if isinstance(value, (int, float)) and not isinstance(value, bool)}
        if snapshot_key in {"postgres", "redis", "worker"}:
            values.update({"latency_ms": float(item.value), "available": 0.0 if item.status == "critical" else 1.0})
        points.append(MetricHistoryPoint(collected_at=item.collected_at, status=item.status, values=values))
    if len(points) > 240:
        stride = max(1, len(points) // 240)
        points = points[::stride][-240:]
    summary = dict(latest.metrics) if latest else {}
    if latest:
        summary.update({"value": latest.value, "status": latest.status, "message": latest.message, "collected_at": latest.collected_at.isoformat()})
    breakdown = summary.get("routes", []) if snapshot_key == "api" else []
    alert_prefix = "api." if snapshot_key == "api" else "jobs." if snapshot_key == "jobs" else "storage." if snapshot_key == "storage" else "ai." if snapshot_key == "ai" else f"service.{snapshot_key}."
    alerts = db.scalars(select(AlertEvent).where(AlertEvent.metric_key.startswith(alert_prefix)).order_by(AlertEvent.started_at.desc()).limit(10)).all()
    return MonitoringMetricDetail(
        key=key, snapshot_key=snapshot_key, category=latest.category if latest else "service",
        status=latest.status if latest else "unknown", unit=latest.unit if latest else "",
        summary=summary, points=points, breakdown=breakdown,
        alerts=[_event_out(db, event) for event in alerts],
    )


@router.get("/metrics", response_model=list[MetricDefinition])
def metrics(_: User = Depends(admin_user)):
    return METRICS


@router.get("/rules", response_model=list[AlertRuleOut])
def rules(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    ensure_default_rules(db)
    return db.scalars(select(AlertRule).order_by(AlertRule.built_in.desc(), AlertRule.created_at)).all()


@router.post("/rules", response_model=AlertRuleOut, status_code=201)
def create_rule(payload: AlertRuleInput, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    if payload.metric_key not in METRIC_KEYS:
        raise HTTPException(status_code=422, detail="unsupported monitoring metric")
    rule = AlertRule(**payload.model_dump(), created_by_id=actor.id)
    db.add(rule); db.flush()
    write_audit(db, actor, "alert_rule.created", "alert_rule", rule.id, rule.name, after=payload.model_dump(), request=request)
    db.commit(); db.refresh(rule)
    return rule


@router.patch("/rules/{rule_id}", response_model=AlertRuleOut)
def update_rule(rule_id: str, payload: AlertRuleUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    rule = db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="alert rule not found")
    values = payload.model_dump(exclude_none=True)
    before = {key: getattr(rule, key) for key in values}
    for key, value in values.items():
        setattr(rule, key, value)
    write_audit(db, actor, "alert_rule.updated", "alert_rule", rule.id, rule.name, before=before, after=values, request=request)
    db.commit(); db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    rule = db.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="alert rule not found")
    if rule.built_in:
        raise HTTPException(status_code=409, detail="built-in rules cannot be deleted")
    write_audit(db, actor, "alert_rule.deleted", "alert_rule", rule.id, rule.name, request=request)
    db.delete(rule); db.commit()


@router.get("/alerts", response_model=AlertEventPage)
def alerts(
    status_filter: str = Query(default="", alias="status"), severity: str = "",
    page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db), _: User = Depends(admin_user),
):
    filters = []
    if status_filter:
        filters.append(AlertEvent.status == status_filter)
    if severity:
        filters.append(AlertEvent.severity == severity)
    total = db.scalar(select(func.count(AlertEvent.id)).where(*filters)) or 0
    items = db.scalars(select(AlertEvent).where(*filters).order_by(AlertEvent.started_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return AlertEventPage(items=[_event_out(db, item) for item in items], total=total, page=page, page_size=page_size)


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertEventOut)
def acknowledge(alert_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    event = db.get(AlertEvent, alert_id)
    if not event:
        raise HTTPException(status_code=404, detail="alert event not found")
    if event.status == "active":
        event.status = "acknowledged"; event.acknowledged_at = now(); event.acknowledged_by_id = actor.id
        write_audit(db, actor, "alert.acknowledged", "alert", event.id, event.title, request=request)
        db.commit(); db.refresh(event)
    return _event_out(db, event)


def _validate_target(kind: str, target: str) -> None:
    if kind == "webhook" and not target.startswith(("https://", "http://")):
        raise HTTPException(status_code=422, detail="webhook target must be an HTTP URL")
    if kind == "email" and "@" not in target:
        raise HTTPException(status_code=422, detail="invalid email address")


@router.get("/channels", response_model=list[NotificationChannelOut])
def channels(db: Session = Depends(get_db), _: User = Depends(admin_user)):
    return [_channel_out(item) for item in db.scalars(select(NotificationChannel).order_by(NotificationChannel.created_at)).all()]


@router.post("/channels", response_model=NotificationChannelOut, status_code=201)
def create_channel(payload: NotificationChannelInput, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    _validate_target(payload.kind, payload.target)
    values = payload.model_dump(exclude={"target"})
    channel = NotificationChannel(**values, target_encrypted=encrypt_secret(payload.target), created_by_id=actor.id)
    db.add(channel); db.flush()
    write_audit(db, actor, "notification_channel.created", "notification_channel", channel.id, channel.name, after={**values, "target": "configured"}, request=request)
    db.commit(); db.refresh(channel)
    return _channel_out(channel)


@router.patch("/channels/{channel_id}", response_model=NotificationChannelOut)
def update_channel(channel_id: str, payload: NotificationChannelUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    channel = db.get(NotificationChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="notification channel not found")
    values = payload.model_dump(exclude_none=True)
    target = values.pop("target", None)
    if target:
        _validate_target(channel.kind, target); channel.target_encrypted = encrypt_secret(target)
    before = {key: getattr(channel, key) for key in values}
    for key, value in values.items():
        setattr(channel, key, value)
    write_audit(db, actor, "notification_channel.updated", "notification_channel", channel.id, channel.name, before=before, after={**values, **({"target": "updated"} if target else {})}, request=request)
    db.commit(); db.refresh(channel)
    return _channel_out(channel)


@router.post("/channels/{channel_id}/test", response_model=NotificationChannelOut)
def test_notification_channel(channel_id: str, db: Session = Depends(get_db), _: User = Depends(admin_user)):
    channel = db.get(NotificationChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="notification channel not found")
    try:
        test_channel(db, channel); channel.last_status = "success"; channel.last_error = ""
    except Exception as exc:
        channel.last_status = "failed"; channel.last_error = str(exc)[:500]
    channel.last_sent_at = now(); db.commit(); db.refresh(channel)
    return _channel_out(channel)


@router.delete("/channels/{channel_id}", status_code=204)
def delete_channel(channel_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    channel = db.get(NotificationChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="notification channel not found")
    write_audit(db, actor, "notification_channel.deleted", "notification_channel", channel.id, channel.name, request=request)
    db.delete(channel); db.commit()
