from app.database import SessionLocal
from app.models import (
    AIJob,
    AIUsageRecord,
    AnalyticsEvent,
    Demo,
    DemoStatus,
    ExportJob,
    JobStatus,
    PublishedRevision,
    ShareToken,
    Step,
)
from app.storage import storage


def register(client, email: str):
    response = client.post("/api/auth/register", json={"email": email, "password": "correct-horse"})
    assert response.status_code == 201
    return response.json()


def test_workspace_overview_aggregates_current_organization(client):
    user = register(client, "workspace@example.com")
    first = client.post("/api/demos", json={"title": "Published resource"}).json()
    second = client.post("/api/demos", json={"title": "Draft resource"}).json()

    with SessionLocal() as db:
        demo = db.get(Demo, first["id"])
        asset_key = storage.write(f"tests/{demo.id}/screen.png", b"workspace-screen")
        step = Step(
            demo_id=demo.id,
            event_id="workspace-step",
            position=0,
            title="First step",
            asset_key=asset_key,
            viewport_width=1280,
            viewport_height=720,
        )
        revision = PublishedRevision(demo_id=demo.id, number=1, snapshot={"title": demo.title, "steps": []})
        db.add_all([step, revision]); db.flush()
        demo.current_revision_id = revision.id
        demo.status = DemoStatus.published
        share = ShareToken(demo_id=demo.id, revision_id=revision.id, token="workspace-share")
        export = ExportJob(
            owner_id=user["id"], demo_id=demo.id, revision_id=revision.id, kind="pdf",
            status=JobStatus.complete, progress=100,
        )
        ai_job = AIJob(
            owner_id=user["id"], demo_id=demo.id, model="test-model",
            status=JobStatus.failed, progress=40, error_code="ai.generation_failed",
        )
        usage = AIUsageRecord(
            request_id="workspace-request", user_id=user["id"], organization_id=demo.organization_id,
            demo_id=demo.id, model_name="test-model", input_tokens=70, output_tokens=30, total_tokens=100,
        )
        db.add_all([share, export, ai_job, usage]); db.flush()
        export.result_key = storage.write(f"exports/{export.id}.pdf", b"pdf")
        db.add_all([
            AnalyticsEvent(share_id=share.id, demo_id=demo.id, revision_id=revision.id, visitor_id="visitor-1", session_id="session-1", event_type="view"),
            AnalyticsEvent(share_id=share.id, demo_id=demo.id, revision_id=revision.id, visitor_id="visitor-1", session_id="session-1", event_type="step"),
            AnalyticsEvent(share_id=share.id, demo_id=demo.id, revision_id=revision.id, visitor_id="visitor-2", session_id="session-2", event_type="view"),
        ])
        db.commit()

    response = client.get("/api/workspace/overview")
    assert response.status_code == 200
    value = response.json()
    assert value["organization_id"] == first["organization_id"]
    assert value["resources"] == 2
    assert value["draft_resources"] == 1
    assert value["published_resources"] == 1
    assert value["steps"] == 1
    assert value["storage_bytes"] >= len(b"workspace-screen") + len(b"pdf")
    assert value["views"] == 2
    assert value["unique_viewers"] == 2
    assert value["ai_requests"] == 1
    assert value["ai_tokens"] == 100
    assert value["failed_jobs"] == 1
    assert value["job_summary"]["complete"] == 1
    assert len(value["trend"]) == 30
    assert {item["id"] for item in value["recent_resources"]} == {first["id"], second["id"]}


def test_workspace_jobs_filter_paginate_and_isolate_organizations(client):
    owner = register(client, "jobs-owner@example.com")
    demo_value = client.post("/api/demos", json={"title": "Owner task"}).json()
    with SessionLocal() as db:
        demo = db.get(Demo, demo_value["id"])
        revision = PublishedRevision(demo_id=demo.id, number=1, snapshot={"steps": []})
        db.add(revision); db.flush()
        db.add_all([
            ExportJob(owner_id=owner["id"], demo_id=demo.id, revision_id=revision.id, kind="pdf"),
            ExportJob(owner_id=owner["id"], demo_id=demo.id, revision_id=revision.id, kind="mp4", status=JobStatus.complete, progress=100),
            AIJob(owner_id=owner["id"], demo_id=demo.id, model="test", status=JobStatus.failed),
        ])
        db.commit()

    filtered = client.get("/api/workspace/jobs", params={"job_type": "export", "page_size": 1, "page": 2})
    assert filtered.status_code == 200
    value = filtered.json()
    assert value["total"] == 2
    assert len(value["items"]) == 1
    assert value["summary"]["failed"] == 1
    assert client.get("/api/workspace/jobs", params={"status": "unknown"}).status_code == 422

    client.post("/api/auth/logout")
    register(client, "isolated@example.com")
    isolated = client.get("/api/workspace/overview").json()
    assert isolated["resources"] == 0
    assert isolated["recent_jobs"] == []
    assert client.get("/api/workspace/jobs").json()["total"] == 0
