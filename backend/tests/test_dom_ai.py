import gzip
import io
import json

from PIL import Image
from sqlalchemy import select

from app.ai_service import apply_results
from app.database import SessionLocal
from app.models import AIJob, Demo, Hotspot, Step, User
from app.snapshots import sanitize_page_context, sanitize_snapshot


def screenshot() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (1000, 700), "white").save(output, "PNG")
    return output.getvalue()


def rrweb_payload():
    return {
        "version": 1,
        "snapshot": {
            "type": 0, "id": 1, "childNodes": [{
                "type": 2, "id": 2, "tagName": "html", "attributes": {}, "childNodes": [{
                    "type": 2, "id": 3, "tagName": "head", "attributes": {}, "childNodes": [{
                        "type": 2, "id": 4, "tagName": "script", "attributes": {"src": "https://evil.test/x.js"}, "childNodes": [],
                    }],
                }, {
                    "type": 2, "id": 5, "tagName": "body", "attributes": {"onclick": "steal()"}, "childNodes": [{
                        "type": 2, "id": 6, "tagName": "button", "attributes": {"id": "create", "style": "background:url(https://evil.test/a.png)"},
                        "childNodes": [{"type": 3, "id": 7, "textContent": "创建项目"}],
                    }, {
                        "type": 2, "id": 8, "tagName": "div", "attributes": {"id": "aix-drop-panel"}, "childNodes": [],
                    }],
                }, {
                    "type": 2, "id": 9, "tagName": "div", "attributes": {"class": "docflow-recorder-ui", "rr_height": "700px"}, "childNodes": [],
                }],
            }],
        },
    }


def test_snapshot_sanitizer_removes_active_content():
    value, warnings = sanitize_snapshot(rrweb_payload())
    encoded = json.dumps(value)
    assert '"tagName": "script"' not in encoded
    assert "onclick" not in encoded
    assert "evil.test" not in encoded
    assert "aix-drop-panel" not in encoded
    assert "docflow-recorder-ui" not in encoded
    assert '"id": 6' in encoded
    # Routine security actions are intentionally silent in the editor. They
    # are expected for every static clone and are not rendering failures.
    assert warnings == []


def test_snapshot_sanitizer_only_warns_for_missing_visual_assets():
    payload = rrweb_payload()
    head = payload["snapshot"]["childNodes"][0]["childNodes"][0]
    body = payload["snapshot"]["childNodes"][0]["childNodes"][1]
    head["childNodes"].append({
        "type": 2, "id": 20, "tagName": "link",
        "attributes": {"rel": "stylesheet", "href": "https://assets.test/app.css"}, "childNodes": [],
    })
    body["childNodes"].append({
        "type": 2, "id": 21, "tagName": "img",
        "attributes": {"src": "https://assets.test/logo.png", "rr_dataURL": "data:image/png;base64,AA=="}, "childNodes": [],
    })
    body["childNodes"].append({
        "type": 2, "id": 22, "tagName": "body",
        "attributes": {"id": "cici-inline-container"}, "childNodes": [],
    })
    value, warnings = sanitize_snapshot(payload)
    encoded = json.dumps(value)
    assert "cici-inline-container" not in encoded
    assert "data:image/png;base64,AA==" in encoded
    assert warnings == ["Stylesheet could not be embedded; preview may differ from the source page"]


def test_snapshot_sanitizer_keeps_images_but_drops_embedded_fonts():
    payload = rrweb_payload()
    button = payload["snapshot"]["childNodes"][0]["childNodes"][1]["childNodes"][0]
    button["attributes"]["style"] = (
        'background-image:url("data:image/png;base64,AA==");'
        'src:url("data:font/woff2;base64,d09GMgABAAAA")'
    )
    value, _ = sanitize_snapshot(payload)
    style = value["snapshot"]["childNodes"][0]["childNodes"][1]["childNodes"][0]["attributes"]["style"]
    assert "data:image/png" in style
    assert "data:font" not in style


def test_page_context_keeps_only_safe_raster_fallback_regions():
    value = sanitize_page_context({
        "page_title": "Embedded report",
        "raster_regions": [
            {"x": .1, "y": .2, "w": .5, "h": .4, "kind": "iframe"},
            {"x": -.2, "y": .9, "w": .4, "h": .5, "kind": "video"},
            {"x": .3, "y": .3, "w": .2, "h": .2, "kind": "unsupported"},
            {"x": "bad", "y": 0, "w": 1, "h": 1},
        ],
    })
    assert value["raster_regions"] == [
        {"x": .1, "y": .2, "w": .5, "h": .4, "kind": "iframe"},
        {"x": 0.0, "y": .9, "w": .4, "h": 1 - .9, "kind": "video"},
        {"x": .3, "y": .3, "w": .2, "h": .2, "kind": "iframe"},
    ]


def test_dom_slide_hotspot_and_public_playback(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "DOM 演示"}).json()
    meta = {
        "event_id": "dom-1", "viewport_width": 1000, "viewport_height": 700,
        "title": "点击创建项目", "body": "点击创建项目继续。",
        "target": {"css": "#create", "tag": "button", "text": "创建项目"},
        "hotspot": {"x": .8, "y": .1, "w": .12, "h": .06},
        "page_context": {"page_title": "项目", "url": "https://internal.test/projects?token=secret", "visible_text": "创建项目", "raster_regions": [{"x": .1, "y": .2, "w": .4, "h": .3, "kind": "video"}]},
        "capture_warnings": ["Video playback is not included; a raster fallback is used"],
        "scroll_state": {"x": 0, "y": 20}, "terminal": False,
    }
    response = authenticated.post(
        f"/api/recordings/{demo['id']}/slides",
        data={"meta": json.dumps(meta)},
        files={
            "screenshot": ("screen.png", screenshot(), "image/png"),
            "snapshot": ("snapshot.json.gz", gzip.compress(json.dumps(rrweb_payload()).encode()), "application/gzip"),
        },
    )
    assert response.status_code == 201, response.text
    step = response.json()
    assert step["render_mode"] == "dom"
    assert step["snapshot_url"]
    assert step["page_context"]["url"] == "https://internal.test/projects"
    assert step["hotspots"][0]["selector"]["css"] == "#create"
    private_snapshot = authenticated.get(step["snapshot_url"].replace("http://localhost:8000", ""))
    assert private_snapshot.status_code == 200
    assert private_snapshot.headers["etag"]
    assert authenticated.get(
        step["snapshot_url"].replace("http://localhost:8000", ""),
        headers={"If-None-Match": private_snapshot.headers["etag"]},
    ).status_code == 304
    private_image = authenticated.get(step["image_url"].replace("http://localhost:8000", ""))
    assert private_image.headers["etag"]
    assert authenticated.get(
        step["image_url"].replace("http://localhost:8000", ""),
        headers={"If-None-Match": private_image.headers["etag"]},
    ).status_code == 304

    hotspot_id = step["hotspots"][0]["id"]
    updated = authenticated.patch(
        f"/api/demos/{demo['id']}/steps/{step['id']}/hotspots/{hotspot_id}",
        json={"tooltip": {"content": "在这里创建项目", "placement": "right", "alignment": "center", "offset": 16, "max_width": 320, "show_arrow": True}},
    )
    assert updated.status_code == 200
    assert updated.json()["tooltip"]["placement"] == "right"

    published = authenticated.post(f"/api/demos/{demo['id']}/publish").json()
    token = published["share_url"].rsplit("/", 1)[-1]
    public = authenticated.get(f"/public/{token}").json()
    assert public["steps"][0]["render_mode"] == "dom"
    assert public["steps"][0]["page_context"]["raster_regions"][0]["kind"] == "video"
    assert public["steps"][0]["capture_warnings"] == ["Video playback is not included; a raster fallback is used"]
    assert public["steps"][0]["snapshot_url"]
    assert "snapshot_version" in public["steps"][0], list(public["steps"][0])
    snapshot_response = authenticated.get(f"/public/{token}/slides/{step['id']}/snapshot", params={"v": public["steps"][0]["snapshot_version"]})
    assert snapshot_response.status_code == 200
    assert snapshot_response.headers["content-encoding"] == "gzip"
    assert "immutable" in snapshot_response.headers["cache-control"]
    assert snapshot_response.json()["snapshot"]
    assert authenticated.get(
        f"/public/{token}/slides/{step['id']}/snapshot",
        params={"v": public["steps"][0]["snapshot_version"]},
        headers={"If-None-Match": snapshot_response.headers["etag"]},
    ).status_code == 304


def test_sensitive_form_keeps_dom_snapshot_but_defaults_to_exact_image(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "Login flow"}).json()
    meta = {
        "event_id": "login-1", "viewport_width": 1000, "viewport_height": 700,
        "title": "Enter credentials", "body": "Enter credentials",
        "target": {"css": "#email", "tag": "input", "text": "Email"},
        "hotspot": {"x": .5, "y": .5, "w": .3, "h": .07},
        "page_context": {"page_title": "Sign in", "sensitive_form": True},
        "password_rects": [{"x": .35, "y": .45, "w": .3, "h": .07}],
    }
    response = authenticated.post(
        f"/api/recordings/{demo['id']}/slides",
        data={"meta": json.dumps(meta)},
        files={
            "screenshot": ("screen.png", screenshot(), "image/png"),
            "snapshot": ("snapshot.json.gz", gzip.compress(json.dumps(rrweb_payload()).encode()), "application/gzip"),
        },
    )
    assert response.status_code == 201, response.text
    step = response.json()
    assert step["render_mode"] == "image"
    assert step["snapshot_url"]
    assert step["page_context"]["sensitive_form"] is True
    # Simulate an automatic rectangle persisted by an older extension. A new
    # publish must not bake that stale geometry into the screenshot/PDF source.
    db = SessionLocal()
    try:
        stored = db.get(Step, step["id"])
        stored.redactions = [{"x": .35, "y": .45, "w": .3, "h": .07}]
        db.commit()
    finally:
        db.close()
    published = authenticated.post(f"/api/demos/{demo['id']}/publish").json()
    token = published["share_url"].rsplit("/", 1)[-1]
    rendered = Image.open(io.BytesIO(authenticated.get(f"/public/{token}/assets/{step['id']}.webp").content)).convert("RGB")
    assert min(rendered.getpixel((500, 340))) > 245
    # A later editor action is explicit and must retain the product's manual
    # redaction feature even on a login page.
    explicit = authenticated.patch(
        f"/api/demos/{demo['id']}/steps/{step['id']}",
        json={"redactions": [{"x": .35, "y": .45, "w": .3, "h": .07}]},
    )
    assert explicit.status_code == 200
    assert explicit.json()["page_context"]["explicit_redactions"] is True
    republished = authenticated.post(f"/api/demos/{demo['id']}/publish").json()
    token = republished["share_url"].rsplit("/", 1)[-1]
    redacted = Image.open(io.BytesIO(authenticated.get(f"/public/{token}/assets/{step['id']}.webp").content)).convert("RGB")
    assert max(redacted.getpixel((500, 340))) < 60


def test_ai_application_respects_manual_fields(authenticated):
    demo_data = authenticated.post("/api/demos", json={"title": "人工标题"}).json()
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == "owner@example.com"))
        demo = db.get(Demo, demo_data["id"])
        demo.manual_fields = ["title"]
        step = Step(
            demo_id=demo.id, event_id="ai-step", position=0, title="规则标题", body="规则正文",
            asset_key="assets/missing.webp", viewport_width=1000, viewport_height=700,
            hotspot={"x": .5, "y": .5, "w": .1, "h": .1}, manual_fields=["body"],
        )
        db.add(step); db.flush()
        hotspot = Hotspot(step_id=step.id, position=0, fallback_rect=step.hotspot, selector={}, action={"type": "next"}, tooltip={"content": "旧提示", "placement": "auto"}, style={})
        second = Hotspot(step_id=step.id, position=1, fallback_rect=step.hotspot, selector={"css": "#second"}, action={"type": "next"}, tooltip={"content": "第二个旧提示", "placement": "auto"}, style={})
        db.add_all([hotspot, second]); db.flush()
        job = AIJob(owner_id=user.id, demo_id=demo.id, model="test")
        db.add(job); db.flush()
        apply_results(db, job, demo, {"title": "AI 标题", "description": "AI 摘要"}, [{
            "id": step.id, "title": "AI 步骤", "body": "AI 正文", "hotspots": [
                {"id": hotspot.id, "tooltip": "AI 提示", "placement": "bottom"},
                {"id": second.id, "tooltip": "第二个 AI 提示", "placement": "right"},
            ], "warnings": [], "redundant": False,
        }])
        assert demo.title == "人工标题"
        assert demo.description == "AI 摘要"
        assert step.title == "AI 步骤"
        assert step.body == "规则正文"
        assert hotspot.tooltip["content"] == "AI 提示"
        assert second.tooltip["content"] == "第二个 AI 提示"
        assert job.inverse_patch["demo"]["description"] == ""
    finally:
        db.rollback(); db.close()
