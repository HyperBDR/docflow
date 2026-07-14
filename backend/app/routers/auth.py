from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import Session as UserSession, User
from app.schemas import AuthInput, UserOut
from app.security import expires_in, hash_password, hash_token, random_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def create_session(db: Session, user: User, response: Response) -> None:
    token = random_token()
    db.add(UserSession(user_id=user.id, token_hash=hash_token(token), expires_at=expires_in(days=settings.session_days)))
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
    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.flush()
    create_session(db, user, response)
    return user


@router.post("/login", response_model=UserOut)
def login(payload: AuthInput, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not verify_password(user.password_hash, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
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

