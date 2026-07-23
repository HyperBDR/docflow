import io
import json

from PIL import Image

from app.database import SessionLocal
from app.models import AuditLog, Demo, OrganizationMember


def add_step(client, demo_id: str, event_id: str = "transfer-step"):
    output = io.BytesIO()
    Image.new("RGB", (160, 90), "white").save(output, "PNG")
    response = client.post(
        f"/api/recordings/{demo_id}/steps",
        data={"meta": json.dumps({
            "event_id": event_id,
            "title": "Transfer step",
            "body": "Stored content",
            "viewport_width": 160,
            "viewport_height": 90,
            "hotspot": {"x": .2, "y": .3, "w": .1, "h": .1},
            "duration": 3,
        })},
        files={"screenshot": ("screen.png", output.getvalue(), "image/png")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def make_spaces_and_demo(client):
    user = client.get("/api/auth/me").json()
    personal = next(item for item in client.get("/api/organizations").json() if item["kind"] == "personal")
    team = client.post("/api/organizations", json={"name": "Transfer target"})
    assert team.status_code == 201, team.text
    demo = client.post("/api/demos", json={"title": "Transfer me"}).json()
    step = add_step(client, demo["id"])
    return user, personal, team.json(), demo, step


def assign_target_limits(client, organization_id: str, **overrides):
    plans = client.get("/api/admin/quota-plans").json()
    assert plans
    response = client.put(
        f"/api/admin/organizations/{organization_id}/quota",
        json={"plan_id": plans[0]["id"], "overrides": overrides},
    )
    assert response.status_code == 200, response.text


def test_owner_can_copy_resource_to_owned_space(authenticated):
    _, personal, team, demo, source_step = make_spaces_and_demo(authenticated)
    response = authenticated.post(f"/api/demos/{demo['id']}/transfer", json={
        "action": "copy", "target_organization_id": team["id"],
    })
    assert response.status_code == 201, response.text
    copied = response.json()
    assert copied["id"] != demo["id"]
    assert copied["organization_id"] == team["id"]
    assert copied["status"] == "draft"
    assert copied["share_url"] is None
    assert copied["category_id"] is None
    assert copied["tags"] == []
    assert len(copied["steps"]) == 1
    assert copied["steps"][0]["id"] != source_step["id"]

    with SessionLocal() as db:
        original = db.get(Demo, demo["id"])
        assert original.organization_id == personal["id"]
        audit = db.query(AuditLog).filter(AuditLog.action == "resource.copied_to_space").one()
        assert audit.after["organization_id"] == team["id"]


def test_owner_can_move_resource_and_taxonomy_is_cleared(authenticated):
    user, _, team, demo, _ = make_spaces_and_demo(authenticated)
    category = authenticated.post("/api/categories", json={"name": "Source category"}).json()
    tag = authenticated.post("/api/tags", json={"name": "Source tag"}).json()
    authenticated.patch(f"/api/demos/{demo['id']}", json={"category_id": category["id"], "tag_ids": [tag["id"]]})
    published = authenticated.post(f"/api/demos/{demo['id']}/publish", json={})
    assert published.status_code == 200, published.text
    share_url = published.json()["share_url"]

    response = authenticated.post(f"/api/demos/{demo['id']}/transfer", json={
        "action": "move", "target_organization_id": team["id"],
    })
    assert response.status_code == 201, response.text
    moved = response.json()
    assert moved["id"] == demo["id"]
    assert moved["organization_id"] == team["id"]
    assert moved["created_by"]["id"] == user["id"]
    assert moved["status"] == "published"
    assert moved["share_url"] == share_url
    assert moved["category_id"] is None
    assert moved["tags"] == []


def test_platform_admin_cannot_bypass_double_owner_requirement(authenticated):
    user, _, team, demo, _ = make_spaces_and_demo(authenticated)
    with SessionLocal() as db:
        membership = db.query(OrganizationMember).filter_by(
            user_id=user["id"], organization_id=team["id"],
        ).one()
        membership.role = "editor"
        db.commit()

    response = authenticated.post(f"/api/demos/{demo['id']}/transfer", json={
        "action": "copy", "target_organization_id": team["id"],
    })
    assert response.status_code == 403
    assert response.json()["code"] == "resource.transfer_owner_required"


def test_target_quota_is_enforced_before_copy(authenticated):
    _, _, team, demo, _ = make_spaces_and_demo(authenticated)
    assign_target_limits(authenticated, team["id"], resources=0)
    response = authenticated.post(f"/api/demos/{demo['id']}/transfer", json={
        "action": "copy", "target_organization_id": team["id"],
    })
    assert response.status_code == 403
    assert response.json()["code"] == "quota.resources_exceeded"


def test_target_storage_quota_counts_transferred_capture_objects(authenticated):
    _, _, team, demo, _ = make_spaces_and_demo(authenticated)
    assign_target_limits(authenticated, team["id"], resources=100, storage_bytes=0)
    response = authenticated.post(f"/api/demos/{demo['id']}/transfer", json={
        "action": "copy", "target_organization_id": team["id"],
    })
    assert response.status_code == 403
    assert response.json()["code"] == "quota.storage_bytes_exceeded"


def test_move_rejects_active_recording(authenticated):
    _, _, team, demo, _ = make_spaces_and_demo(authenticated)
    session = authenticated.post(f"/api/recordings/{demo['id']}/sessions", json={
        "mode": "html", "ai_enabled": False, "auto_created": False,
    })
    assert session.status_code == 201, session.text
    response = authenticated.post(f"/api/demos/{demo['id']}/transfer", json={
        "action": "move", "target_organization_id": team["id"],
    })
    assert response.status_code == 409
    assert response.json()["code"] == "resource.transfer_recording_active"
