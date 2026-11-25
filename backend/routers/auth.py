"""Auth router: register / login, Super Admin setup + login, owner PIN."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import (
    create_access_token,
    hash_password,
    is_locked,
    register_failed_attempt,
    reset_failed_attempts,
    verify_password,
)
from ..config import settings
from ..database import get_db
from ..deps import get_current_owner

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _lockout_response():
    return HTTPException(
        status_code=status.HTTP_423_LOCKED,
        detail=(
            f"Too many wrong attempts. Locked for "
            f"{settings.LOCKOUT_MINUTES} minutes."
        ),
    )


@router.post("/register", response_model=schemas.TokenResponse,
             status_code=status.HTTP_201_CREATED)
def register(body: schemas.RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(
        models.User.whatsapp == body.whatsapp
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this WhatsApp number already exists",
        )
    user = models.User(
        name=body.name,
        whatsapp=body.whatsapp,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.TokenResponse(
        access_token=create_access_token(
            subject=user.whatsapp, role=user.role, user_id=user.id
        ),
        role=user.role,
        user_id=user.id,
        name=user.name,
    )


@router.post("/login", response_model=schemas.TokenResponse)
def login(body: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(
        models.User.whatsapp == body.whatsapp
    ).first()
    # Same error for unknown number vs wrong password (no user enumeration).
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid WhatsApp number or password",
        )
    if is_locked(user.locked_until):
        raise _lockout_response()
    if not verify_password(body.password, user.password_hash):
        register_failed_attempt(user, db)
        if is_locked(user.locked_until):
            raise _lockout_response()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid WhatsApp number or password",
        )
    reset_failed_attempts(user, db)
    return schemas.TokenResponse(
        access_token=create_access_token(
            subject=user.whatsapp, role=user.role, user_id=user.id
        ),
        role=user.role,
        user_id=user.id,
        name=user.name,
    )


@router.post("/admin/setup", status_code=status.HTTP_201_CREATED)
def admin_setup(body: schemas.AdminSetupRequest, db: Session = Depends(get_db)):
    """Create the single Super Admin account. Works exactly once — if an
    admin already exists this returns 409. There is no preset ID/password."""
    existing = db.query(models.AdminAccount).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Super Admin account already exists",
        )
    admin = models.AdminAccount(
        admin_id=body.admin_id,
        password_hash=hash_password(body.password),
    )
    db.add(admin)
    db.commit()
    return {"detail": "Super Admin account created", "admin_id": admin.admin_id}


@router.post("/admin/login", response_model=schemas.TokenResponse)
def admin_login(body: schemas.AdminLoginRequest, db: Session = Depends(get_db)):
    admin = db.query(models.AdminAccount).filter(
        models.AdminAccount.admin_id == body.admin_id
    ).first()
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin ID or password",
        )
    if is_locked(admin.locked_until):
        raise _lockout_response()
    if not verify_password(body.password, admin.password_hash):
        register_failed_attempt(admin, db)
        if is_locked(admin.locked_until):
            raise _lockout_response()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin ID or password",
        )
    reset_failed_attempts(admin, db)
    return schemas.TokenResponse(
        access_token=create_access_token(subject=admin.admin_id,
                                         role="super_admin"),
        role="super_admin",
        name=admin.admin_id,
    )


@router.post("/owner/pin/setup")
def pin_setup(
    body: schemas.PinSetupRequest,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    """Set (or change) the owner's portal PIN. PIN is stored hashed only."""
    pin = db.query(models.OwnerPin).filter(
        models.OwnerPin.owner_id == owner.id
    ).first()
    if pin is None:
        pin = models.OwnerPin(owner_id=owner.id,
                              pin_hash=hash_password(body.pin))
    else:
        pin.pin_hash = hash_password(body.pin)
        pin.failed_attempts = 0
        pin.locked_until = None
    db.add(pin)
    db.commit()
    return {"detail": "Owner PIN set"}


@router.post("/owner/pin/verify")
def pin_verify(
    body: schemas.PinVerifyRequest,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    pin = db.query(models.OwnerPin).filter(
        models.OwnerPin.owner_id == owner.id
    ).first()
    if pin is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No PIN set for this owner",
        )
    if is_locked(pin.locked_until):
        raise _lockout_response()
    if not verify_password(body.pin, pin.pin_hash):
        register_failed_attempt(pin, db)
        if is_locked(pin.locked_until):
            raise _lockout_response()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid PIN",
        )
    reset_failed_attempts(pin, db)
    return {"detail": "PIN verified"}


@router.post("/owner/pin-login", response_model=schemas.TokenResponse)
def pin_login(body: schemas.PinLoginRequest, db: Session = Depends(get_db)):
    """Owner Portal login with WhatsApp + PIN (no password)."""
    user = db.query(models.User).filter(
        models.User.whatsapp == body.whatsapp,
        models.User.role == "owner",
    ).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid WhatsApp number or PIN",
        )
    pin = db.query(models.OwnerPin).filter(
        models.OwnerPin.owner_id == user.id
    ).first()
    if pin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid WhatsApp number or PIN",
        )
    if is_locked(pin.locked_until):
        raise _lockout_response()
    if not verify_password(body.pin, pin.pin_hash):
        register_failed_attempt(pin, db)
        if is_locked(pin.locked_until):
            raise _lockout_response()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid WhatsApp number or PIN",
        )
    reset_failed_attempts(pin, db)
    return schemas.TokenResponse(
        access_token=create_access_token(
            subject=user.whatsapp, role=user.role, user_id=user.id
        ),
        role=user.role,
        user_id=user.id,
        name=user.name,
    )
