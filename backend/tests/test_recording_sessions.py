import io
import json

from PIL import Image

from app.database import SessionLocal
from app.models import Demo, Step
from app.storage import storage


def image_bytes(color: str = "white") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (800, 500), color).save(output, "PNG")
    return output.getvalue()


def upload_step(client, demo_id: str, session_id: str, event_id: str):
    return client.post(
        f"/api/recordings/{demo_id}/steps",
        data={"meta": json.dumps({
            "recording_session_id": session_id,
            "event_id": event_id,
            "title": "Captured step",
            "viewport_width": 800,
            "viewport_height": 500,
            "hotspot": {"x": .5, "y": .5, "w": .1, "h": .1},
            "ai_enabled": True,
        })},
        files={"screenshot": ("screen.png", image_bytes(), "image/png")},
    )


def test_cancel_automatic_recording_purges_demo_steps_and_storage(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "Automatic draft", "auto_title": True}).json()
    session = authenticated.post(
        f"/api/recordings/{demo['id']}/sessions",
        json={"mode": "screenshot", "ai_enabled": True, "auto_created": True},
    )
    assert session.status_code == 201, session.text
    session_id = session.json()["id"]
    uploaded = upload_step(authenticated, demo["id"], session_id, "session-auto")
    assert uploaded.status_code == 201, uploaded.text

    with SessionLocal() as db:
        step = db.get(Step, uploaded.json()["id"])
        asset_key = step.asset_key
        assert step.recording_session_id == session_id
        assert storage.exists(asset_key)

    cancelled = authenticated.post(f"/api/recordings/sessions/{session_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["demo_id"] is None
    assert authenticated.get(f"/api/demos/{demo['id']}").status_code == 404
    assert not storage.exists(asset_key)


def test_cancel_append_recording_keeps_existing_steps_and_restores_settings(authenticated):
    demo = authenticated.post("/api/demos", json={
        "title": "Existing demo", "content_locale": "zh-CN", "ai_context": "original context",
    }).json()
    existing = authenticated.post(
        f"/api/recordings/{demo['id']}/steps",
        data={"meta": json.dumps({
            "event_id": "existing", "viewport_width": 800, "viewport_height": 500,
            "hotspot": {"x": .3, "y": .3, "w": .1, "h": .1}, "ai_enabled": False,
        })},
        files={"screenshot": ("existing.png", image_bytes("gray"), "image/png")},
    ).json()
    session = authenticated.post(
        f"/api/recordings/{demo['id']}/sessions",
        json={"mode": "html", "ai_enabled": False, "auto_created": False},
    ).json()
    authenticated.patch(f"/api/demos/{demo['id']}", json={"content_locale": "en", "ai_context": "temporary context"})
    added = upload_step(authenticated, demo["id"], session["id"], "session-added")
    assert added.status_code == 201, added.text

    cancelled = authenticated.post(f"/api/recordings/sessions/{session['id']}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    refreshed = authenticated.get(f"/api/demos/{demo['id']}").json()
    assert [step["id"] for step in refreshed["steps"]] == [existing["id"]]
    assert refreshed["content_locale"] == "zh-CN"
    assert refreshed["ai_context"] == "original context"


def test_completed_recording_session_cannot_be_cancelled(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "Completed demo"}).json()
    session = authenticated.post(
        f"/api/recordings/{demo['id']}/sessions",
        json={"mode": "html", "ai_enabled": False, "auto_created": False},
    ).json()
    completed = authenticated.post(f"/api/recordings/sessions/{session['id']}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert authenticated.post(f"/api/recordings/sessions/{session['id']}/cancel").status_code == 409
