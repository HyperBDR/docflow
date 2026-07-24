import hashlib
import io
import json
import re
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import admin_user
from app.models import ExtensionRelease, User
from app.security import utcnow
from app.services import write_audit
from app.storage import storage


public_router = APIRouter(prefix="/api/extension/releases", tags=["extension-releases"])
admin_router = APIRouter(prefix="/api/admin/extension-releases", tags=["admin-extension-releases"])

CHANNELS = {"stable", "beta", "dev"}
STATUSES = {"draft", "published", "retired"}
VERSION_PATTERN = re.compile(r"^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,3}$")
MAX_PACKAGE_BYTES = 30 * 1024 * 1024


def version_tuple(value: str) -> tuple[int, int, int, int]:
    clean = value.strip()
    if not VERSION_PATTERN.fullmatch(clean):
        raise ValueError("version must contain 2 to 4 numeric components")
    parts = [int(part) for part in clean.split(".")]
    if any(part > 65535 for part in parts):
        raise ValueError("version components must not exceed 65535")
    return tuple((parts + [0, 0, 0, 0])[:4])  # type: ignore[return-value]


def validate_version(value: str, field: str = "version") -> str:
    clean = value.strip()
    try:
        version_tuple(clean)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{field}: {exc}") from exc
    return clean


def package_manifest(content: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = archive.namelist()
            if len(names) > 5000 or "manifest.json" not in names:
                raise ValueError("ZIP must contain manifest.json at its root")
            if any(name.startswith(("/", "\\")) or ".." in name.replace("\\", "/").split("/") for name in names):
                raise ValueError("ZIP contains an unsafe path")
            info = archive.getinfo("manifest.json")
            if info.file_size > 1_000_000:
                raise ValueError("manifest.json is too large")
            manifest = json.loads(archive.read(info))
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("package is not a valid Chrome extension ZIP") from exc
    if manifest.get("manifest_version") != 3 or not manifest.get("version"):
        raise ValueError("manifest.json must describe a Manifest V3 extension")
    return manifest


class ReleaseOut(BaseModel):
    id: str
    channel: str
    version: str
    minimum_version: str
    status: str
    is_required: bool
    release_notes: str
    filename: str
    sha256: str
    size_bytes: int
    download_url: str | None
    created_by_name: str
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ReleaseUpdate(BaseModel):
    status: str | None = None
    minimum_version: str | None = None
    is_required: bool | None = None
    release_notes: str | None = Field(default=None, max_length=10000)


class ReleaseCheck(BaseModel):
    channel: str
    current_version: str
    latest_version: str | None = None
    minimum_version: str | None = None
    update_available: bool = False
    required: bool = False
    download_url: str | None = None
    sha256: str | None = None
    size_bytes: int | None = None
    release_notes: str = ""
    published_at: datetime | None = None


def download_url(value: ExtensionRelease) -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/extension/releases/{value.id}/download"


def release_out(db: Session, value: ExtensionRelease) -> ReleaseOut:
    actor = db.get(User, value.created_by_id) if value.created_by_id else None
    return ReleaseOut(
        id=value.id, channel=value.channel, version=value.version,
        minimum_version=value.minimum_version, status=value.status,
        is_required=value.is_required, release_notes=value.release_notes,
        filename=value.filename, sha256=value.sha256, size_bytes=value.size_bytes,
        download_url=download_url(value) if value.status == "published" else None,
        created_by_name=(actor.name or actor.email) if actor else "",
        published_at=value.published_at, created_at=value.created_at, updated_at=value.updated_at,
    )


def latest_release(db: Session, channel: str, exclude_id: str = "") -> ExtensionRelease | None:
    query = select(ExtensionRelease).where(
        ExtensionRelease.channel == channel, ExtensionRelease.status == "published",
    )
    if exclude_id:
        query = query.where(ExtensionRelease.id != exclude_id)
    return db.scalar(query.order_by(ExtensionRelease.published_at.desc(), ExtensionRelease.created_at.desc()).limit(1))


def ensure_not_downgrade(db: Session, channel: str, version: str, exclude_id: str = "") -> None:
    current = latest_release(db, channel, exclude_id)
    if current and version_tuple(version) <= version_tuple(current.version):
        raise HTTPException(status_code=409, detail=f"published version must be newer than {current.version}")


@public_router.get("/check", response_model=ReleaseCheck)
def check_release(channel: str = "stable", current_version: str = "0.0.0", db: Session = Depends(get_db)):
    if channel not in CHANNELS:
        raise HTTPException(status_code=422, detail="unsupported release channel")
    current_version = validate_version(current_version, "current_version")
    value = latest_release(db, channel)
    if not value:
        return ReleaseCheck(channel=channel, current_version=current_version)
    update_available = version_tuple(value.version) > version_tuple(current_version)
    below_minimum = version_tuple(current_version) < version_tuple(value.minimum_version)
    return ReleaseCheck(
        channel=channel, current_version=current_version,
        latest_version=value.version, minimum_version=value.minimum_version,
        update_available=update_available, required=update_available and (value.is_required or below_minimum),
        download_url=download_url(value), sha256=value.sha256, size_bytes=value.size_bytes,
        release_notes=value.release_notes, published_at=value.published_at,
    )


@public_router.get("/{release_id}/download")
def download_release(release_id: str, db: Session = Depends(get_db)):
    value = db.get(ExtensionRelease, release_id)
    if not value or value.status != "published" or not storage.exists(value.storage_key):
        raise HTTPException(status_code=404, detail="extension package not found")
    direct = storage.direct_url(value.storage_key, value.filename)
    if direct:
        return RedirectResponse(direct, status_code=307)
    return StreamingResponse(
        io.BytesIO(storage.read(value.storage_key)), media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{value.filename}"',
            "X-Content-SHA256": value.sha256,
            "Cache-Control": "public, max-age=3600",
        },
    )


@admin_router.get("", response_model=list[ReleaseOut])
def list_releases(channel: str = "", db: Session = Depends(get_db), _: User = Depends(admin_user)):
    query = select(ExtensionRelease)
    if channel:
        if channel not in CHANNELS:
            raise HTTPException(status_code=422, detail="unsupported release channel")
        query = query.where(ExtensionRelease.channel == channel)
    values = db.scalars(query.order_by(ExtensionRelease.created_at.desc()).limit(200)).all()
    return [release_out(db, value) for value in values]


@admin_router.post("", response_model=ReleaseOut, status_code=201)
async def create_release(
    request: Request,
    package: UploadFile = File(...),
    channel: str = Form("stable"),
    version: str = Form(...),
    minimum_version: str = Form("0.0.0"),
    is_required: bool = Form(False),
    release_notes: str = Form(""),
    publish: bool = Form(True),
    db: Session = Depends(get_db),
    actor: User = Depends(admin_user),
):
    channel = channel.strip().lower()
    if channel not in CHANNELS:
        raise HTTPException(status_code=422, detail="unsupported release channel")
    version = validate_version(version)
    minimum_version = validate_version(minimum_version, "minimum_version")
    if version_tuple(minimum_version) > version_tuple(version):
        raise HTTPException(status_code=422, detail="minimum_version cannot exceed release version")
    if db.scalar(select(ExtensionRelease.id).where(ExtensionRelease.channel == channel, ExtensionRelease.version == version)):
        raise HTTPException(status_code=409, detail="this channel already contains the version")
    content = await package.read(MAX_PACKAGE_BYTES + 1)
    if len(content) > MAX_PACKAGE_BYTES:
        raise HTTPException(status_code=413, detail="extension package exceeds 30 MB")
    try:
        manifest = package_manifest(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if str(manifest.get("version")) != version:
        raise HTTPException(status_code=422, detail=f"manifest version {manifest.get('version')} does not match {version}")
    if publish:
        ensure_not_downgrade(db, channel, version)
    filename = f"docflow-extension-{channel}-{version}.zip"
    key = storage.write(f"extensions/{channel}/{version}/{filename}", content)
    value = ExtensionRelease(
        channel=channel, version=version, minimum_version=minimum_version,
        status="published" if publish else "draft", is_required=is_required,
        release_notes=release_notes.strip()[:10000], storage_key=key, filename=filename,
        sha256=hashlib.sha256(content).hexdigest(), size_bytes=len(content),
        created_by_id=actor.id, published_at=utcnow() if publish else None,
    )
    db.add(value); db.flush()
    write_audit(
        db, actor, "extension_release.created", "extension_release", value.id,
        f"{channel} {version}", after={"channel": channel, "version": version, "status": value.status,
        "minimum_version": minimum_version, "is_required": is_required, "sha256": value.sha256}, request=request,
    )
    db.commit(); db.refresh(value)
    return release_out(db, value)


@admin_router.patch("/{release_id}", response_model=ReleaseOut)
def update_release(release_id: str, payload: ReleaseUpdate, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    value = db.get(ExtensionRelease, release_id)
    if not value:
        raise HTTPException(status_code=404, detail="extension release not found")
    before = {"status": value.status, "minimum_version": value.minimum_version, "is_required": value.is_required, "release_notes": value.release_notes}
    if payload.minimum_version is not None:
        minimum = validate_version(payload.minimum_version, "minimum_version")
        if version_tuple(minimum) > version_tuple(value.version):
            raise HTTPException(status_code=422, detail="minimum_version cannot exceed release version")
        value.minimum_version = minimum
    if payload.is_required is not None:
        value.is_required = payload.is_required
    if payload.release_notes is not None:
        value.release_notes = payload.release_notes.strip()
    if payload.status is not None:
        if payload.status not in STATUSES:
            raise HTTPException(status_code=422, detail="unsupported release status")
        if payload.status == "published" and value.status != "published":
            ensure_not_downgrade(db, value.channel, value.version, value.id)
            value.published_at = utcnow()
        value.status = payload.status
    db.flush()
    after = {"status": value.status, "minimum_version": value.minimum_version, "is_required": value.is_required, "release_notes": value.release_notes}
    write_audit(db, actor, "extension_release.updated", "extension_release", value.id, f"{value.channel} {value.version}", before=before, after=after, request=request)
    db.commit(); db.refresh(value)
    return release_out(db, value)


@admin_router.delete("/{release_id}", status_code=204)
def delete_release(release_id: str, request: Request, db: Session = Depends(get_db), actor: User = Depends(admin_user)):
    value = db.get(ExtensionRelease, release_id)
    if not value:
        raise HTTPException(status_code=404, detail="extension release not found")
    snapshot = {"channel": value.channel, "version": value.version, "status": value.status, "sha256": value.sha256}
    key = value.storage_key
    write_audit(db, actor, "extension_release.deleted", "extension_release", value.id, f"{value.channel} {value.version}", before=snapshot, request=request)
    db.delete(value); db.commit()
    storage.delete(key)
