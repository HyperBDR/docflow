import uuid
from pathlib import Path
from unittest.mock import patch

from app.config import settings
from app.database import SessionLocal
from app.models import Demo, Step, StorageConfig
from app.storage import storage


def register_admin(client):
    response = client.post("/api/auth/register", json={"email": "storage-admin@example.com", "password": "correct-horse"})
    assert response.status_code == 201
    return response.json()


def test_local_storage_management_routing_browse_and_reference_protection(client):
    admin = register_admin(client)
    legacy = client.get("/api/admin/storage/configs")
    assert legacy.status_code == 200
    assert legacy.json()[0]["kind"] == "local"

    folder = f"managed-{uuid.uuid4().hex}"
    local_path = str(Path(settings.storage_dir) / folder)
    created = client.post("/api/admin/storage/configs", json={
        "name": "Managed local", "kind": "local", "local_path": local_path,
        "prefix": "", "is_default": True, "direct_download": False,
    })
    assert created.status_code == 201, created.text
    target = created.json()
    assert target["is_default"] is True
    assert client.post(f"/api/admin/storage/configs/{target['id']}/test").status_code == 200

    key = storage.write("tests/example.txt", b"managed-storage")
    second_key = storage.write("tests/second.txt", b"another-object")
    assert key == f"storage://{target['id']}/tests/example.txt"
    with patch.object(storage, "_target", wraps=storage._target) as resolve_target:
        sizes = storage.sizes([key, second_key, key])
    assert sizes == {key: len(b"managed-storage"), second_key: len(b"another-object")}
    assert resolve_target.call_count == 1
    objects = client.get(f"/api/admin/storage/configs/{target['id']}/objects", params={"prefix": "tests"})
    assert objects.status_code == 200
    assert objects.json()[0]["key"] == "tests/example.txt"
    downloaded = client.get(f"/api/admin/storage/configs/{target['id']}/objects/download", params={"key": "tests/example.txt"})
    assert downloaded.content == b"managed-storage"

    demo = client.post("/api/demos", json={"title": "Storage reference"}).json()
    db = SessionLocal()
    try:
        db.add(Step(
            demo_id=demo["id"], event_id="storage-step", position=0, title="Stored", body="",
            asset_key=key, viewport_width=100, viewport_height=100,
            hotspot={"x": .5, "y": .5, "w": .1, "h": .1},
        ))
        db.commit()
    finally:
        db.close()
    protected = client.delete(f"/api/admin/storage/configs/{target['id']}/objects", params={"key": "tests/example.txt"})
    assert protected.status_code == 409


def test_s3_credentials_are_encrypted_and_never_returned(client):
    register_admin(client)
    created = client.post("/api/admin/storage/configs", json={
        "name": "Private S3", "kind": "s3", "endpoint_url": "https://s3.example.test",
        "region": "us-east-1", "bucket": "docflow", "prefix": "tenant/docflow",
        "access_key": "access-secret", "secret_key": "very-secret", "direct_download": True,
    })
    assert created.status_code == 201, created.text
    value = created.json()
    assert value["credentials_configured"] is True
    assert "access_key" not in value and "secret_key" not in value
    db = SessionLocal()
    try:
        stored = db.get(StorageConfig, value["id"])
        assert stored.access_key_encrypted != "access-secret"
        assert stored.secret_key_encrypted != "very-secret"
    finally:
        db.close()
