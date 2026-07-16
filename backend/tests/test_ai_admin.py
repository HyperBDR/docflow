from sqlalchemy import select

from app.database import SessionLocal
from app.ai_service import apply_results
from app.models import AIJob, AIModelConfig, AIUsageRecord, Demo, Hotspot, JobStatus, Step, User


def test_admin_can_manage_models_without_exposing_credentials(client):
    assert client.post("/api/auth/register", json={"email": "admin@example.com", "password": "correct-horse"}).status_code == 201
    created = client.post("/api/admin/ai/models", json={
        "name": "Primary gateway", "base_url": "https://models.example.test/v1/",
        "api_key": "secret-token", "model": "example-large", "is_default": True,
    })
    assert created.status_code == 201, created.text
    value = created.json()
    assert value["base_url"] == "https://models.example.test/v1"
    assert value["api_key_configured"] is True
    assert "api_key" not in value

    updated = client.patch(f"/api/admin/ai/models/{value['id']}", json={"api_key": "", "temperature": .4})
    assert updated.status_code == 200
    db = SessionLocal()
    try:
        stored = db.get(AIModelConfig, value["id"])
        assert stored.api_key == "secret-token"
        assert stored.api_key_encrypted != "secret-token"
        assert stored.temperature == .4
    finally:
        db.close()


def test_global_ai_switch_controls_runtime(client):
    assert client.post("/api/auth/register", json={"email": "admin@example.com", "password": "correct-horse"}).status_code == 201
    initial = client.get("/api/admin/ai/settings").json()
    assert initial["effective"] is False
    client.post("/api/admin/ai/models", json={
        "name": "Runtime model", "base_url": "https://models.example.test/v1",
        "api_key": "secret-token", "model": "runtime-model", "is_default": True,
    })
    assert client.get("/api/admin/ai/settings").json()["effective"] is False
    assert client.get("/api/extension/config").json()["ai_enabled"] is False
    updated = client.patch("/api/admin/ai/settings", json={"enabled": True, "chunk_size": 6})
    assert updated.status_code == 200
    assert updated.json()["effective"] is True
    assert updated.json()["chunk_size"] == 6
    assert client.get("/api/extension/config").json()["ai_enabled"] is True


def test_model_connection_test_calls_models_and_json_completion(client, monkeypatch):
    from app.routers import admin as admin_router

    client.post("/api/auth/register", json={"email": "admin@example.com", "password": "correct-horse"})
    model = client.post("/api/admin/ai/models", json={
        "name": "Test gateway", "base_url": "https://models.example.test/v1",
        "api_key": "secret-token", "model": "json-model", "is_default": True,
    }).json()
    calls = []

    class Response:
        status_code = 200
        text = ""
        def __init__(self, body): self.body = body
        def json(self): return self.body

    class FakeClient:
        def __init__(self, **_kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *_args): return None
        def get(self, url, **_kwargs):
            calls.append(("GET", url)); return Response({"data": [{"id": "json-model"}]})
        def post(self, url, **kwargs):
            calls.append(("POST", url)); assert kwargs["json"]["response_format"] == {"type": "json_object"}
            return Response({"choices": [{"message": {"content": '{"ok":true}'}}]})

    monkeypatch.setattr(admin_router.httpx, "Client", FakeClient)
    response = client.post(f"/api/admin/ai/models/{model['id']}/test")
    assert response.status_code == 200, response.text
    assert response.json()["json_supported"] is True
    assert calls == [
        ("GET", "https://models.example.test/v1/models"),
        ("POST", "https://models.example.test/v1/chat/completions"),
    ]


def test_ai_usage_summary_and_request_details(client):
    admin = client.post("/api/auth/register", json={"email": "admin@example.com", "password": "correct-horse"}).json()
    demo = client.post("/api/demos", json={"title": "Token report"}).json()
    model = client.post("/api/admin/ai/models", json={
        "name": "Usage model", "base_url": "https://models.example.test/v1",
        "api_key": "secret-token", "model": "usage-model", "is_default": True,
    }).json()
    db = SessionLocal()
    try:
        resource = db.get(Demo, demo["id"])
        db.add(AIUsageRecord(
            request_id="req-test", model_config_id=model["id"], model_name="usage-model",
            user_id=admin["id"], organization_id=resource.organization_id, demo_id=resource.id,
            operation="step_copy", status="success", input_tokens=120, output_tokens=30,
            total_tokens=150, first_token_ms=80, latency_ms=420,
            request_detail={"message_count": 2}, response_detail={"finish_reason": "stop"},
        ))
        db.commit()
    finally:
        db.close()

    summary = client.get("/api/admin/ai/usage/summary", params={"days": 7})
    assert summary.status_code == 200, summary.text
    assert summary.json()["totals"]["total_tokens"] == 150
    assert summary.json()["by_user"][0]["key"] == admin["id"]
    assert summary.json()["by_organization"][0]["total_tokens"] == 150
    details = client.get("/api/admin/ai/usage/requests", params={"page_size": 10})
    assert details.status_code == 200
    assert details.json()["items"][0]["request_id"] == "req-test"
    assert details.json()["items"][0]["input_tokens"] == 120


def test_ai_job_exposes_field_by_field_change_report_and_safe_warnings(client):
    user = client.post("/api/auth/register", json={"email": "review@example.com", "password": "correct-horse"}).json()
    demo_value = client.post("/api/demos", json={"title": "Original demo"}).json()
    db = SessionLocal()
    try:
        demo = db.get(Demo, demo_value["id"])
        step = Step(
            demo_id=demo.id, event_id="review-step", position=0, title="Original step",
            body="Original instructions", asset_key="missing.png", viewport_width=1280, viewport_height=720,
        )
        step.hotspots.append(Hotspot(
            position=0, selector={}, fallback_rect={"x": .5, "y": .5, "w": .1, "h": .1},
            trigger="click", action={"type": "next"}, tooltip={"content": "Original tooltip", "placement": "auto"}, style={},
        ))
        db.add(step)
        db.flush()
        job = AIJob(owner_id=user["id"], demo_id=demo.id, status=JobStatus.complete, progress=100, model="review-model")
        db.add(job)
        db.flush()
        generated = [{
            "id": step.id, "title": "Generated step", "body": "Generated instructions",
            "tooltip": "Generated tooltip", "placement": "bottom",
            "warnings": ["192.168.7.70 admin"], "redundant": False,
        }]
        outline = {"title": "Generated demo", "description": "Generated demo description"}
        changes = apply_results(db, job, demo, outline, generated)
        job.result = {"outline": outline, "steps": generated, "changes": changes, "content_locale": "zh-CN"}
        db.commit()
        job_id = job.id
    finally:
        db.close()

    response = client.get(f"/api/ai/jobs/{job_id}")
    assert response.status_code == 200, response.text
    changes = response.json()["result"]["changes"]
    assert changes["demo"]["fields"]["description"] == {
        "before": "", "after": "Generated demo description", "applied": True,
    }
    assert changes["steps"][0]["fields"]["title"]["before"] == "Original step"
    assert changes["steps"][0]["fields"]["title"]["after"] == "Generated step"
    assert changes["steps"][0]["fields"]["tooltip"]["before"] == "Original tooltip"
    assert changes["steps"][0]["fields"]["tooltip"]["after"] == "Generated tooltip"
    assert changes["steps"][0]["warnings"] == ["检测到可能的内部 IP 地址，请确认是否需要脱敏。"]

    listed = client.get("/api/demos").json()
    assert listed[0]["created_by"]["email"] == "review@example.com"
