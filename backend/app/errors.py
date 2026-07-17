from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


DETAIL_CODES = {
    "not authenticated": "auth.not_authenticated",
    "session expired": "auth.session_expired",
    "account disabled": "auth.account_disabled",
    "email already registered": "auth.email_registered",
    "invalid credentials": "auth.invalid_credentials",
    "current password is incorrect": "auth.current_password_incorrect",
    "new password must be different": "auth.password_unchanged",
    "administrator access required": "admin.forbidden",
    "user not found": "admin.user_not_found",
    "resource not found": "admin.resource_not_found",
    "email already in use": "admin.email_in_use",
    "cannot modify your own role or status": "admin.self_protected",
    "cannot delete your own account": "admin.self_delete",
    "at least one administrator is required": "admin.last_admin",
    "organization access required": "organization.forbidden",
    "organization permission denied": "organization.forbidden",
    "organization member not found": "organization.member_not_found",
    "organization not found": "organization.not_found",
    "at least one organization owner is required": "organization.last_owner",
    "user is already an organization member": "organization.already_member",
    "user must belong to at least one organization": "organization.last_membership",
    "owners cannot be invited directly": "organization.invite_owner",
    "invitation not found or expired": "organization.invitation_invalid",
    "invitation email does not match account": "organization.invitation_email",
    "team space creation is restricted": "organization.creation_restricted",
    "organization is archived": "organization.archived",
    "personal spaces cannot have members": "organization.personal_members",
    "personal spaces cannot be archived": "organization.personal_archive",
    "only owners can manage elevated team roles": "organization.elevated_roles",
    "personal space membership is immutable": "organization.personal_membership",
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
    "SMTP is not configured": "smtp.not_configured",
    "SMTP account unavailable": "smtp.account_unavailable",
    "SMTP authentication failed": "smtp.authentication_failed",
    "SMTP connection failed": "smtp.connection_failed",
    "SMTP sender rejected": "smtp.sender_rejected",
    "SMTP recipient rejected": "smtp.recipient_rejected",
    "SMTP delivery rejected": "smtp.delivery_rejected",
    "SMTP delivery failed": "smtp.delivery_failed",
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
