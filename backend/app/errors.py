from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


DETAIL_CODES = {
    "not authenticated": "auth.not_authenticated",
    "session expired": "auth.session_expired",
    "account disabled": "auth.account_disabled",
    "email already registered": "auth.email_registered",
    "invalid credentials": "auth.invalid_credentials",
    "demo not found": "demo.not_found",
    "step not found": "step.not_found",
    "cannot publish an empty demo": "demo.empty_publish",
    "publish the demo before exporting": "export.publish_first",
    "export not found": "export.not_found",
    "AI is not configured": "ai.not_configured",
    "record at least one slide first": "ai.no_steps",
    "AI job not found": "ai.job_not_found",
    "invalid or expired pairing code": "extension.invalid_pairing_code",
    "category not found": "category.not_found",
    "tag not found": "tag.not_found",
    "one or more tags were not found": "tag.not_found",
    "published demo not found": "public.not_found",
    "comment not found": "comment.not_found",
    "image not found": "asset.not_found",
    "asset not found": "asset.not_found",
    "DOM snapshot not found": "snapshot.not_found",
}


async def http_exception_response(_: Request, exc: HTTPException) -> JSONResponse:
    detail = str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": detail, "code": DETAIL_CODES.get(detail, "request.failed")},
        headers=exc.headers,
    )


async def validation_exception_response(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": "validation failed", "code": "request.validation", "errors": exc.errors()})
