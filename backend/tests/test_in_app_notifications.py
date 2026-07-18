from app.database import SessionLocal
from app.in_app_notifications import create_notification


def test_notification_inbox_read_state_and_scope(authenticated):
    user = authenticated.get("/api/auth/me").json()
    organization_id = user["active_organization_id"]
    with SessionLocal() as db:
        user_notice = create_notification(
            db, user["id"], "system.welcome", organization_id=organization_id,
            category="system", title="Welcome", message="Welcome to DocFlow",
            action_url="/overview", dedupe_key="welcome-test",
        )
        admin_notice = create_notification(
            db, user["id"], "alert.triggered", scope="admin", category="alert",
            severity="critical", title="Alert", action_url="/admin/monitoring/alerts",
            dedupe_key="alert-test",
        )
        db.commit(); user_id, admin_id = user_notice.id, admin_notice.id

    inbox = authenticated.get("/api/notifications", params={"scope": "user"})
    assert inbox.status_code == 200
    assert inbox.json()["unread"] == 1
    assert inbox.json()["items"][0]["event_type"] == "system.welcome"
    marked = authenticated.patch(f"/api/notifications/{user_id}/read")
    assert marked.status_code == 200 and marked.json()["read_at"]
    assert authenticated.get("/api/notifications", params={"scope": "user"}).json()["unread"] == 0

    admin = authenticated.get("/api/notifications", params={"scope": "admin"})
    assert admin.status_code == 200 and admin.json()["unread"] == 1
    assert authenticated.post("/api/notifications/read-all", params={"scope": "admin"}).json()["updated"] == 1
    assert authenticated.patch(f"/api/notifications/{admin_id}/read").status_code == 200


def test_quota_collection_creates_deduplicated_user_and_admin_notifications(authenticated):
    summary = authenticated.get("/api/workspace/quotas").json()
    organization_id = summary["organization_id"]
    plan_id = summary["plan"]["id"]
    assert authenticated.put(
        f"/api/admin/organizations/{organization_id}/quota",
        json={"plan_id": plan_id, "overrides": {"resources": 1}},
    ).status_code == 200
    assert authenticated.post("/api/demos", json={"title": "Quota notification"}).status_code == 201
    assert authenticated.post("/api/admin/quotas/collect").status_code == 200

    user_items = authenticated.get("/api/notifications", params={"scope": "user", "category": "quota"}).json()["items"]
    admin_items = authenticated.get("/api/notifications", params={"scope": "admin", "category": "quota"}).json()["items"]
    assert any(item["event_type"] == "quota.exceeded" and item["data"]["metric_key"] == "resources" for item in user_items)
    assert any(item["event_type"] == "quota.admin_exceeded" for item in admin_items)
    before = (len(user_items), len(admin_items))
    authenticated.post("/api/admin/quotas/collect")
    after = (
        len(authenticated.get("/api/notifications", params={"scope": "user", "category": "quota"}).json()["items"]),
        len(authenticated.get("/api/notifications", params={"scope": "admin", "category": "quota"}).json()["items"]),
    )
    assert after == before


def test_regular_user_cannot_read_admin_notification_scope(client):
    assert client.post("/api/auth/register", json={"email": "first@example.com", "password": "correct-horse"}).status_code == 201
    client.post("/api/auth/logout")
    assert client.post("/api/auth/register", json={"email": "member@example.com", "password": "correct-horse"}).status_code == 201
    assert client.get("/api/notifications", params={"scope": "admin"}).status_code == 403
