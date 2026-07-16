import io
import json
from PIL import Image


def image_bytes(color="white") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (1280, 720), color).save(output, "PNG")
    return output.getvalue()


def create_step(client, demo_id: str, event_id="event-1", ai_enabled: bool | None = None):
    meta = {
        "event_id": event_id,
        "title": "点击创建按钮",
        "body": "点击右上角的创建按钮。",
        "viewport_width": 1280,
        "viewport_height": 720,
        "hotspot": {"x": 0.8, "y": 0.1, "w": 0.08, "h": 0.05},
        "duration": 3,
    }
    if ai_enabled is not None:
        meta["ai_enabled"] = ai_enabled
    return client.post(
        f"/api/recordings/{demo_id}/steps",
        data={"meta": json.dumps(meta)},
        files={"screenshot": ("screen.png", image_bytes(), "image/png")},
    )


def test_authentication_and_demo_ownership(client, authenticated):
    created = authenticated.post("/api/demos", json={"title": "创建项目"})
    assert created.status_code == 201
    demo_id = created.json()["id"]
    assert authenticated.get(f"/api/demos/{demo_id}").status_code == 200
    authenticated.post("/api/auth/logout")
    assert authenticated.get(f"/api/demos/{demo_id}").status_code == 401


def test_extension_auto_title_remains_available_for_ai(authenticated):
    automatic = authenticated.post("/api/demos", json={
        "title": "Billing Console · 2026-07-15 17:30", "content_locale": "en", "auto_title": True,
    })
    assert automatic.status_code == 201
    assert "title" not in automatic.json()["manual_fields"]
    manual = authenticated.post("/api/demos", json={"title": "My curated demo"})
    assert "title" in manual.json()["manual_fields"]


def test_record_publish_markdown_and_revoke(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "创建项目"}).json()
    first = create_step(authenticated, demo["id"])
    assert first.status_code == 201
    assert first.json()["hotspot"]["x"] == 0.8
    duplicate = create_step(authenticated, demo["id"])
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == first.json()["id"]

    published = authenticated.post(f"/api/demos/{demo['id']}/publish")
    assert published.status_code == 200
    share_url = published.json()["share_url"]
    token = share_url.rsplit("/", 1)[-1]
    public = authenticated.get(f"/public/{token}")
    assert public.status_code == 200
    assert public.json()["steps"][0]["image_url"].endswith(f"/{first.json()['id']}.webp")
    markdown = authenticated.get(f"/public/{token}/markdown")
    assert "# 创建项目" in markdown.text
    assert "![点击创建按钮]" in markdown.text
    assert authenticated.get(f"/public/{token}/assets/{first.json()['id']}.webp").status_code == 200
    listed = authenticated.get("/api/demos").json()
    listed_demo = next(item for item in listed if item["id"] == demo["id"])
    assert listed_demo["thumbnail_url"].endswith(f"/{first.json()['id']}/image")

    assert authenticated.post(f"/api/demos/{demo['id']}/revoke").status_code == 200
    assert authenticated.get(f"/public/{token}").status_code == 404


def test_step_validation_and_password_redaction(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "登录"}).json()
    meta = {
        "event_id": "password",
        "title": "输入密码",
        "viewport_width": 1280,
        "viewport_height": 720,
        "hotspot": {"x": .5, "y": .5, "w": .2, "h": .06},
        "password_rect": {"x": .4, "y": .47, "w": .2, "h": .06},
    }
    response = authenticated.post(
        f"/api/recordings/{demo['id']}/steps",
        data={"meta": json.dumps(meta)},
        files={"screenshot": ("screen.png", image_bytes(), "image/png")},
    )
    assert response.status_code == 201
    assert len(response.json()["redactions"]) == 1
    assert authenticated.patch(f"/api/demos/{demo['id']}/steps/{response.json()['id']}", json={"duration": 16}).status_code == 422


def test_animation_autoplay_and_default_spotlight(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "动画演示"}).json()
    step = create_step(authenticated, demo["id"], "animation-step").json()
    assert step["hotspots"][0]["style"]["spotlight"] is False

    animation = {
        "zoom": {
            "enabled": True,
            "rect": {"x": 0.75, "y": 0.2, "w": 0.4, "h": 0.35},
            "duration_ms": 3000,
        }
    }
    updated_step = authenticated.patch(
        f"/api/demos/{demo['id']}/steps/{step['id']}", json={"animation": animation}
    )
    assert updated_step.status_code == 200
    assert updated_step.json()["animation"] == animation

    playback = {"autoplay": True, "step_duration_ms": 2000, "transition_delay_ms": 1000, "loop": True}
    updated_demo = authenticated.patch(f"/api/demos/{demo['id']}", json={"playback": playback})
    assert updated_demo.status_code == 200
    assert updated_demo.json()["playback"] == playback
    assert authenticated.patch(
        f"/api/demos/{demo['id']}", json={"playback": {**playback, "step_duration_ms": 100}}
    ).status_code == 422
    assert authenticated.patch(
        f"/api/demos/{demo['id']}/steps/{step['id']}",
        json={"animation": {"zoom": {**animation["zoom"], "duration_ms": 12000}}},
    ).status_code == 422

    published = authenticated.post(f"/api/demos/{demo['id']}/publish").json()
    token = published["share_url"].rsplit("/", 1)[-1]
    public = authenticated.get(f"/public/{token}").json()
    assert public["playback"] == playback
    assert public["steps"][0]["animation"] == animation


def test_recording_enqueues_ai_without_waiting_for_generation(authenticated, monkeypatch):
    from app.routers import recordings

    queued: list[str] = []
    monkeypatch.setattr(recordings.settings, "ai_enabled", True)
    monkeypatch.setattr(recordings.settings, "ai_api_key", "test-key")
    monkeypatch.setattr(recordings, "enqueue_ai_job", lambda db, demo, user, step_id: queued.append(step_id))
    demo = authenticated.post("/api/demos", json={"title": "异步 AI"}).json()
    response = create_step(authenticated, demo["id"], "async-ai")
    assert response.status_code == 201
    assert queued == [response.json()["id"]]


def test_recording_ai_can_be_disabled_per_capture(authenticated, monkeypatch):
    from app.routers import recordings

    queued: list[str] = []
    monkeypatch.setattr(recordings.settings, "ai_enabled", True)
    monkeypatch.setattr(recordings.settings, "ai_api_key", "test-key")
    monkeypatch.setattr(recordings, "enqueue_ai_job", lambda db, demo, user, step_id: queued.append(step_id))
    demo = authenticated.post("/api/demos", json={"title": "关闭 AI"}).json()
    response = create_step(authenticated, demo["id"], "no-ai", ai_enabled=False)
    assert response.status_code == 201
    assert queued == []


def test_duplicate_demo_copies_steps_as_draft(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "原始演示", "description": "说明"}).json()
    source_step = create_step(authenticated, demo["id"]).json()
    response = authenticated.post(f"/api/demos/{demo['id']}/duplicate")
    assert response.status_code == 201
    copied = response.json()
    assert copied["id"] != demo["id"]
    assert copied["title"] == "原始演示（副本）"
    assert copied["status"] == "draft"
    assert copied["share_url"] is None
    assert len(copied["steps"]) == 1
    assert copied["steps"][0]["id"] != source_step["id"]
    assert copied["steps"][0]["title"] == source_step["title"]
