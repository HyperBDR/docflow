import io
import json

from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models import Demo, ExportDownloadEvent, ExportJob, JobStatus
from app.routers.public import share_cookie_path
from app.storage import storage


def add_step(client, demo_id: str, prefix: str = ""):
    image = io.BytesIO(); Image.new("RGB", (800, 500), "white").save(image, "PNG")
    return client.post(
        f"{prefix}/api/recordings/{demo_id}/steps",
        data={"meta": json.dumps({"event_id": "governance", "title": "First step", "viewport_width": 800, "viewport_height": 500, "hotspot": {"x": .5, "y": .5, "w": .1, "h": .1}, "ai_enabled": False})},
        files={"screenshot": ("screen.png", image.getvalue(), "image/png")},
    )


def test_share_cookie_path_includes_reverse_proxy_prefix(monkeypatch):
    monkeypatch.setattr(settings, "public_base_url", "https://docflow.example/backend")
    assert share_cookie_path("share-token") == "/backend/public/share-token"


def test_password_share_unlock_works_behind_reverse_proxy_prefix(monkeypatch):
    monkeypatch.setattr(settings, "public_base_url", "https://testserver/backend")
    proxy = FastAPI()
    proxy.mount("/backend", app)
    with TestClient(proxy, base_url="https://testserver") as client:
        registered = client.post("/backend/api/auth/register", json={"email": "proxy@example.com", "password": "correct-horse"})
        assert registered.status_code == 201, registered.text
        demo = client.post("/backend/api/demos", json={"title": "Protected proxy share"}).json()
        add_step(client, demo["id"], prefix="/backend")
        assert client.post(f"/backend/api/demos/{demo['id']}/publish").status_code == 200
        share = client.post(f"/backend/api/demos/{demo['id']}/shares", json={"password": "proxy-secret"}).json()
        token = share["token"]
        assert client.get(f"/backend/public/{token}").status_code == 401
        unlocked = client.post(f"/backend/public/{token}/unlock", json={"password": "proxy-secret"})
        assert unlocked.status_code == 204
        assert f"Path=/backend/public/{token}" in unlocked.headers["set-cookie"]
        assert client.get(f"/backend/public/{token}").status_code == 200


def test_multiple_password_shares_and_source_analytics(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "Governed resource"}).json()
    step = add_step(authenticated, demo["id"]).json()
    published = authenticated.post(f"/api/demos/{demo['id']}/publish")
    assert published.status_code == 200, published.text
    created = authenticated.post(f"/api/demos/{demo['id']}/shares", json={
        "name": "Customer review", "password": "review-secret",
    })
    assert created.status_code == 201, created.text
    share = created.json(); token = share["token"]
    assert share["password_protected"] is True
    assert authenticated.get(f"/public/{token}").status_code == 401
    assert authenticated.post(f"/public/{token}/unlock", json={"password": "wrong"}).status_code == 401
    unlocked = authenticated.post(f"/public/{token}/unlock", json={"password": "review-secret"})
    assert unlocked.status_code == 204
    assert f"Path={share_cookie_path(token)}" in unlocked.headers["set-cookie"]
    assert authenticated.get(f"/public/{token}").status_code == 200
    event = authenticated.post(f"/public/{token}/events", json={
        "event_type": "step_view", "visitor_id": "visitor", "session_id": "session", "step_id": step["id"],
        "referrer": "https://example.com/docs", "utm_source": "newsletter", "utm_campaign": "launch",
    })
    assert event.status_code == 204, event.text
    links = authenticated.get(f"/api/demos/{demo['id']}/shares").json()
    assert len(links) == 2
    admin_links = authenticated.get("/api/admin/resource-governance/shares")
    assert admin_links.status_code == 200, admin_links.text
    assert admin_links.json()["total"] == 2
    detail = authenticated.get(f"/api/admin/resource-governance/resources/{demo['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["sources"] == [{"name": "example.com", "value": 1}]
    assert detail.json()["utm_sources"] == [{"name": "newsletter", "value": 1}]
    assert detail.json()["steps"][0]["viewers"] == 1


def test_proxy_download_and_external_completion_ingest(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "Download resource"}).json()
    add_step(authenticated, demo["id"])
    published = authenticated.post(f"/api/demos/{demo['id']}/publish").json()
    with SessionLocal() as db:
        key = storage.write("exports/governance.pdf", b"pdf-data")
        # DemoOut intentionally hides the internal revision id.
        stored_demo = db.get(Demo, demo["id"])
        job = ExportJob(owner_id=published["created_by"]["id"], demo_id=demo["id"], revision_id=stored_demo.current_revision_id, kind="pdf", status=JobStatus.complete, progress=100, result_key=key, result_size=8)
        db.add(job); db.commit(); job_id = job.id
    response = authenticated.get(f"/api/exports/{job_id}/download")
    assert response.status_code == 200
    with SessionLocal() as db:
        proxy = db.query(ExportDownloadEvent).filter_by(export_job_id=job_id).one()
        assert proxy.status == "completed" and proxy.source == "proxy"
    listing = authenticated.get("/api/admin/resource-governance/downloads").json()
    row = next(item for item in listing["items"] if item["id"] == job_id)
    assert row["download_requests"] == 1 and row["completed_downloads"] == 1
    settings.download_log_ingest_token = "ingest-test"
    external = authenticated.post("/api/admin/resource-governance/download-events/ingest", headers={"X-DocFlow-Ingest-Token": "ingest-test"}, json={
        "external_id": "cdn-log-1", "export_job_id": job_id, "source": "cdn", "status": "completed", "bytes_transferred": 8,
    })
    assert external.status_code == 202, external.text
    duplicate = authenticated.post("/api/admin/resource-governance/download-events/ingest", headers={"X-DocFlow-Ingest-Token": "ingest-test"}, json={
        "external_id": "cdn-log-1", "export_job_id": job_id, "source": "cdn", "status": "completed",
    })
    assert duplicate.json()["duplicate"] is True
