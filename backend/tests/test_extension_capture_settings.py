from app.database import SessionLocal
from app.models import AuditLog


def test_extension_capture_settings_default_update_and_runtime_config(authenticated):
    current = authenticated.get("/api/admin/settings/extension-capture")
    assert current.status_code == 200
    assert current.json()["feedback_duration_ms"] == 1100
    assert current.json()["min_feedback_duration_ms"] == 500
    assert current.json()["max_feedback_duration_ms"] == 3000

    updated = authenticated.patch("/api/admin/settings/extension-capture", json={"feedback_duration_ms": 1450})
    assert updated.status_code == 200
    assert updated.json()["feedback_duration_ms"] == 1450

    extension = authenticated.get("/api/extension/config")
    assert extension.status_code == 200
    assert extension.json()["capture_feedback_duration_ms"] == 1450

    with SessionLocal() as db:
        assert db.query(AuditLog).filter(AuditLog.action == "platform_extension_capture.updated").count() == 1


def test_extension_capture_settings_validates_bounds(authenticated):
    for value in (499, 3001):
        response = authenticated.patch("/api/admin/settings/extension-capture", json={"feedback_duration_ms": value})
        assert response.status_code == 422
