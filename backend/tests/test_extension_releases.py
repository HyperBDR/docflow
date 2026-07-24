import io
import json
import zipfile


def extension_zip(version: str = "1.2.2") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps({
            "manifest_version": 3,
            "name": "DocFlow Recorder",
            "version": version,
        }))
        archive.writestr("background.js", "void 0")
    return output.getvalue()


def test_admin_publishes_and_clients_check_extension_release(authenticated):
    package = extension_zip()
    created = authenticated.post(
        "/api/admin/extension-releases",
        data={
            "channel": "stable", "version": "1.2.2", "minimum_version": "1.2.0",
            "is_required": "false", "release_notes": "Resource capture fixes", "publish": "true",
        },
        files={"package": ("docflow.zip", package, "application/zip")},
    )
    assert created.status_code == 201, created.text
    release = created.json()
    assert release["status"] == "published"
    assert release["sha256"]

    optional = authenticated.get("/api/extension/releases/check", params={"channel": "stable", "current_version": "1.2.1"})
    assert optional.status_code == 200
    assert optional.json()["update_available"] is True
    assert optional.json()["required"] is False

    required = authenticated.get("/api/extension/releases/check", params={"channel": "stable", "current_version": "1.1.9"})
    assert required.json()["required"] is True
    downloaded = authenticated.get(optional.json()["download_url"].replace("http://localhost:8000", ""))
    assert downloaded.status_code == 200
    assert downloaded.content == package
    assert downloaded.headers["x-content-sha256"] == release["sha256"]

    retired = authenticated.patch(f"/api/admin/extension-releases/{release['id']}", json={"status": "retired"})
    assert retired.status_code == 200
    assert authenticated.get("/api/extension/releases/check", params={"channel": "stable", "current_version": "1.2.1"}).json()["latest_version"] is None


def test_extension_release_rejects_manifest_version_mismatch(authenticated):
    response = authenticated.post(
        "/api/admin/extension-releases",
        data={"channel": "dev", "version": "1.2.3", "minimum_version": "1.2.0", "publish": "false"},
        files={"package": ("docflow.zip", extension_zip("1.2.2"), "application/zip")},
    )
    assert response.status_code == 422
    assert "does not match" in response.json()["detail"]
