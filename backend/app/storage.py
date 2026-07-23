import io
import mimetypes
import os
import posixpath
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.client import Config as BotoConfig
from PIL import Image, ImageDraw

from app.config import settings
from app.secrets import decrypt_secret, encrypt_secret

KEY_PREFIX = "storage://"


@dataclass
class StorageTarget:
    id: str
    name: str
    kind: str
    local_path: str = ""
    endpoint_url: str = ""
    region: str = ""
    bucket: str = ""
    access_key: str = ""
    secret_key: str = ""
    prefix: str = ""
    force_path_style: bool = False
    direct_download: bool = True
    public_base_url: str = ""


def target_from_model(model) -> StorageTarget:
    return StorageTarget(
        id=model.id, name=model.name, kind=model.kind, local_path=model.local_path or "",
        endpoint_url=model.endpoint_url or "", region=model.region or "", bucket=model.bucket or "",
        access_key=decrypt_secret(model.access_key_encrypted), secret_key=decrypt_secret(model.secret_key_encrypted),
        prefix=(model.prefix or "").strip("/"), force_path_style=model.force_path_style,
        direct_download=model.direct_download, public_base_url=model.public_base_url or "",
    )


class Storage:
    """Routes legacy and managed object keys to local or S3-compatible backends."""
    def __init__(self, root: str):
        self.root = Path(root).resolve()
        (self.root / "assets").mkdir(parents=True, exist_ok=True)
        (self.root / "exports").mkdir(parents=True, exist_ok=True)

    @staticmethod
    def encode(target_id: str, logical_key: str) -> str:
        return f"{KEY_PREFIX}{target_id}/{logical_key.lstrip('/')}"

    @staticmethod
    def parse(key: str) -> tuple[str | None, str]:
        if not key.startswith(KEY_PREFIX):
            return None, key.lstrip("/")
        value = key[len(KEY_PREFIX):]
        target_id, separator, logical = value.partition("/")
        if not separator or not target_id or not logical:
            raise ValueError("invalid managed storage key")
        return target_id, logical

    def allowed_local_roots(self) -> list[Path]:
        configured = [item.strip() for item in settings.storage_allowed_roots.split(",") if item.strip()]
        roots = {self.root, *(Path(item).resolve() for item in configured)}
        return sorted(roots, key=lambda item: os.fspath(item))

    def validate_local_root(self, value: str) -> Path:
        path = Path(value).resolve()
        if not any(path == root or root in path.parents for root in self.allowed_local_roots()):
            raise ValueError("local path is outside the container storage mounts")
        return path

    def _target(self, target_id: str) -> StorageTarget:
        from app.database import SessionLocal
        from app.models import StorageConfig
        db = SessionLocal()
        try:
            model = db.get(StorageConfig, target_id)
            if not model:
                raise FileNotFoundError("storage target no longer exists")
            return target_from_model(model)
        finally:
            db.close()

    def _active_target(self) -> StorageTarget | None:
        from sqlalchemy import select
        from app.database import SessionLocal
        from app.models import StorageConfig
        db = SessionLocal()
        try:
            model = db.scalar(select(StorageConfig).where(StorageConfig.enabled.is_(True)).order_by(
                StorageConfig.is_default.desc(), StorageConfig.created_at
            ))
            return target_from_model(model) if model else None
        finally:
            db.close()

    def _resolve(self, key: str) -> tuple[StorageTarget | None, str]:
        target_id, logical = self.parse(key)
        return (self._target(target_id), logical) if target_id else (None, logical)

    @staticmethod
    def _safe_local_path(root: Path, logical: str) -> Path:
        path = (root / logical).resolve()
        if path != root and root not in path.parents:
            raise ValueError("invalid storage key")
        return path

    def _legacy_path(self, logical: str) -> Path:
        return self._safe_local_path(self.root, logical)

    def _local_path(self, target: StorageTarget, logical: str) -> Path:
        return self._safe_local_path(self.validate_local_root(target.local_path), logical)

    @staticmethod
    def _object_key(target: StorageTarget, logical: str) -> str:
        return posixpath.join(target.prefix, logical.lstrip("/")) if target.prefix else logical.lstrip("/")

    @staticmethod
    def _s3(target: StorageTarget):
        kwargs = {
            "endpoint_url": target.endpoint_url or None,
            "region_name": target.region or None,
            "config": BotoConfig(signature_version="s3v4", s3={"addressing_style": "path" if target.force_path_style else "auto"}),
        }
        if target.access_key:
            kwargs.update(aws_access_key_id=target.access_key, aws_secret_access_key=target.secret_key)
        return boto3.client("s3", **kwargs)

    def write(self, key: str, data: bytes) -> str:
        target = self._active_target()
        logical = self.parse(key)[1]
        if not target:
            path = self._legacy_path(logical); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            return logical
        if target.kind == "local":
            path = self._local_path(target, logical); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        else:
            content_type, content_encoding = mimetypes.guess_type(logical)
            options = {"Bucket": target.bucket, "Key": self._object_key(target, logical), "Body": data}
            if content_type: options["ContentType"] = content_type
            if content_encoding: options["ContentEncoding"] = content_encoding
            self._s3(target).put_object(**options)
        return self.encode(target.id, logical)

    def read(self, key: str) -> bytes:
        target, logical = self._resolve(key)
        if not target: return self._legacy_path(logical).read_bytes()
        if target.kind == "local": return self._local_path(target, logical).read_bytes()
        return self._s3(target).get_object(Bucket=target.bucket, Key=self._object_key(target, logical))["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            target, logical = self._resolve(key)
            if not target: return self._legacy_path(logical).is_file()
            if target.kind == "local": return self._local_path(target, logical).is_file()
            self._s3(target).head_object(Bucket=target.bucket, Key=self._object_key(target, logical)); return True
        except Exception:
            return False

    def size(self, key: str) -> int:
        return self.sizes([key]).get(key, 0)

    def sizes(self, keys) -> dict[str, int]:
        """Return object sizes while resolving each managed target once.

        Quota summaries can inspect hundreds of objects. Calling ``size`` for
        every key used to create a database session and reload StorageConfig
        for every managed object, which amplified harmless UI polling into a
        large number of nested database queries.
        """
        result: dict[str, int] = {}
        targets: dict[str, StorageTarget | None] = {}
        for key in dict.fromkeys(value for value in keys if value):
            try:
                target_id, logical = self.parse(key)
                target = None
                if target_id:
                    if target_id not in targets:
                        try: targets[target_id] = self._target(target_id)
                        except Exception: targets[target_id] = None
                    target = targets[target_id]
                    if target is None:
                        result[key] = 0
                        continue
                if not target:
                    value = self._legacy_path(logical).stat().st_size
                elif target.kind == "local":
                    value = self._local_path(target, logical).stat().st_size
                else:
                    value = int(self._s3(target).head_object(Bucket=target.bucket, Key=self._object_key(target, logical))["ContentLength"])
                result[key] = value
            except Exception:
                result[key] = 0
        return result

    def delete(self, key: str) -> None:
        try:
            target, logical = self._resolve(key)
            if not target: path = self._legacy_path(logical)
            elif target.kind == "local": path = self._local_path(target, logical)
            else:
                self._s3(target).delete_object(Bucket=target.bucket, Key=self._object_key(target, logical)); return
            if path.is_file(): path.unlink()
        except Exception:
            pass

    def absolute(self, key: str) -> str:
        target, logical = self._resolve(key)
        if target and target.kind != "local": raise ValueError("object storage has no local path")
        return os.fspath(self._local_path(target, logical) if target else self._legacy_path(logical))

    def direct_url(self, key: str, filename: str = "", expires: int = 900) -> str | None:
        try:
            target, logical = self._resolve(key)
            if not target or target.kind != "s3" or not target.direct_download: return None
            object_key = self._object_key(target, logical)
            if target.public_base_url:
                return f"{target.public_base_url.rstrip('/')}/{quote(object_key, safe='/')}"
            params = {"Bucket": target.bucket, "Key": object_key}
            if filename: params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
            return self._s3(target).generate_presigned_url("get_object", Params=params, ExpiresIn=expires)
        except Exception:
            return None

    def save_screenshot(self, key: str, content: bytes) -> tuple[str, int, int]:
        image = Image.open(io.BytesIO(content)).convert("RGB")
        if image.width * image.height > 40_000_000: raise ValueError("image dimensions are too large")
        output = io.BytesIO(); image.save(output, "WEBP", quality=90, method=4)
        return self.write(f"{key}.webp", output.getvalue()), image.width, image.height

    def rendered_asset(self, source_key: str, redactions: list[dict], target_key: str) -> str:
        image = Image.open(io.BytesIO(self.read(source_key))).convert("RGB"); draw = ImageDraw.Draw(image)
        for rect in redactions:
            x = int(float(rect.get("x", 0)) * image.width); y = int(float(rect.get("y", 0)) * image.height)
            w = int(float(rect.get("w", 0)) * image.width); h = int(float(rect.get("h", 0)) * image.height)
            draw.rectangle((x, y, x + w, y + h), fill=(35, 39, 47))
        output = io.BytesIO(); image.save(output, "WEBP", quality=90, method=4)
        return self.write(target_key, output.getvalue())

    def test_target(self, target: StorageTarget) -> int:
        started = datetime.now(timezone.utc)
        marker = f".docflow-health/{uuid.uuid4().hex}.txt"
        if target.kind == "local":
            path = self._local_path(target, marker); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"ok")
            if path.read_bytes() != b"ok": raise OSError("local storage verification failed")
            path.unlink()
        else:
            client = self._s3(target); key = self._object_key(target, marker)
            client.put_object(Bucket=target.bucket, Key=key, Body=b"ok")
            client.head_object(Bucket=target.bucket, Key=key); client.delete_object(Bucket=target.bucket, Key=key)
        return max(0, round((datetime.now(timezone.utc) - started).total_seconds() * 1000))

    def browse(self, target: StorageTarget, prefix: str = "", limit: int = 200) -> list[dict]:
        prefix = prefix.strip("/")
        if target.kind == "local":
            root = self._local_path(target, prefix) if prefix else self.validate_local_root(target.local_path)
            if not root.exists(): return []
            return [{
                "key": f"{prefix}/{item.name}".strip("/"), "name": item.name, "is_directory": item.is_dir(),
                "size": item.stat().st_size if item.is_file() else 0,
                "updated_at": datetime.fromtimestamp(item.stat().st_mtime, timezone.utc),
            } for item in sorted(root.iterdir(), key=lambda value: (not value.is_dir(), value.name.lower()))[:limit]]
        client = self._s3(target)
        logical_prefix = f"{prefix}/" if prefix else ""
        response = client.list_objects_v2(Bucket=target.bucket, Prefix=self._object_key(target, logical_prefix), Delimiter="/", MaxKeys=limit)
        base = f"{target.prefix}/" if target.prefix else ""
        items = [{"key": value["Prefix"][len(base):].rstrip("/"), "name": value["Prefix"].rstrip("/").rsplit("/", 1)[-1], "is_directory": True, "size": 0, "updated_at": None} for value in response.get("CommonPrefixes", [])]
        items.extend({"key": value["Key"][len(base):], "name": value["Key"].rsplit("/", 1)[-1], "is_directory": False, "size": value["Size"], "updated_at": value.get("LastModified")} for value in response.get("Contents", []) if value["Key"] != self._object_key(target, logical_prefix))
        return items

    def stats(self, target: StorageTarget) -> tuple[int, int]:
        if target.kind == "local":
            root = self.validate_local_root(target.local_path)
            files = [item for item in root.rglob("*") if item.is_file()] if root.exists() else []
            return len(files), sum(item.stat().st_size for item in files)
        count = total = 0
        paginator = self._s3(target).get_paginator("list_objects_v2")
        prefix = f"{target.prefix}/" if target.prefix else ""
        for page in paginator.paginate(Bucket=target.bucket, Prefix=prefix):
            for item in page.get("Contents", []): count += 1; total += int(item["Size"])
        return count, total

    def managed_key(self, target_id: str, logical: str) -> str:
        return self.encode(target_id, logical)


storage = Storage(settings.storage_dir)
