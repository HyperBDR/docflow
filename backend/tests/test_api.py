import io
import json
from PIL import Image


def image_bytes(color="white") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (1280, 720), color).save(output, "PNG")
    return output.getvalue()


def create_step(client, demo_id: str, event_id="event-1"):
    meta = {
        "event_id": event_id,
        "title": "点击创建按钮",
        "body": "点击右上角的创建按钮。",
        "viewport_width": 1280,
        "viewport_height": 720,
        "hotspot": {"x": 0.8, "y": 0.1, "w": 0.08, "h": 0.05},
        "duration": 3,
    }
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

