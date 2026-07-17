import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import OAuthIdentity, User, now
from app.oauth.google import consume_state, exchange_code, safe_return_to, start_authorization
from app.platform_settings import google_runtime_config
from app.platform_settings_schemas import GoogleAuthPublicConfig, OAuthIdentityOut
from app.routers.auth import create_session
from app.services import create_personal_organization, write_audit


router = APIRouter(prefix="/api/auth/google", tags=["google-auth"])
logger = logging.getLogger(__name__)


def _redirect(path: str = "/", *, result: str = "", error: str = "") -> RedirectResponse:
    target = f"{settings.web_origin.rstrip('/')}{safe_return_to(path)}"
    separator = "&" if "?" in target else "?"
    query = urlencode({key: value for key, value in {"oauth": result, "oauth_error": error}.items() if value})
    return RedirectResponse(f"{target}{separator}{query}" if query else target, status_code=303)


def _domain_allowed(email: str, domains: list[str]) -> bool:
    domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    return not domains or domain in domains


def _identity_out(value: OAuthIdentity, *, can_unlink: bool) -> OAuthIdentityOut:
    return OAuthIdentityOut(
        provider="google", email=value.email, display_name=value.display_name,
        avatar_url=value.avatar_url, created_at=value.created_at, last_login_at=value.last_login_at,
        can_unlink=can_unlink,
    )


@router.get("/config", response_model=GoogleAuthPublicConfig)
def public_config(db: Session = Depends(get_db)):
    config = google_runtime_config(db)
    return GoogleAuthPublicConfig(enabled=config.configured, allow_registration=config.allow_registration)


@router.get("/start")
def start_login(return_to: str = "/", db: Session = Depends(get_db)):
    config = google_runtime_config(db)
    if not config.configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in is not configured")
    return RedirectResponse(start_authorization(db, config, mode="login", user_id=None, return_to=return_to), status_code=307)


@router.get("/link/start")
def start_link(return_to: str = "/account/security", db: Session = Depends(get_db), user: User = Depends(current_user)):
    config = google_runtime_config(db)
    if not config.configured:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in is not configured")
    return RedirectResponse(start_authorization(db, config, mode="link", user_id=user.id, return_to=return_to), status_code=307)


@router.get("/callback")
def callback(
    request: Request, code: str = "", state: str = "", error: str = "",
    db: Session = Depends(get_db),
):
    oauth_state = None
    try:
        if not state:
            return _redirect(error="google_state_invalid")
        oauth_state = consume_state(db, state)
        if error or not code:
            return _redirect(oauth_state.return_to, error="google_access_denied")
        config = google_runtime_config(db)
        if not config.configured:
            return _redirect(oauth_state.return_to, error="google_not_configured")
        claims = exchange_code(config, oauth_state, code)
        if not claims.subject or not claims.email or not claims.email_verified:
            return _redirect(oauth_state.return_to, error="google_email_unverified")
        if not _domain_allowed(claims.email, config.allowed_domains):
            return _redirect(oauth_state.return_to, error="google_domain_denied")

        existing_identity = db.scalar(select(OAuthIdentity).where(
            OAuthIdentity.provider == "google", OAuthIdentity.provider_subject == claims.subject,
        ))
        if oauth_state.mode == "link":
            user = db.get(User, oauth_state.user_id) if oauth_state.user_id else None
            if not user or user.deleted_at or not user.is_active:
                return _redirect(oauth_state.return_to, error="google_account_disabled")
            if claims.email != user.email.lower():
                return _redirect(oauth_state.return_to, error="google_email_mismatch")
            user_identity = db.scalar(select(OAuthIdentity).where(
                OAuthIdentity.provider == "google", OAuthIdentity.user_id == user.id,
            ))
            if existing_identity and existing_identity.user_id != user.id:
                return _redirect(oauth_state.return_to, error="google_identity_conflict")
            identity = user_identity or existing_identity or OAuthIdentity(provider="google", provider_subject=claims.subject, user_id=user.id)
            identity.provider_subject = claims.subject
            identity.email, identity.display_name, identity.avatar_url = claims.email, claims.name, claims.picture
            identity.last_login_at = now()
            if not identity.id:
                db.add(identity)
                db.flush()
            write_audit(db, user, "oauth.google_linked", "oauth_identity", identity.id, claims.email,
                        user.current_organization_id, after={"provider": "google"}, request=request, source="web")
            response = _redirect(oauth_state.return_to, result="google_linked")
            create_session(db, user, response)
            return response

        identity = existing_identity
        if identity:
            user = db.get(User, identity.user_id)
        else:
            user = db.scalar(select(User).where(User.email == claims.email))
            if user:
                return _redirect(oauth_state.return_to, error="google_link_required")
            if not config.allow_registration:
                return _redirect(oauth_state.return_to, error="google_registration_disabled")
            is_first_user = (db.scalar(select(func.count(User.id))) or 0) == 0
            user = User(
                email=claims.email, name=claims.name or claims.email.split("@", 1)[0], password_hash=None,
                role="admin" if is_first_user else "user", ui_locale="zh-CN",
            )
            db.add(user); db.flush(); create_personal_organization(db, user)
            identity = OAuthIdentity(provider="google", provider_subject=claims.subject, user_id=user.id)
            db.add(identity); db.flush()
            write_audit(db, user, "user.registered", "user", user.id, user.email, user.current_organization_id,
                        after={"role": user.role, "provider": "google"}, request=request, source="web")
        if not user or user.deleted_at or not user.is_active:
            return _redirect(oauth_state.return_to, error="google_account_disabled")
        identity.email, identity.display_name, identity.avatar_url = claims.email, claims.name, claims.picture
        identity.last_login_at = now()
        write_audit(db, user, "oauth.google_login", "oauth_identity", identity.id, claims.email,
                    user.current_organization_id, request=request, source="web")
        response = _redirect(oauth_state.return_to, result="google_login")
        create_session(db, user, response)
        return response
    except Exception:
        db.rollback()
        logger.exception("Google OAuth callback failed")
        return _redirect(oauth_state.return_to if oauth_state else "/", error="google_login_failed")


@router.get("/identity", response_model=OAuthIdentityOut | None)
def identity(db: Session = Depends(get_db), user: User = Depends(current_user)):
    value = db.scalar(select(OAuthIdentity).where(OAuthIdentity.provider == "google", OAuthIdentity.user_id == user.id))
    return _identity_out(value, can_unlink=bool(user.password_hash)) if value else None


@router.delete("/identity", status_code=204)
def unlink(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    value = db.scalar(select(OAuthIdentity).where(OAuthIdentity.provider == "google", OAuthIdentity.user_id == user.id))
    if not value:
        raise HTTPException(status_code=404, detail="Google identity is not linked")
    if not user.password_hash:
        raise HTTPException(status_code=409, detail="cannot remove the last sign-in method")
    write_audit(db, user, "oauth.google_unlinked", "oauth_identity", value.id, value.email,
                user.current_organization_id, before={"provider": "google"}, request=request, source="web")
    db.delete(value); db.commit()
