"""Pydantic request/response schemas.

No schema ever exposes password_hash / pin_hash — those fields exist only
on the SQLAlchemy models and are never serialised.
"""
import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator

_WHATSAPP_RE = re.compile(r"^\+?[0-9][0-9 \-]{8,14}$")


def _clean_whatsapp(v: str) -> str:
    v = re.sub(r"[\s\-]", "", v.strip())
    if not re.fullmatch(r"\+?[0-9]{10,15}", v):
        raise ValueError("whatsapp must be a 10-15 digit phone number")
    return v


# ---------------------------------------------------------------- auth
class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    whatsapp: str
    password: str = Field(..., min_length=6, max_length=128)
    role: str = Field("tenant")

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v):
        return _clean_whatsapp(v)

    @field_validator("role")
    @classmethod
    def _role(cls, v):
        if v not in ("tenant", "owner"):
            raise ValueError("role must be tenant or owner")
        return v


class LoginRequest(BaseModel):
    whatsapp: str
    password: str = Field(..., min_length=1)

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v):
        return _clean_whatsapp(v)


class AdminSetupRequest(BaseModel):
    admin_id: str = Field(..., min_length=3, max_length=120)
    password: str = Field(..., min_length=8, max_length=128)


class AdminLoginRequest(BaseModel):
    admin_id: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class PinSetupRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^[0-9]{4,6}$")


class PinVerifyRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^[0-9]{4,6}$")


class PinLoginRequest(BaseModel):
    whatsapp: str
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^[0-9]{4,6}$")

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v):
        return _clean_whatsapp(v)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: Optional[int] = None
    name: Optional[str] = None
    # Owner registration approval: pending | approved | rejected | hold.
    approval_status: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    name: str
    whatsapp: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------- listings
class ListingCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=300)
    area: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=80)
    type: Optional[str] = Field(None, max_length=80)
    for_whom: Optional[str] = Field(None, max_length=80)
    address: Optional[str] = None
    contact: Optional[str] = Field(None, max_length=200)
    rating: Optional[float] = Field(None, ge=0, le=5)
    rent: Optional[float] = Field(None, ge=0)
    bhk: Optional[str] = Field(None, max_length=20)
    size: Optional[str] = Field(None, max_length=40)
    posted: Optional[str] = Field(None, max_length=40)
    source: Optional[str] = Field(None, max_length=80)
    source_url: Optional[str] = None
    maps: Optional[str] = None


class AdminListingCreate(ListingCreate):
    """Super Admin adds a PG himself — owner_id optional (admin's own
    listing when omitted). Goes live + verified immediately."""
    owner_id: Optional[int] = None


class ListingUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=300)
    area: Optional[str] = Field(None, max_length=200)
    city: Optional[str] = Field(None, max_length=80)
    type: Optional[str] = Field(None, max_length=80)
    for_whom: Optional[str] = Field(None, max_length=80)
    address: Optional[str] = None
    contact: Optional[str] = Field(None, max_length=200)
    rating: Optional[float] = Field(None, ge=0, le=5)
    rent: Optional[float] = Field(None, ge=0)
    bhk: Optional[str] = Field(None, max_length=20)
    size: Optional[str] = Field(None, max_length=40)
    source: Optional[str] = Field(None, max_length=80)
    source_url: Optional[str] = None
    maps: Optional[str] = None
    verified: Optional[bool] = None


class ListingResponse(BaseModel):
    id: int
    external_id: Optional[str] = None
    sheet: Optional[str] = None
    name: str
    area: Optional[str] = None
    city: Optional[str] = None
    type: Optional[str] = None
    for_whom: Optional[str] = None
    address: Optional[str] = None
    contact: Optional[str] = None
    rating: Optional[float] = None
    reviews_count: Optional[int] = None
    rent: Optional[float] = None
    bhk: Optional[str] = None
    size: Optional[str] = None
    posted: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    maps: Optional[str] = None
    verified: bool
    status: str = "live"
    rejection_reason: Optional[str] = None
    owner_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ListingListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ListingResponse]


class VerifyRequest(BaseModel):
    verified: bool = True


class RejectRequest(BaseModel):
    reason: str = Field(..., min_length=2)


class OwnerAdminResponse(BaseModel):
    id: int
    name: str
    whatsapp: str
    role: str
    verified_owner: bool
    approval_status: str = "approved"
    approval_note: Optional[str] = None
    listings_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class OwnerVerifyRequest(BaseModel):
    verified: bool


class OwnerApprovalRequest(BaseModel):
    """reason for reject, note for hold — shown to the owner."""
    reason: Optional[str] = None
    note: Optional[str] = None


class OwnerUpdateRequest(BaseModel):
    """Admin edits an owner's details before approving them."""
    name: Optional[str] = Field(None, min_length=2, max_length=120)


class OwnerMeResponse(BaseModel):
    id: int
    name: str
    whatsapp: str
    role: str
    verified_owner: bool
    approval_status: str = "approved"
    approval_note: Optional[str] = None

    model_config = {"from_attributes": True}


class NewRequestsResponse(BaseModel):
    """Super Admin New Requests queue: owner registrations + pending PGs."""
    owner_requests: list[OwnerAdminResponse]
    listing_requests: list[ListingResponse]


# ---------------------------------------------------------------- enquiries
class EnquiryCreate(BaseModel):
    listing_id: int
    name: str = Field(..., min_length=2, max_length=120)
    whatsapp: str
    message: Optional[str] = None

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v):
        return _clean_whatsapp(v)


class EnquiryResponse(BaseModel):
    id: int
    listing_id: int
    name: str
    whatsapp: str
    message: Optional[str] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class EnquiryStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ("new", "contacted", "booked", "tenant", "closed"):
            raise ValueError("invalid status")
        return v


# ---------------------------------------------------------------- reviews
class ReviewCreate(BaseModel):
    listing_id: int
    reviewer_name: str = Field(..., min_length=2, max_length=120)
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None


class ReviewResponse(BaseModel):
    id: int
    listing_id: int
    reviewer_name: str
    rating: int
    comment: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------- complaints
class ComplaintCreate(BaseModel):
    listing_id: int
    tenant_name: str = Field(..., min_length=2, max_length=120)
    whatsapp: str
    title: str = Field(..., min_length=2, max_length=200)
    description: Optional[str] = None

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v):
        return _clean_whatsapp(v)


class ComplaintResponse(BaseModel):
    id: int
    listing_id: int
    tenant_name: str
    whatsapp: str
    title: str
    description: Optional[str] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ComplaintStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ("open", "in_progress", "resolved"):
            raise ValueError("invalid status")
        return v


# ---------------------------------------------------------------- rent / dues
class RentRecordCreate(BaseModel):
    listing_id: int
    tenant_name: str = Field(..., min_length=2, max_length=120)
    tenant_whatsapp: Optional[str] = None
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")  # e.g. 2026-11
    amount: float = Field(..., ge=0)
    status: str = "pending"
    method: Optional[str] = None  # upi | cash
    notes: Optional[str] = None

    @field_validator("tenant_whatsapp")
    @classmethod
    def _wa(cls, v):
        return _clean_whatsapp(v) if v else v

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ("pending", "paid", "overdue"):
            raise ValueError("invalid status")
        return v

    @field_validator("method")
    @classmethod
    def _method(cls, v):
        if v is not None and v not in ("upi", "cash"):
            raise ValueError("method must be upi or cash")
        return v


class RentRecordResponse(BaseModel):
    id: int
    listing_id: int
    tenant_name: str
    tenant_whatsapp: Optional[str] = None
    month: str
    amount: float
    status: str
    method: Optional[str] = None
    notes: Optional[str] = None
    paid_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class RentStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ("pending", "paid", "overdue"):
            raise ValueError("invalid status")
        return v


class OwnerSummaryResponse(BaseModel):
    listings_count: int
    verified_count: int
    pending_count: int = 0
    live_count: int = 0
    verified_owner: bool = False
    enquiries_count: int
    enquiries_new: int
    tenants_count: int
    complaints_open: int
    rent_pending_amount: float
    rent_paid_amount: float


# ---------------------------------------------------------------- tenants
class TenantCreate(BaseModel):
    listing_id: int
    name: str = Field(..., min_length=2, max_length=120)
    whatsapp: str
    room: str = Field("", max_length=40)
    bed: str = Field("", max_length=40)
    rent: float = Field(0, ge=0)
    move_in_date: Optional[str] = Field(
        None, pattern=r"^\d{4}-\d{2}-\d{2}$")  # YYYY-MM-DD

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v):
        return _clean_whatsapp(v)


class TenantUpdate(BaseModel):
    moved_out: Optional[bool] = None
    moved_out_date: Optional[str] = Field(
        None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    room: Optional[str] = Field(None, max_length=40)
    bed: Optional[str] = Field(None, max_length=40)
    rent: Optional[float] = Field(None, ge=0)


class TenantResponse(BaseModel):
    id: int
    listing_id: int
    name: str
    whatsapp: str
    room: str
    bed: str
    rent: float
    move_in_date: Optional[str] = None
    moved_out: bool
    moved_out_date: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------- tenant documents
class DocumentCreate(BaseModel):
    doc_type: str = Field(..., min_length=2, max_length=80)
    doc_number: Optional[str] = Field(None, max_length=80)
    agreement_date: Optional[str] = Field(
        None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    police_verification: str = "pending"

    @field_validator("police_verification")
    @classmethod
    def _pv(cls, v):
        if v not in ("pending", "done", "not_required"):
            raise ValueError(
                "police_verification must be pending, done or not_required")
        return v


class DocumentUpdate(BaseModel):
    doc_type: Optional[str] = Field(None, min_length=2, max_length=80)
    doc_number: Optional[str] = Field(None, max_length=80)
    agreement_date: Optional[str] = Field(
        None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    police_verification: Optional[str] = None

    @field_validator("police_verification")
    @classmethod
    def _pv(cls, v):
        if v is not None and v not in ("pending", "done", "not_required"):
            raise ValueError(
                "police_verification must be pending, done or not_required")
        return v


class DocumentResponse(BaseModel):
    id: int
    tenant_id: int
    doc_type: str
    doc_number: Optional[str] = None
    agreement_date: Optional[str] = None
    police_verification: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------- mess
class MessConfigResponse(BaseModel):
    listing_id: int
    enabled: bool
    monthly_fee: float
    menu: dict

    model_config = {"from_attributes": True}


class MessConfigUpsert(BaseModel):
    enabled: bool = False
    monthly_fee: float = Field(0, ge=0)
    menu: dict[str, list[str]] = Field(default_factory=dict)


class MessPaymentCreate(BaseModel):
    listing_id: int
    tenant_id: int
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")  # e.g. 2026-11
    amount: float = Field(..., ge=0)
    status: str = "pending"

    @field_validator("status")
    @classmethod
    def _status(cls, v):
        if v not in ("pending", "paid", "overdue"):
            raise ValueError("invalid status")
        return v


class MessPaymentResponse(BaseModel):
    id: int
    listing_id: int
    tenant_id: int
    month: str
    amount: float
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
