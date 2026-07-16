from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AlertEvent, AlertRule, now
from app.monitoring.notifications import dispatch_notifications


DEFAULT_RULES = [
    ("API 5xx error rate", "api.error_rate_5m", "gte", 5, "critical", 2, 15),
    ("Queued task backlog", "jobs.queued", "gte", 20, "warning", 2, 15),
    ("Task failure rate", "jobs.failure_rate_10m", "gte", 20, "warning", 2, 15),
    ("Long-running tasks", "jobs.long_running", "gte", 1, "warning", 1, 15),
    ("Low storage capacity", "storage.free_percent", "lte", 15, "critical", 2, 30),
    ("AI request failure rate", "ai.failure_rate_10m", "gte", 30, "warning", 2, 15),
    ("PostgreSQL unavailable", "service.postgres.available", "lt", 1, "critical", 2, 10),
    ("Redis unavailable", "service.redis.available", "lt", 1, "critical", 2, 10),
]


def ensure_default_rules(db: Session) -> None:
    existing = set(db.scalars(select(AlertRule.metric_key).where(AlertRule.built_in.is_(True))).all())
    for name, key, operator, threshold, severity, periods, cooldown in DEFAULT_RULES:
        if key not in existing:
            db.add(AlertRule(
                name=name, metric_key=key, operator=operator, threshold=threshold,
                severity=severity, consecutive_periods=periods,
                cooldown_minutes=cooldown, built_in=True,
            ))
    db.commit()


def _matches(value: float, operator: str, threshold: float) -> bool:
    return {"gt": value > threshold, "gte": value >= threshold, "lt": value < threshold, "lte": value <= threshold, "eq": value == threshold}.get(operator, False)


def evaluate_rules(db: Session, observations: dict[str, float]) -> list[AlertEvent]:
    ensure_default_rules(db)
    changed: list[AlertEvent] = []
    notifications: list[tuple[AlertEvent, bool]] = []
    current_time = now()
    for rule in db.scalars(select(AlertRule).where(AlertRule.enabled.is_(True))).all():
        if rule.metric_key not in observations:
            continue
        value = float(observations[rule.metric_key])
        rule.last_value = value
        rule.last_evaluated_at = current_time
        active = db.scalar(select(AlertEvent).where(
            AlertEvent.rule_id == rule.id,
            AlertEvent.status.in_(["active", "acknowledged"]),
        ).order_by(AlertEvent.started_at.desc()))
        if _matches(value, rule.operator, rule.threshold):
            rule.failure_count += 1
            if active:
                active.current_value = value
                active.last_seen_at = current_time
            elif rule.failure_count >= max(1, rule.consecutive_periods):
                in_cooldown = rule.last_triggered_at and rule.last_triggered_at > current_time - timedelta(minutes=rule.cooldown_minutes)
                active = AlertEvent(
                    rule_id=rule.id, metric_key=rule.metric_key, severity=rule.severity,
                    title=rule.name, message=f"{rule.metric_key} is {value:g}; threshold {rule.operator} {rule.threshold:g}",
                    current_value=value, threshold=rule.threshold,
                )
                db.add(active)
                changed.append(active)
                if not in_cooldown:
                    rule.last_triggered_at = current_time
                    notifications.append((active, False))
        else:
            rule.failure_count = 0
            if active:
                active.status = "resolved"
                active.current_value = value
                active.last_seen_at = current_time
                active.resolved_at = current_time
                changed.append(active)
                notifications.append((active, True))
    db.commit()
    for event, recovered in notifications:
        dispatch_notifications(db, event, recovered)
    return changed
