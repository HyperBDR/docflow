from unittest.mock import patch

from app.database import SessionLocal
from app.models import AlertEvent, AlertRule, MonitoringSnapshot, NotificationChannel
from app.monitoring.alert_engine import ensure_default_rules, evaluate_rules
from app.secrets import decrypt_secret


def register(client, email: str):
    response = client.post("/api/auth/register", json={"email": email, "password": "correct-horse"})
    assert response.status_code == 201
    return response.json()


def test_monitoring_collection_and_overview(client):
    register(client, "monitor-admin@example.com")
    initial = client.get("/api/admin/monitoring/overview")
    assert initial.status_code == 200
    assert initial.json()["collector_stale"] is True

    with patch("app.monitoring.collector.read_http_metrics", return_value={
        "available": 1, "requests": 24, "status_2xx": 22, "status_4xx": 1,
        "status_5xx": 1, "error_rate": 4.17, "avg_latency_ms": 42, "p95_latency_ms": 100,
    }):
        collected = client.post("/api/admin/monitoring/collect")
    assert collected.status_code == 202
    value = client.get("/api/admin/monitoring/overview").json()
    assert value["collector_stale"] is False
    assert value["api"]["requests"] == 24
    assert value["jobs"]["queued"] == 0
    assert len(value["services"]) == 4
    assert {item["key"] for item in value["services"]} == {"postgres", "redis", "storage", "worker"}
    with SessionLocal() as db:
        assert db.query(MonitoringSnapshot).count() == 7
        assert db.query(AlertRule).filter(AlertRule.built_in.is_(True)).count() == 8


def test_alert_engine_consecutive_trigger_and_recovery():
    with SessionLocal() as db:
        ensure_default_rules(db)
        rule = db.query(AlertRule).filter(AlertRule.metric_key == "api.error_rate_5m").one()
        rule.consecutive_periods = 2
        db.commit()
        assert evaluate_rules(db, {"api.error_rate_5m": 8}) == []
        triggered = evaluate_rules(db, {"api.error_rate_5m": 8})
        assert len(triggered) == 1
        event = triggered[0]
        assert event.status == "active"
        assert event.severity == "critical"
        recovered = evaluate_rules(db, {"api.error_rate_5m": 0})
        assert len(recovered) == 1
        assert recovered[0].status == "resolved"
        assert recovered[0].resolved_at is not None


def test_alert_rule_event_and_notification_channel_management(client):
    register(client, "monitor-config@example.com")
    metrics = client.get("/api/admin/monitoring/metrics")
    assert metrics.status_code == 200
    rule = client.post("/api/admin/monitoring/rules", json={
        "name": "Custom queue alert", "metric_key": "jobs.queued", "operator": "gte",
        "threshold": 5, "severity": "warning", "consecutive_periods": 1,
        "cooldown_minutes": 10, "enabled": True,
    })
    assert rule.status_code == 201
    rule_id = rule.json()["id"]
    updated = client.patch(f"/api/admin/monitoring/rules/{rule_id}", json={"threshold": 7})
    assert updated.json()["threshold"] == 7
    assert client.post("/api/admin/monitoring/rules", json={
        "name": "Unsupported", "metric_key": "host.cpu", "operator": "gte",
        "threshold": 90, "severity": "warning", "consecutive_periods": 1,
        "cooldown_minutes": 10, "enabled": True,
    }).status_code == 422

    created = client.post("/api/admin/monitoring/channels", json={
        "name": "Operations webhook", "kind": "webhook",
        "target": "https://alerts.example.com/docflow-secret", "minimum_severity": "warning", "enabled": True,
    })
    assert created.status_code == 201
    channel_value = created.json()
    assert "docflow-secret" not in str(channel_value)
    with SessionLocal() as db:
        channel = db.get(NotificationChannel, channel_value["id"])
        assert "alerts.example.com" not in channel.target_encrypted
        assert decrypt_secret(channel.target_encrypted).endswith("docflow-secret")
        alert = AlertEvent(
            rule_id=rule_id, metric_key="jobs.queued", severity="warning", title="Queue alert",
            message="queue threshold exceeded", current_value=8, threshold=7,
        )
        db.add(alert); db.commit(); alert_id = alert.id

    listed = client.get("/api/admin/monitoring/alerts", params={"status": "active"}).json()
    assert listed["total"] == 1
    acknowledged = client.post(f"/api/admin/monitoring/alerts/{alert_id}/acknowledge")
    assert acknowledged.json()["status"] == "acknowledged"
    assert acknowledged.json()["acknowledged_by_name"]
    with patch("app.routers.monitoring.test_channel"):
        tested = client.post(f"/api/admin/monitoring/channels/{channel_value['id']}/test")
    assert tested.json()["last_status"] == "success"
    assert client.delete(f"/api/admin/monitoring/channels/{channel_value['id']}").status_code == 204
    assert client.delete(f"/api/admin/monitoring/rules/{rule_id}").status_code == 204


def test_regular_user_cannot_access_monitoring(client):
    register(client, "first-admin@example.com")
    client.post("/api/auth/logout")
    register(client, "regular-monitor@example.com")
    assert client.get("/api/admin/monitoring/overview").status_code == 403
