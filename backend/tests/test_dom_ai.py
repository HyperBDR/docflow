import gzip
import io
import json

from PIL import Image
from sqlalchemy import select

from app.ai_service import apply_results
from app.database import SessionLocal
from app.models import AIJob, Demo, Hotspot, Step, User
from app.snapshots import sanitize_snapshot


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
    assert warnings


def test_dom_slide_hotspot_and_public_playback(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "DOM 演示"}).json()
    meta = {
        "event_id": "dom-1", "viewport_width": 1000, "viewport_height": 700,
        "title": "点击创建项目", "body": "点击创建项目继续。",
        "target": {"css": "#create", "tag": "button", "text": "创建项目"},
        "hotspot": {"x": .8, "y": .1, "w": .12, "h": .06},
        "page_context": {"page_title": "项目", "url": "https://internal.test/projects?token=secret", "visible_text": "创建项目"},
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
    assert authenticated.get(step["snapshot_url"].replace("http://localhost:8000", "")).status_code == 200

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
    assert public["steps"][0]["snapshot_url"]
    assert authenticated.get(f"/public/{token}/slides/{step['id']}/snapshot").status_code == 200


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
        hotspot = Hotspot(step_id=step.id, fallback_rect=step.hotspot, selector={}, action={"type": "next"}, tooltip={"content": "旧提示", "placement": "auto"}, style={})
        db.add(hotspot); db.flush()
        job = AIJob(owner_id=user.id, demo_id=demo.id, model="test")
        db.add(job); db.flush()
        apply_results(db, job, demo, {"title": "AI 标题", "description": "AI 摘要"}, [{
            "id": step.id, "title": "AI 步骤", "body": "AI 正文", "tooltip": "AI 提示", "placement": "bottom", "warnings": [], "redundant": False,
        }])
        assert demo.title == "人工标题"
        assert demo.description == "AI 摘要"
        assert step.title == "AI 步骤"
        assert step.body == "规则正文"
        assert hotspot.tooltip["content"] == "AI 提示"
        assert job.inverse_patch["demo"]["description"] == ""
    finally:
        db.rollback(); db.close()
