"""SQLAlchemy models.

Password hashes and PIN hashes are stored here but are NEVER returned by
any API response (see schemas.py — no hash field exists on any output schema).
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship

from .database import Base


def _now():
    return datetime.utcnow()


class User(Base):
    """Tenant or owner account. WhatsApp number is the login identity."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    whatsapp = Column(String(20), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="tenant")  # tenant | owner
    verified_owner = Column(Boolean, nullable=False, default=False,
                            server_default=text("false"))
    # Owner registration approval: pending | approved | rejected | hold.
    # NEW owner signups start 'pending' (Super Admin approves them in the
    # New Requests queue); tenants and ALL pre-existing accounts are
    # 'approved' (grandfathered — nobody already registered gets locked out).
    approval_status = Column(String(20), nullable=False, default="approved",
                             server_default=text("'approved'"))
    # Admin's reason (reject) or note (hold) — shown to the owner.
    approval_note = Column(Text, nullable=True)
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)

    listings = relationship("Listing", back_populates="owner")
    pin = relationship("OwnerPin", back_populates="owner", uselist=False)
    reviews = relationship("Review", back_populates="user")


class AdminAccount(Base):
    """Single Super Admin account. Created once via /api/auth/admin/setup;
    the setup endpoint refuses with 409 if a row already exists.
    There is NO preset ID or password anywhere in this codebase."""

    __tablename__ = "admin_account"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(String(120), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class OwnerPin(Base):
    """Owner-portal PIN (WhatsApp + PIN login). Hashed, with its own
    5-wrong-attempts = 15-minute lock stored in the DB."""

    __tablename__ = "owner_pins"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    pin_hash = Column(String(255), nullable=False)
    failed_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)

    owner = relationship("User", back_populates="pin")


class Listing(Base):
    """A PG / hostel / flat / room listing.

    Columns cover every field present in stayhazaribagh-seed/seed.json:
    external_id (seed `id`, e.g. gm-1 / olx-1), sheet, name, area, type,
    for_whom (seed `for`), address, contact, rating, reviews_count
    (seed `reviews`), rent, bhk, size, posted, source, source_url, maps —
    plus city (derived at seed time from area/address text; NULL when the
    seed row names no recognisable city), verified (default False),
    owner_id (NULL for seeded rows until an owner claims/manages them).
    """

    __tablename__ = "listings"

    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(String(40), unique=True, nullable=True, index=True)
    sheet = Column(String(40), nullable=True)
    name = Column(String(300), nullable=False, index=True)
    area = Column(String(200), nullable=True, index=True)
    city = Column(String(80), nullable=True, index=True)
    type = Column(String(80), nullable=True, index=True)
    for_whom = Column(String(80), nullable=True)
    address = Column(Text, nullable=True)
    contact = Column(String(200), nullable=True)
    rating = Column(Float, nullable=True)
    reviews_count = Column(Integer, nullable=True)
    rent = Column(Float, nullable=True)
    bhk = Column(String(20), nullable=True)
    size = Column(String(40), nullable=True)
    posted = Column(String(40), nullable=True)
    source = Column(String(80), nullable=True)
    source_url = Column(Text, nullable=True)
    maps = Column(Text, nullable=True)
    verified = Column(Boolean, nullable=False, default=False)
    # pending | live | rejected — new owner listings start pending and are
    # hidden from the public list until an admin approves them.
    status = Column(String(20), nullable=False, default="live",
                    server_default=text("'live'"))
    rejection_reason = Column(Text, nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)

    owner = relationship("User", back_populates="listings")
    enquiries = relationship("Enquiry", back_populates="listing",
                             cascade="all, delete-orphan")
    reviews = relationship("Review", back_populates="listing",
                           cascade="all, delete-orphan")
    complaints = relationship("Complaint", back_populates="listing",
                              cascade="all, delete-orphan")
    rent_records = relationship("RentRecord", back_populates="listing",
                                cascade="all, delete-orphan")
    tenants = relationship("Tenant", back_populates="listing",
                           cascade="all, delete-orphan")
    mess_config = relationship("MessConfig", back_populates="listing",
                               uselist=False, cascade="all, delete-orphan")
    mess_payments = relationship("MessPayment", back_populates="listing",
                                 cascade="all, delete-orphan")


class Enquiry(Base):
    """A tenant enquiry / visit request for a listing (Book a Visit)."""

    __tablename__ = "enquiries"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"), nullable=False)
    name = Column(String(120), nullable=False)
    whatsapp = Column(String(20), nullable=False, index=True)
    message = Column(Text, nullable=True)
    # new | contacted | booked | tenant | closed
    status = Column(String(20), nullable=False, default="new")
    created_at = Column(DateTime, nullable=False, default=_now)

    listing = relationship("Listing", back_populates="enquiries")


class Review(Base):
    """A user-submitted review of a listing (separate from the seed's
    scraped rating / reviews_count)."""

    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewer_name = Column(String(120), nullable=False)
    rating = Column(Integer, nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)

    listing = relationship("Listing", back_populates="reviews")
    user = relationship("User", back_populates="reviews")


class Complaint(Base):
    """A tenant complaint against a listing / owner."""

    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"), nullable=False)
    tenant_name = Column(String(120), nullable=False)
    whatsapp = Column(String(20), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    # open | in_progress | resolved
    status = Column(String(20), nullable=False, default="open")
    created_at = Column(DateTime, nullable=False, default=_now)

    listing = relationship("Listing", back_populates="complaints")


class RentRecord(Base):
    """A rent / dues record for one listing (owner-managed)."""

    __tablename__ = "rent_records"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"), nullable=False)
    tenant_name = Column(String(120), nullable=False)
    tenant_whatsapp = Column(String(20), nullable=True)
    month = Column(String(20), nullable=False)  # e.g. "2026-11"
    amount = Column(Float, nullable=False)
    # pending | paid | overdue
    status = Column(String(20), nullable=False, default="pending")
    # upi | cash (how the tenant paid; NULL for older records)
    method = Column(String(10), nullable=True)
    notes = Column(Text, nullable=True)
    paid_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)

    listing = relationship("Listing", back_populates="rent_records")

    __table_args__ = (
        UniqueConstraint("listing_id", "tenant_whatsapp", "month",
                         name="uq_rent_listing_tenant_month"),
    )


class Tenant(Base):
    """A tenant actually staying in one of an owner's PGs (owner-managed
    onboarding — separate from enquiries, which are just visit requests)."""

    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"), nullable=False)
    name = Column(String(120), nullable=False)
    whatsapp = Column(String(20), nullable=False, index=True)
    room = Column(String(40), nullable=False, default="")
    bed = Column(String(40), nullable=False, default="")
    rent = Column(Float, nullable=False, default=0)
    move_in_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    moved_out = Column(Boolean, nullable=False, default=False)
    moved_out_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    created_at = Column(DateTime, nullable=False, default=_now)

    listing = relationship("Listing", back_populates="tenants")
    documents = relationship("TenantDocument", back_populates="tenant",
                             cascade="all, delete-orphan")
    mess_payments = relationship("MessPayment", back_populates="tenant",
                                 cascade="all, delete-orphan")


class TenantDocument(Base):
    """A KYC / agreement document for a tenant (Aadhaar, agreement,
    police verification status)."""

    __tablename__ = "tenant_documents"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    doc_type = Column(String(80), nullable=False)
    doc_number = Column(String(80), nullable=True)
    agreement_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    # pending | done | not_required
    police_verification = Column(String(20), nullable=False,
                                 default="pending")
    created_at = Column(DateTime, nullable=False, default=_now)

    tenant = relationship("Tenant", back_populates="documents")


class MessConfig(Base):
    """Per-listing mess settings (one row per listing). `menu` stores a
    JSON object, e.g. {"monday": ["Dal", "Rice"], ...}."""

    __tablename__ = "mess_configs"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"), unique=True,
                        nullable=False)
    enabled = Column(Boolean, nullable=False, default=False)
    monthly_fee = Column(Float, nullable=False, default=0)
    menu = Column(Text, nullable=False, default="{}")

    listing = relationship("Listing", back_populates="mess_config")


class MessPayment(Base):
    """A monthly mess-fee payment for one tenant in one listing."""

    __tablename__ = "mess_payments"

    id = Column(Integer, primary_key=True, index=True)
    listing_id = Column(Integer, ForeignKey("listings.id"), nullable=False)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    month = Column(String(20), nullable=False)  # e.g. "2026-11"
    amount = Column(Float, nullable=False)
    # pending | paid | overdue
    status = Column(String(20), nullable=False, default="pending")
    created_at = Column(DateTime, nullable=False, default=_now)

    listing = relationship("Listing", back_populates="mess_payments")
    tenant = relationship("Tenant", back_populates="mess_payments")
