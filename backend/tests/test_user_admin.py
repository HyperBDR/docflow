import io
import json
from datetime import timedelta

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.database import SessionLocal
from app.models import AIJob, AnalyticsEvent, ExportJob, ExtensionToken, JobStatus
from app.security import hash_token, utcnow


def register(client, email: str):
    return client.post("/api/auth/register", json={"email": email, "password": "correct-horse"})


def login(client, email: str, password: str = "correct-horse"):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def logout(client):
    return client.post("/api/auth/logout")


def test_first_account_bootstraps_admin_and_regular_users_are_forbidden(client):
    first = register(client, "admin@example.com")
    assert first.status_code == 201
    assert first.json()["role"] == "admin"
    assert first.json()["name"] == "admin"
    logout(client)

    second = register(client, "member@example.com")
    assert second.status_code == 201
    assert second.json()["role"] == "user"
    forbidden = client.get("/api/admin/overview")
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "admin.forbidden"


def test_personal_profile_and_password_change_revoke_sessions(client):
    registered = register(client, "owner@example.com")
    assert registered.status_code == 201
    updated = client.patch("/api/auth/me", json={"name": "CarltonXu", "ui_locale": "en"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "CarltonXu"
    assert updated.json()["ui_locale"] == "en"

    wrong = client.post("/api/auth/me/password", json={
        "current_password": "wrong-password", "new_password": "brand-new-password",
    })
    assert wrong.status_code == 400
    assert wrong.json()["code"] == "auth.current_password_incorrect"

    changed = client.post("/api/auth/me/password", json={
        "current_password": "correct-horse", "new_password": "brand-new-password",
    })
    assert changed.status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    assert login(client, "owner@example.com").status_code == 401
    assert login(client, "owner@example.com", "brand-new-password").status_code == 200


def test_admin_user_lifecycle_and_safety_guards(client):
    admin = register(client, "admin@example.com").json()
    assert client.post("/api/demos", json={"title": "Admin demo"}).status_code == 201
    logout(client)
    member = register(client, "member@example.com").json()
    assert client.post("/api/demos", json={"title": "Member demo"}).status_code == 201
    logout(client)
    assert login(client, "admin@example.com").status_code == 200

    users = client.get("/api/admin/users")
    assert users.status_code == 200
    assert users.json()["total"] == 2
    values = users.json()["items"]
    member_value = next(item for item in values if item["id"] == member["id"])
    assert member_value["stats"]["demos"] == 1
    assert member_value["stats"]["steps"] == 0
    overview = client.get("/api/admin/overview").json()
    assert overview["users"] == 2
    assert overview["demos"] == 2
    assert overview["recent_exports"] == []
    assert overview["recent_failed_jobs"] == []
    assert overview["top_resources"] == []

    protected = client.patch(f"/api/admin/users/{admin['id']}", json={"role": "user"})
    assert protected.status_code == 400
    assert protected.json()["code"] == "admin.self_protected"
    assert client.delete(f"/api/admin/users/{admin['id']}").json()["code"] == "admin.self_delete"

    updated = client.patch(f"/api/admin/users/{member['id']}", json={
        "name": "Member One", "role": "admin", "ui_locale": "en", "is_active": True,
    })
    assert updated.status_code == 200
    assert updated.json()["role"] == "admin"
    assert updated.json()["name"] == "Member One"

    reset = client.post(f"/api/admin/users/{member['id']}/password", json={"new_password": "reset-password"})
    assert reset.status_code == 204
    disabled = client.patch(f"/api/admin/users/{member['id']}", json={"is_active": False})
    assert disabled.status_code == 200
    assert disabled.json()["is_active"] is False
    logout(client)
    disabled_login = login(client, "member@example.com", "reset-password")
    assert disabled_login.status_code == 401
    assert disabled_login.json()["code"] == "auth.account_disabled"


def test_admin_overview_includes_recent_jobs_and_resource_traffic(client):
    user = register(client, "admin@example.com").json()
    demo = client.post("/api/demos", json={"title": "Traffic report"}).json()
    with SessionLocal() as db:
        db.add_all([
            ExportJob(
                owner_id=user["id"], demo_id=demo["id"], revision_id="revision-1", kind="pdf",
                status=JobStatus.failed, progress=45, error="renderer stopped",
            ),
            AIJob(
                owner_id=user["id"], demo_id=demo["id"], status=JobStatus.failed,
                model="test-model", error="invalid JSON response",
            ),
            AnalyticsEvent(
                share_id="share-1", demo_id=demo["id"], revision_id="revision-1",
                visitor_id="visitor-1", session_id="session-1", event_type="view",
            ),
            AnalyticsEvent(
                share_id="share-1", demo_id=demo["id"], revision_id="revision-1",
                visitor_id="visitor-1", session_id="session-2", event_type="view",
            ),
        ])
        db.commit()

    overview = client.get("/api/admin/overview")
    assert overview.status_code == 200
    value = overview.json()
    assert value["failed_jobs"] == 2
    assert value["recent_exports"][0]["resource_title"] == "Traffic report"
    assert value["recent_exports"][0]["kind"] == "pdf"
    assert {item["job_type"] for item in value["recent_failed_jobs"]} == {"ai", "export"}
    assert value["top_resources"][0]["title"] == "Traffic report"
    assert value["top_resources"][0]["views"] == 2
    assert value["top_resources"][0]["unique_viewers"] == 1


def test_cannot_remove_last_other_administrator(client):
    first = register(client, "first@example.com").json()
    logout(client)
    second = register(client, "second@example.com").json()
    logout(client)
    login(client, "first@example.com")
    promoted = client.patch(f"/api/admin/users/{second['id']}", json={"role": "admin"})
    assert promoted.status_code == 200
    # Demoting the other administrator is valid while the current admin remains.
    assert client.patch(f"/api/admin/users/{second['id']}", json={"role": "user"}).status_code == 200
    # The only remaining administrator cannot disable itself (self protection is stricter).
    response = client.patch(f"/api/admin/users/{first['id']}", json={"is_active": False})
    assert response.status_code == 400
    assert response.json()["code"] == "admin.self_protected"


def test_deleted_user_can_be_restored_or_permanently_purged(client):
    register(client, "admin@example.com")
    logout(client)
    member = register(client, "member@example.com").json()
    logout(client); login(client, "admin@example.com")
    assert client.delete(f"/api/admin/users/{member['id']}").status_code == 204
    assert login(client, "member@example.com").status_code == 401
    login(client, "admin@example.com")
    recycled = client.get("/api/admin/recycle-bin").json()
    recycled_user = next(item for item in recycled if item["id"] == member["id"] and item["item_type"] == "user")
    assert recycled_user["preview"]["email"] == "member@example.com"
    assert recycled_user["preview"]["role"] == "user"
    assert client.post(f"/api/admin/recycle-bin/users/{member['id']}/restore").status_code == 200
    logout(client); assert login(client, "member@example.com").status_code == 200
    logout(client); login(client, "admin@example.com")
    assert client.delete(f"/api/admin/users/{member['id']}").status_code == 204
    assert client.delete(f"/api/admin/recycle-bin/users/{member['id']}").status_code == 204
    assert client.post(f"/api/admin/recycle-bin/users/{member['id']}/restore").status_code == 404


def test_admin_resource_listing_preview_and_governance(client):
    register(client, "admin@example.com")
    logout(client)
    member = register(client, "member@example.com").json()
    demo = client.post("/api/demos", json={"title": "Team product tour", "content_locale": "en"}).json()
    image = io.BytesIO()
    Image.new("RGB", (800, 500), "white").save(image, "PNG")
    step = client.post(
        f"/api/recordings/{demo['id']}/steps",
        data={"meta": json.dumps({
            "event_id": "admin-resource", "title": "Open settings", "viewport_width": 800,
            "viewport_height": 500, "hotspot": {"x": .5, "y": .5, "w": .1, "h": .1},
            "ai_enabled": False,
        })},
        files={"screenshot": ("screen.png", image.getvalue(), "image/png")},
    ).json()
    published = client.post(f"/api/demos/{demo['id']}/publish").json()
    token = published["share_url"].rsplit("/", 1)[-1]
    assert client.get("/api/admin/resources").status_code == 403
    logout(client)
    login(client, "admin@example.com")

    listed = client.get("/api/admin/resources", params={"query": "Team", "owner_id": member["id"]})
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
    resource = listed.json()["items"][0]
    assert resource["owner"]["email"] == "member@example.com"
    assert resource["step_count"] == 1
    assert "/api/admin/resources/" in resource["thumbnail_url"]

    detail = client.get(f"/api/admin/resources/{demo['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["demo"]["steps"][0]["id"] == step["id"]
    assert client.get(f"/api/admin/resources/{demo['id']}/steps/{step['id']}/image").status_code == 200
    assert client.delete(f"/api/admin/resources/{demo['id']}").status_code == 204
    assert client.get(f"/api/admin/resources/{demo['id']}").status_code == 404
    assert client.get(f"/public/{token}").status_code == 404
    recycled = client.get("/api/admin/recycle-bin").json()
    item = next(item for item in recycled if item["id"] == demo["id"])
    assert item["item_type"] == "resource"
    assert item["preview"]["step_count"] == 1
    assert item["preview"]["content_locale"] == "en"
    assert "/api/admin/recycle-bin/resources/" in item["thumbnail_url"]
    assert client.get(f"/api/admin/recycle-bin/resources/{demo['id']}/thumbnail").status_code == 200
    assert client.post(f"/api/admin/recycle-bin/resources/{demo['id']}/restore").status_code == 200
    assert client.get(f"/api/admin/resources/{demo['id']}").status_code == 200
    assert client.get(f"/public/{token}").status_code == 404


def test_organization_switch_invitation_and_audit(client):
    admin = register(client, "admin@example.com").json()
    personal_org = admin["current_organization_id"]
    organizations = client.get("/api/organizations")
    assert organizations.status_code == 200
    assert organizations.json()[0]["role"] == "owner"

    created = client.post("/api/organizations", json={"name": "Product Team"})
    assert created.status_code == 201, created.text
    organization_id = created.json()["id"]
    switched = client.post(f"/api/organizations/{organization_id}/switch")
    assert switched.status_code == 200
    assert switched.json()["active_organization_id"] == organization_id
    assert client.post("/api/demos", json={"title": "Team resource"}).status_code == 201
    assert client.post(f"/api/organizations/{personal_org}/switch").status_code == 200
    assert client.get("/api/demos").json() == []
    assert client.post(f"/api/organizations/{organization_id}/switch").status_code == 200

    invitation = client.post(f"/api/organizations/{organization_id}/invitations", json={
        "email": "member@example.com", "role": "editor",
    })
    assert invitation.status_code == 201, invitation.text
    token = invitation.json()["invite_url"].rsplit("/", 1)[-1]
    logout(client)
    member = register(client, "member@example.com").json()
    accepted = client.post(f"/api/invitations/{token}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["current_organization_id"] == organization_id
    assert accepted.json()["active_organization_id"] == organization_id
    assert client.post("/api/demos", json={"title": "Member resource"}).status_code == 201
    members = client.get(f"/api/organizations/{organization_id}/members")
    assert members.status_code == 200
    assert {item["email"] for item in members.json()} == {"admin@example.com", "member@example.com"}

    logout(client); login(client, "admin@example.com")
    audit = client.get("/api/admin/audit-logs")
    assert audit.status_code == 200
    actions = {item["action"] for item in audit.json()["items"]}
    assert {"organization.created", "invitation.created", "invitation.accepted"}.issubset(actions)
    spaces = client.get("/api/admin/organizations")
    assert spaces.status_code == 200
    assert any(item["id"] == organization_id and item["member_count"] == 2 for item in spaces.json())


def test_platform_admin_can_enter_any_team_space_and_manage_user_memberships(client):
    admin = register(client, "admin@example.com").json()
    logout(client)
    member = register(client, "member@example.com").json()
    member_personal_id = member["current_organization_id"]
    logout(client); assert login(client, "admin@example.com").status_code == 200

    # Platform administrators create team spaces and assign an owner without
    # becoming a member themselves.
    created = client.post("/api/organizations", json={"name": "Member Team", "owner_id": member["id"]})
    assert created.status_code == 201, created.text
    member_organization_id = created.json()["id"]
    organizations = client.get("/api/organizations")
    assert organizations.status_code == 200
    assert member_organization_id in {item["id"] for item in organizations.json()}
    assert member_personal_id not in {item["id"] for item in organizations.json()}
    switched = client.post(f"/api/organizations/{member_organization_id}/switch")
    assert switched.status_code == 200
    assert switched.json()["current_organization_id"] == admin["current_organization_id"]
    assert switched.json()["active_organization_id"] == member_organization_id
    team_members = client.get(f"/api/organizations/{member_organization_id}/members")
    assert team_members.status_code == 200
    assert {item["email"] for item in team_members.json()} == {"member@example.com"}
    assert client.post("/api/demos", json={"title": "Platform-managed resource"}).status_code == 201

    # The user-management view exposes team-space associations and provides
    # explicit add, role-update, and removal operations.
    created = client.post("/api/organizations", json={"name": "Shared Customer Team", "owner_id": admin["id"]})
    assert created.status_code == 201
    shared_organization_id = created.json()["id"]
    detail = client.get(f"/api/admin/users/{member['id']}")
    assert detail.status_code == 200
    assert {item["organization_id"] for item in detail.json()["memberships"]} == {member_personal_id, member_organization_id}

    added = client.post(f"/api/admin/users/{member['id']}/memberships", json={
        "organization_id": shared_organization_id, "role": "editor",
    })
    assert added.status_code == 201, added.text
    membership = next(item for item in added.json()["memberships"] if item["organization_id"] == shared_organization_id)
    assert membership["role"] == "editor"

    updated = client.patch(f"/api/admin/users/{member['id']}/memberships/{membership['id']}", json={"role": "viewer"})
    assert updated.status_code == 200
    assert next(item for item in updated.json()["memberships"] if item["id"] == membership["id"])["role"] == "viewer"

    removed = client.delete(f"/api/admin/users/{member['id']}/memberships/{membership['id']}")
    assert removed.status_code == 200
    assert {item["organization_id"] for item in removed.json()["memberships"]} == {member_personal_id, member_organization_id}
    personal_membership = next(item for item in removed.json()["memberships"] if item["organization_kind"] == "personal")
    protected = client.delete(f"/api/admin/users/{member['id']}/memberships/{personal_membership['id']}")
    assert protected.status_code == 400
    assert protected.json()["code"] == "organization.personal_membership"

    audit_actions = {item["action"] for item in client.get("/api/admin/audit-logs").json()["items"]}
    assert {"organization.entered", "member.added", "member.role_updated", "member.removed"}.issubset(audit_actions)


def test_team_space_creation_session_isolation_and_extension_context(client):
    admin = register(client, "admin@example.com").json()
    personal_id = admin["current_organization_id"]
    team = client.post("/api/organizations", json={"name": "Session Team"}).json()
    team_id = team["id"]

    # The second browser session starts in the same default space, then keeps
    # its own context when the first session switches.
    with TestClient(app) as second:
        assert login(second, "admin@example.com").status_code == 200
        assert client.post(f"/api/organizations/{team_id}/switch").json()["active_organization_id"] == team_id
        assert second.get("/api/auth/me").json()["active_organization_id"] == personal_id
        assert client.post("/api/demos", json={"title": "Team-only"}).status_code == 201
        assert second.get("/api/demos").json() == []

        # An extension token has its own space context as well.
        pair = client.post("/api/extension/pair").json()["code"]
        token = client.post("/api/extension/pair/exchange", json={"code": pair}).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.post(f"/api/organizations/{personal_id}/switch").status_code == 200
        assert client.get("/api/auth/me", headers=headers).json()["active_organization_id"] == team_id


def test_extension_connection_uses_sliding_expiration_and_can_be_revoked(client):
    register(client, "admin@example.com")
    code = client.post("/api/extension/pair").json()["code"]
    token = client.post("/api/extension/pair/exchange", json={"code": code}).json()["token"]
    second_code = client.post("/api/extension/pair").json()["code"]
    second_token = client.post("/api/extension/pair/exchange", json={"code": second_code}).json()["token"]
    with SessionLocal() as db:
        credential = db.query(ExtensionToken).filter(ExtensionToken.token_hash == hash_token(token)).one()
        credential.expires_at = utcnow() + timedelta(hours=1)
        db.commit()

    headers = {"Authorization": f"Bearer {token}"}
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    extension_config = client.get("/api/extension/config", headers=headers)
    assert extension_config.status_code == 200
    assert extension_config.json() == {"ai_enabled": False, "default_content_locale": "zh-CN"}
    with SessionLocal() as db:
        credential = db.query(ExtensionToken).filter(ExtensionToken.token_hash == hash_token(token)).one()
        expires_at = credential.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=utcnow().tzinfo)
        assert expires_at > utcnow() + timedelta(days=100)

    assert client.delete("/api/extension/tokens", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {second_token}"}).status_code == 200


def test_regular_user_restrictions_invited_registration_and_team_lifecycle(client):
    admin = register(client, "admin@example.com").json()
    logout(client)
    member = register(client, "member@example.com").json()
    member_personal_id = member["current_organization_id"]
    restricted = client.post("/api/organizations", json={"name": "Not allowed"})
    assert restricted.status_code == 403
    assert restricted.json()["code"] == "organization.creation_restricted"

    logout(client); login(client, "admin@example.com")
    team = client.post("/api/organizations", json={"name": "Lifecycle Team", "owner_id": member["id"]}).json()
    team_id = team["id"]
    invitation = client.post(f"/api/organizations/{team_id}/invitations", json={
        "email": "invited@example.com", "role": "editor",
    }).json()
    token = invitation["invite_url"].rsplit("/", 1)[-1]
    logout(client)
    invited = client.post(f"/api/invitations/{token}/register", json={
        "name": "Invited User", "password": "correct-horse", "ui_locale": "zh-CN",
    })
    assert invited.status_code == 201, invited.text
    invited_spaces = client.get("/api/organizations").json()
    assert len([item for item in invited_spaces if item["kind"] == "personal"]) == 1
    assert any(item["id"] == team_id and item["role"] == "editor" for item in invited_spaces)

    logout(client); login(client, "member@example.com")
    assert client.post(f"/api/organizations/{team_id}/switch").status_code == 200
    demo = client.post("/api/demos", json={"title": "Archived content"}).json()
    image = io.BytesIO()
    Image.new("RGB", (320, 200), "white").save(image, "PNG")
    captured = client.post(
        f"/api/recordings/{demo['id']}/steps",
        data={"meta": json.dumps({
            "event_id": "archive-step", "title": "Archive step",
            "viewport_width": 320, "viewport_height": 200,
            "hotspot": {"x": .4, "y": .4, "w": .2, "h": .2}, "ai_enabled": False,
        })},
        files={"screenshot": ("screen.png", image.getvalue(), "image/png")},
    )
    assert captured.status_code == 201, captured.text
    share = client.post(f"/api/demos/{demo['id']}/publish").json()["share_url"]
    share_token = share.rsplit("/", 1)[-1]
    assert client.post(f"/api/organizations/{team_id}/archive").status_code == 204
    me = client.get("/api/auth/me").json()
    assert me["active_organization_id"] == member_personal_id
    assert client.get(f"/public/{share_token}").status_code == 404

    logout(client); login(client, "admin@example.com")
    recycled = client.get("/api/admin/recycle-bin").json()
    recycled_team = next(item for item in recycled if item["item_type"] == "team_space" and item["id"] == team_id)
    assert recycled_team["preview"]["member_count"] >= 1
    assert recycled_team["preview"]["resource_count"] == 1
    assert client.post(f"/api/admin/recycle-bin/team-spaces/{team_id}/restore").status_code == 204
    assert any(item["id"] == team_id for item in client.get("/api/admin/organizations").json())
    assert client.post(f"/api/organizations/{team_id}/archive").status_code == 204
    assert client.delete(f"/api/admin/recycle-bin/team-spaces/{team_id}").status_code == 204
    assert not any(item["id"] == team_id for item in client.get("/api/admin/organizations").json())
