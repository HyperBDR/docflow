from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import ExtensionPair, ExtensionToken, Session as UserSession, User
from app.schemas import AuthInput, PasswordChange, UserOut, UserPreferenceUpdate
from app.security import expires_in, hash_password, hash_token, random_token, verify_password
from app.services import create_personal_organization

router = APIRouter(prefix="/api/auth", tags=["auth"])


def create_session(db: Session, user: User, response: Response) -> None:
    token = random_token()
    db.add(UserSession(user_id=user.id, token_hash=hash_token(token), active_organization_id=user.current_organization_id, expires_at=expires_in(days=settings.session_days)))
    db.commit()
    response.set_cookie(
        "docflow_session",
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_days * 86400,
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=201)
def register(payload: AuthInput, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="email already registered")
    is_first_user = (db.scalar(select(func.count(User.id))) or 0) == 0
    user = User(
        email=email,
        name=email.split("@", 1)[0],
        password_hash=hash_password(payload.password),
        role="admin" if is_first_user else "user",
        ui_locale=payload.ui_locale or "zh-CN",
    )
    db.add(user)
    db.flush()
    create_personal_organization(db, user)
    create_session(db, user, response)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: AuthInput, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or user.deleted_at or not verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="account disabled")
    create_session(db, user, response)
    return user


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    token: str | None = Cookie(default=None, alias="docflow_session"),
    db: Session = Depends(get_db),
):
    if token:
        session = db.scalar(select(UserSession).where(UserSession.token_hash == hash_token(token)))
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie("docflow_session", path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_preferences(payload: UserPreferenceUpdate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    values = payload.model_dump(exclude_unset=True)
    if "name" in values:
        values["name"] = (values["name"] or "").strip()
    for key, value in values.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/me/password", status_code=204)
def change_password(payload: PasswordChange, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if not verify_password(user.password_hash, payload.current_password):
        raise HTTPException(status_code=400, detail="current password is incorrect")
    if verify_password(user.password_hash, payload.new_password):
        raise HTTPException(status_code=400, detail="new password must be different")
    user.password_hash = hash_password(payload.new_password)
    # Password changes revoke every other web/extension credential. The current
    # cookie becomes invalid as well, which is safer and makes the user sign in again.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.execute(delete(ExtensionPair).where(ExtensionPair.user_id == user.id))
    db.execute(delete(ExtensionToken).where(ExtensionToken.user_id == user.id))
    db.commit()
