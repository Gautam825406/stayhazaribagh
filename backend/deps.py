"""Auth dependencies: current user / owner / admin from a Bearer JWT."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .auth import decode_access_token
from .database import get_db

_bearer = HTTPBearer(auto_error=False)

UNAUTHORISED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing access token",
    headers={"WWW-Authenticate": "Bearer"},
)


def _payload(creds: HTTPAuthorizationCredentials | None) -> dict:
    if creds is None:
        raise UNAUTHORISED
    try:
        return decode_access_token(creds.credentials)
    except Exception:
        raise UNAUTHORISED


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    payload = _payload(creds)
    if payload.get("role") not in ("tenant", "owner"):
        raise UNAUTHORISED
    user = db.query(models.User).filter(
        models.User.id == payload.get("user_id")
    ).first()
    if user is None:
        raise UNAUTHORISED
    return user


def get_current_owner(
    user: models.User = Depends(get_current_user),
) -> models.User:
    if user.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Owner role required",
        )
    return user


def get_current_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.AdminAccount:
    payload = _payload(creds)
    if payload.get("role") != "super_admin":
        raise UNAUTHORISED
    admin = db.query(models.AdminAccount).filter(
        models.AdminAccount.admin_id == payload.get("sub")
    ).first()
    if admin is None:
        raise UNAUTHORISED
    return admin


def get_current_owner_or_admin(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> tuple[str, models.User | models.AdminAccount]:
    """Returns ("owner", user) or ("admin", admin). Used by endpoints where
    an owner may act on their own records and the Super Admin on any."""
    payload = _payload(creds)
    role = payload.get("role")
    if role in ("tenant", "owner"):
        user = db.query(models.User).filter(
            models.User.id == payload.get("user_id")
        ).first()
        if user is None:
            raise UNAUTHORISED
        return ("owner", user)
    if role == "super_admin":
        admin = db.query(models.AdminAccount).filter(
            models.AdminAccount.admin_id == payload.get("sub")
        ).first()
        if admin is None:
            raise UNAUTHORISED
        return ("admin", admin)
    raise UNAUTHORISED


def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User | None:
    """Best-effort auth for endpoints that accept anonymous use too."""
    if creds is None:
        return None
    try:
        payload = decode_access_token(creds.credentials)
    except Exception:
        return None
    if payload.get("role") not in ("tenant", "owner"):
        return None
    return db.query(models.User).filter(
        models.User.id == payload.get("user_id")
    ).first()
