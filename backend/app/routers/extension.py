import secrets
from datetime import timezone
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.ai_models import active_model
from app.database import get_db
from app.dependencies import current_user
from app.models import ExtensionPair, ExtensionToken, User
from app.security import expires_in, hash_token, random_token, utcnow
from app.services import write_audit

router = APIRouter(prefix="/api/extension", tags=["extension"])


class PairCode(BaseModel):
    code: str
    expires_in: int = 600


class PairExchange(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class TokenOut(BaseModel):
    token: str
    expires_in: int
    api_url: str
    web_url: str


class ExtensionConfigOut(BaseModel):
    ai_enabled: bool
    default_content_locale: str


@router.get("/config", response_model=ExtensionConfigOut)
def extension_config(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return ExtensionConfigOut(
        ai_enabled=bool(active_model(db)),
        default_content_locale=user.ui_locale or "zh-CN",
    )


def expired(value) -> bool:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value < utcnow()


@router.post("/pair", response_model=PairCode)
def create_pair(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    code = f"{secrets.randbelow(1_000_000):06d}"
    pair = ExtensionPair(user_id=user.id, code_hash=hash_token(code), expires_at=expires_in(minutes=10))
    db.add(pair)
    write_audit(db, user, "extension.authorization_created", "user", user.id, user.email, user.current_organization_id,
                request=request, source="web")
    db.commit()
    return PairCode(code=code)


@router.post("/pair/exchange", response_model=TokenOut)
def exchange_pair(payload: PairExchange, request: Request, db: Session = Depends(get_db)):
    pair = db.scalar(select(ExtensionPair).where(ExtensionPair.code_hash == hash_token(payload.code)))
    if not pair or pair.used or expired(pair.expires_at):
        raise HTTPException(status_code=400, detail="invalid or expired pairing code")
    raw = random_token()
    user = db.get(User, pair.user_id)
    db.add(ExtensionToken(user_id=pair.user_id, token_hash=hash_token(raw), active_organization_id=user.current_organization_id if user else None, expires_at=expires_in(days=settings.extension_token_days)))
    pair.used = True
    if user:
        write_audit(db, user, "extension.connected", "user", user.id, user.email, user.current_organization_id,
                    request=request, source="extension")
    db.commit()
    return TokenOut(
        token=raw, expires_in=settings.extension_token_days * 86400,
        api_url=settings.public_base_url, web_url=settings.web_origin,
    )


@router.delete("/tokens", status_code=204)
def revoke_tokens(request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    credential = request.state.credential
    if isinstance(credential, ExtensionToken):
        credential.revoked = True
        write_audit(db, user, "extension.disconnected", "user", user.id, user.email, credential.active_organization_id,
                    request=request, source="extension")
        db.commit()
        return
    tokens = db.scalars(select(ExtensionToken).where(ExtensionToken.user_id == user.id, ExtensionToken.revoked.is_(False))).all()
    for token in tokens:
        token.revoked = True
    write_audit(db, user, "extension.tokens_revoked", "user", user.id, user.email, user.current_organization_id,
                after={"count": len(tokens)}, request=request, source="web")
    db.commit()
