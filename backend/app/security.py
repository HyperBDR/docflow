import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.config import settings

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def random_token(size: int = 32) -> str:
    return secrets.token_urlsafe(size)


def hash_token(value: str) -> str:
    return hmac.new(settings.secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def expires_in(days: int = 0, minutes: int = 0) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days, minutes=minutes)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)

