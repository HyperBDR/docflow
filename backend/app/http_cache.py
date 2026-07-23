import hashlib

from fastapi import Request


def storage_etag(key: str) -> str:
    # Include the full managed key. Published assets keep the same step
    # filename across revisions, while their parent revision directory changes.
    version = hashlib.sha256(key.encode()).hexdigest()[:24]
    return f'"{version}"'


def cache_headers(key: str, visibility: str, max_age: int, *, immutable: bool = False) -> dict[str, str]:
    policy = f"{visibility}, max-age={max_age}"
    if immutable:
        policy += ", immutable"
    return {"Cache-Control": policy, "ETag": storage_etag(key)}


def is_not_modified(request: Request, etag: str) -> bool:
    candidates = {value.strip() for value in request.headers.get("if-none-match", "").split(",")}
    return "*" in candidates or etag in candidates or f"W/{etag}" in candidates
