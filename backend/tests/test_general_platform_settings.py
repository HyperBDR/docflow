from app.database import SessionLocal
from app.models import AuditLog, GeneralPlatformSettings


def register(client, email: str):
    response = client.post("/api/auth/register", json={"email": email, "password": "correct-horse"})
    assert response.status_code == 201
    return response.json()


def test_public_config_is_empty_until_admin_configures_help_url(client):
    assert client.get("/api/platform/config").json() == {"help_url": "", "upgrade_url": ""}
    register(client, "admin@example.com")
    saved = client.patch("/api/admin/settings/general", json={"help_url": " https://docs.example.com/help ", "upgrade_url": " https://billing.example.com/upgrade "})
    assert saved.status_code == 200
    assert saved.json()["help_url"] == "https://docs.example.com/help"
    assert saved.json()["upgrade_url"] == "https://billing.example.com/upgrade"
    assert client.get("/api/platform/config").json() == {"help_url": "https://docs.example.com/help", "upgrade_url": "https://billing.example.com/upgrade"}
    with SessionLocal() as db:
        value = db.get(GeneralPlatformSettings, "default")
        assert value.help_url == "https://docs.example.com/help"
        assert value.upgrade_url == "https://billing.example.com/upgrade"
        assert db.query(AuditLog).filter(AuditLog.action == "platform_general.updated").count() == 1


def test_help_url_can_be_cleared_and_rejects_unsafe_urls(client):
    register(client, "admin@example.com")
    for invalid in ("javascript:alert(1)", "//docs.example.com", "https://user:secret@docs.example.com", "https://docs.example.com\ninvalid", "https://docs.example.com:bad"):
        assert client.patch("/api/admin/settings/general", json={"help_url": invalid, "upgrade_url": ""}).status_code == 422
        assert client.patch("/api/admin/settings/general", json={"help_url": "", "upgrade_url": invalid}).status_code == 422
    assert client.patch("/api/admin/settings/general", json={"help_url": "https://docs.example.com", "upgrade_url": "https://billing.example.com"}).status_code == 200
    cleared = client.patch("/api/admin/settings/general", json={"help_url": ""})
    assert cleared.status_code == 200
    assert cleared.json()["help_url"] == ""
    assert client.get("/api/platform/config").json()["help_url"] == ""


def test_regular_user_cannot_change_general_settings(client):
    register(client, "first-admin@example.com")
    client.post("/api/auth/logout")
    register(client, "regular@example.com")
    assert client.get("/api/admin/settings/general").status_code == 403
    assert client.patch("/api/admin/settings/general", json={"help_url": "https://docs.example.com"}).status_code == 403
    assert client.get("/api/platform/config").status_code == 200
