from datetime import timezone
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ExtensionToken, Session as UserSession, User
from app.config import settings
from app.security import expires_in, hash_token, utcnow


def expired(value) -> bool:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value < utcnow()


def current_user(
    request: Request,
    db: Session = Depends(get_db),
    docflow_session: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
) -> User:
    token = docflow_session
    model = UserSession
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
        model = ExtensionToken
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    credential = db.scalar(select(model).where(model.token_hash == hash_token(token)))
    if not credential or expired(credential.expires_at) or getattr(credential, "revoked", False):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="session expired")
    if model is ExtensionToken:
        expires_at = credential.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        # Renew only near expiry to avoid a write on every extension request.
        if expires_at < expires_in(days=max(7, settings.extension_token_days // 3)):
            credential.expires_at = expires_in(days=settings.extension_token_days)
            db.commit()
    user = db.get(User, credential.user_id)
    if not user or not user.is_active or user.deleted_at:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="account disabled")
    request.state.credential = credential
    user._active_organization_id = credential.active_organization_id
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="administrator access required")
    return user
