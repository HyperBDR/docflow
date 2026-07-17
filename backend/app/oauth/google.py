import base64
import hashlib
import json
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import OAuthLoginState, now
from app.platform_settings import GoogleRuntimeConfig
from app.secrets import decrypt_secret, encrypt_secret
from app.security import expires_in, hash_token, random_token


AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")


@dataclass(frozen=True)
class GoogleClaims:
    subject: str
    email: str
    email_verified: bool
    name: str
    picture: str


def redirect_uri() -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/auth/google/callback"


def safe_return_to(value: str | None, default: str = "/") -> str:
    value = value or default
    return value if value.startswith("/") and not value.startswith("//") else default


def start_authorization(db: Session, config: GoogleRuntimeConfig, *, mode: str, user_id: str | None, return_to: str) -> str:
    if not config.configured:
        raise RuntimeError("Google sign-in is not configured")
    state, nonce, verifier = random_token(32), random_token(32), random_token(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    db.execute(delete(OAuthLoginState).where(OAuthLoginState.expires_at < now()))
    db.add(OAuthLoginState(
        state_hash=hash_token(state), provider="google", mode=mode, user_id=user_id,
        nonce=nonce, code_verifier_encrypted=encrypt_secret(verifier),
        return_to=safe_return_to(return_to), expires_at=expires_in(minutes=10),
    ))
    db.commit()
    return f"{AUTHORIZATION_URL}?{urlencode({
        'client_id': config.client_id, 'redirect_uri': redirect_uri(), 'response_type': 'code',
        'scope': 'openid email profile', 'state': state, 'nonce': nonce,
        'code_challenge': challenge, 'code_challenge_method': 'S256', 'prompt': 'select_account',
    })}"


def consume_state(db: Session, raw_state: str) -> OAuthLoginState:
    value = db.scalar(select(OAuthLoginState).where(
        OAuthLoginState.state_hash == hash_token(raw_state), OAuthLoginState.provider == "google",
    ))
    current = now()
    if not value or (value.expires_at.replace(tzinfo=current.tzinfo) if value.expires_at.tzinfo is None else value.expires_at) < current:
        if value:
            db.delete(value); db.commit()
        raise RuntimeError("Google sign-in state is invalid or expired")
    db.delete(value)
    db.commit()
    return value


def exchange_code(config: GoogleRuntimeConfig, state: OAuthLoginState, code: str) -> GoogleClaims:
    response = httpx.post(TOKEN_URL, data={
        "client_id": config.client_id, "client_secret": config.client_secret,
        "code": code, "code_verifier": decrypt_secret(state.code_verifier_encrypted),
        "grant_type": "authorization_code", "redirect_uri": redirect_uri(),
    }, timeout=12)
    response.raise_for_status()
    id_token = response.json().get("id_token", "")
    if not id_token:
        raise RuntimeError("Google did not return an ID token")
    header = jwt.get_unverified_header(id_token)
    keys_response = httpx.get(JWKS_URL, timeout=10)
    keys_response.raise_for_status()
    jwk = next((item for item in keys_response.json().get("keys", []) if item.get("kid") == header.get("kid")), None)
    if not jwk:
        raise RuntimeError("Google signing key was not found")
    key = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
    claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=config.client_id, issuer=list(ISSUERS))
    if claims.get("nonce") != state.nonce:
        raise RuntimeError("Google sign-in nonce is invalid")
    email = str(claims.get("email", "")).strip().lower()
    return GoogleClaims(
        subject=str(claims.get("sub", "")), email=email,
        email_verified=claims.get("email_verified") is True,
        name=str(claims.get("name", ""))[:160], picture=str(claims.get("picture", ""))[:1000],
    )


def validate_connectivity() -> None:
    response = httpx.get(DISCOVERY_URL, timeout=10)
    response.raise_for_status()
    if response.json().get("issuer") not in ISSUERS:
        raise RuntimeError("Google OpenID discovery returned an unexpected issuer")
