import secrets
from datetime import timezone
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user
from app.models import ExtensionPair, ExtensionToken, User
from app.security import expires_in, hash_token, random_token, utcnow

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


def expired(value) -> bool:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value < utcnow()


@router.post("/pair", response_model=PairCode)
def create_pair(db: Session = Depends(get_db), user: User = Depends(current_user)):
    code = f"{secrets.randbelow(1_000_000):06d}"
    pair = ExtensionPair(user_id=user.id, code_hash=hash_token(code), expires_at=expires_in(minutes=10))
    db.add(pair)
    db.commit()
    return PairCode(code=code)


@router.post("/pair/exchange", response_model=TokenOut)
def exchange_pair(payload: PairExchange, db: Session = Depends(get_db)):
    pair = db.scalar(select(ExtensionPair).where(ExtensionPair.code_hash == hash_token(payload.code)))
    if not pair or pair.used or expired(pair.expires_at):
        raise HTTPException(status_code=400, detail="invalid or expired pairing code")
    raw = random_token()
    db.add(ExtensionToken(user_id=pair.user_id, token_hash=hash_token(raw), expires_at=expires_in(days=settings.extension_token_days)))
    pair.used = True
    db.commit()
    return TokenOut(token=raw, expires_in=settings.extension_token_days * 86400, api_url=settings.public_base_url)


@router.delete("/tokens", status_code=204)
def revoke_tokens(db: Session = Depends(get_db), user: User = Depends(current_user)):
    tokens = db.scalars(select(ExtensionToken).where(ExtensionToken.user_id == user.id, ExtensionToken.revoked.is_(False))).all()
    for token in tokens:
        token.revoked = True
    db.commit()
