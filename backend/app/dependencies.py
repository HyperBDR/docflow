from datetime import timezone
from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ExtensionToken, Session as UserSession, User
from app.security import hash_token, utcnow


def expired(value) -> bool:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value < utcnow()


def current_user(
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
    user = db.get(User, credential.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="account disabled")
    return user

