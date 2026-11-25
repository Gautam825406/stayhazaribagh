"""Password hashing, JWT tokens, and the login lockout policy.

Lockout: 5 wrong attempts -> account locked for 15 minutes. Counters and
lock timestamps live in the DB (users.failed_login_attempts / locked_until,
admin_account.*, owner_pins.*), so locks survive restarts.
"""
from datetime import datetime, timedelta

import jwt
from passlib.context import CryptContext

from .config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(*, subject: str, role: str, user_id: int | None = None) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": subject,
        "role": role,
        "user_id": user_id,
        "iat": now,
        "exp": now + timedelta(days=settings.JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
    )


def is_locked(locked_until) -> bool:
    return bool(locked_until and locked_until > datetime.utcnow())


def _attempts_field(obj) -> str:
    # Users / AdminAccount use failed_login_attempts; OwnerPin uses
    # failed_attempts. Both share the same lockout policy.
    return ("failed_login_attempts" if hasattr(obj, "failed_login_attempts")
            else "failed_attempts")


def register_failed_attempt(obj, db) -> None:
    """Bump the failure counter; lock the account on the 5th failure."""
    field = _attempts_field(obj)
    count = (getattr(obj, field) or 0) + 1
    setattr(obj, field, count)
    if count >= settings.MAX_LOGIN_ATTEMPTS:
        obj.locked_until = datetime.utcnow() + timedelta(
            minutes=settings.LOCKOUT_MINUTES
        )
    db.add(obj)
    db.commit()


def reset_failed_attempts(obj, db) -> None:
    field = _attempts_field(obj)
    if getattr(obj, field) or obj.locked_until:
        setattr(obj, field, 0)
        obj.locked_until = None
        db.add(obj)
        db.commit()
