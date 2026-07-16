from unittest.mock import patch

from app.database import SessionLocal
from app.models import AIJob, AuditLog, Demo, ExportJob, JobStatus, PublishedRevision, User
from app.storage import storage


def register(client, email: str):
    return client.post("/api/auth/register", json={"email": email, "password": "correct-horse"})


def test_admin_task_center_list_detail_cancel_retry_download_and_audit(client):
    user = register(client, "admin@example.com").json()
    demo_value = client.post("/api/demos", json={"title": "Task center demo"}).json()
    with SessionLocal() as db:
        demo = db.get(Demo, demo_value["id"])
        revision = PublishedRevision(demo_id=demo.id, number=1, snapshot={"title": demo.title, "steps": []})
        db.add(revision); db.flush()
        demo.current_revision_id = revision.id
        queued = ExportJob(owner_id=user["id"], demo_id=demo.id, revision_id=revision.id, kind="pdf")
        failed = ExportJob(
            owner_id=user["id"], demo_id=demo.id, revision_id=revision.id, kind="mp4",
            status=JobStatus.failed, progress=35, error="render failed", error_code="export.render_failed",
        )
        complete = ExportJob(
            owner_id=user["id"], demo_id=demo.id, revision_id=revision.id, kind="markdown",
            status=JobStatus.complete, progress=100,
        )
        ai_failed = AIJob(
            owner_id=user["id"], demo_id=demo.id, status=JobStatus.failed,
            progress=20, model="review-model", error="invalid output", error_code="ai.generation_failed",
        )
        db.add_all([queued, failed, complete, ai_failed]); db.flush()
        complete.result_key = storage.write(f"exports/{complete.id}.zip", b"offline-export")
        ids = {"queued": queued.id, "failed": failed.id, "complete": complete.id, "ai": ai_failed.id}
        db.commit()

    listed = client.get("/api/admin/jobs")
    assert listed.status_code == 200
    value = listed.json()
    assert value["total"] == 4
    assert value["summary"]["queued"] == 1
    assert value["summary"]["failed"] == 2
    assert value["summary"]["complete"] == 1
    assert {item["job_type"] for item in value["items"]} == {"ai", "export"}

    filtered = client.get("/api/admin/jobs", params={"job_type": "ai", "status": "failed"}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["id"] == ids["ai"]
    assert filtered["summary"]["failed"] == 1

    detail = client.get(f"/api/admin/jobs/export/{ids['complete']}")
    assert detail.status_code == 200
    assert detail.json()["download_url"].endswith(f"/{ids['complete']}/download")
    assert detail.json()["metadata"]["result_bytes"] == len(b"offline-export")
    download = client.get(detail.json()["download_url"])
    assert download.status_code == 200
    assert download.content == b"offline-export"

    with patch("app.routers.admin.celery.control.revoke") as revoke:
        cancelled = client.post(f"/api/admin/jobs/export/{ids['queued']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["can_retry"] is True
    assert cancelled.json()["cancelled_at"]
    revoke.assert_called_once_with(ids["queued"], terminate=False, signal="SIGTERM")

    with patch("app.routers.admin.celery.send_task") as send:
        retried = client.post(f"/api/admin/jobs/export/{ids['queued']}/retry")
    assert retried.status_code == 202
    retry_value = retried.json()
    assert retry_value["status"] == "queued"
    assert retry_value["retry_of_id"] == ids["queued"]
    assert retry_value["id"] != ids["queued"]
    send.assert_called_once_with("docflow.render_export", args=[retry_value["id"]], task_id=retry_value["id"])
    assert client.post(f"/api/admin/jobs/export/{retry_value['id']}/retry").status_code == 409

    with SessionLocal() as db:
        actions = set(db.query(AuditLog.action).filter(AuditLog.target_type == "job").all())
        assert actions == {("job.cancelled",), ("job.retried",)}
        cancelled_job = db.get(ExportJob, ids["queued"])
        assert cancelled_job.cancelled_by_id == user["id"]


def test_regular_user_cannot_access_task_center(client):
    register(client, "admin@example.com")
    client.post("/api/auth/logout")
    register(client, "member@example.com")
    assert client.get("/api/admin/jobs").status_code == 403


def test_cancelled_jobs_are_ignored_by_workers(client):
    user = register(client, "admin@example.com").json()
    demo_value = client.post("/api/demos", json={"title": "Cancelled work"}).json()
    with SessionLocal() as db:
        demo = db.get(Demo, demo_value["id"])
        export = ExportJob(
            owner_id=user["id"], demo_id=demo.id, revision_id="missing", kind="pdf",
            status=JobStatus.cancelled,
        )
        ai = AIJob(owner_id=user["id"], demo_id=demo.id, model="unused", status=JobStatus.cancelled)
        db.add_all([export, ai]); db.commit(); export_id, ai_id = export.id, ai.id

    from app.ai_service import run_ai_generation
    from app.worker import render_export
    run_ai_generation(ai_id)
    render_export.run(export_id)
    with SessionLocal() as db:
        assert db.get(AIJob, ai_id).status == JobStatus.cancelled
        assert db.get(ExportJob, export_id).status == JobStatus.cancelled
