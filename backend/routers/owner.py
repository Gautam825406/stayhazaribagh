"""Owner-portal router. Every query is scoped to the logged-in owner's
own listings — an owner can never see another owner's PGs, enquiries,
complaints or rent records."""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_owner

router = APIRouter(prefix="/api/owner", tags=["owner"])

VERIFICATION_PENDING_DETAIL = (
    "Owner verification pending — Admin verify karega, phir ye feature khulega"
)


def _require_verified_owner(owner: models.User) -> None:
    """Tenant / document / mess / rent features open only once an admin
    has verified the owner (auto-verified on their first approved PG)."""
    if not owner.verified_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=VERIFICATION_PENDING_DETAIL,
        )


def _own_listing_ids(db: Session, owner: models.User) -> list[int]:
    return [
        row[0]
        for row in db.query(models.Listing.id)
        .filter(models.Listing.owner_id == owner.id)
        .all()
    ]


def _own_listing_or_404(db: Session, owner: models.User,
                        listing_id: int) -> models.Listing:
    listing = db.query(models.Listing).filter(
        models.Listing.id == listing_id,
        models.Listing.owner_id == owner.id,
    ).first()
    if listing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found among your PGs",
        )
    return listing


def _own_tenant_or_404(db: Session, owner: models.User,
                        tenant_id: int) -> models.Tenant:
    tenant = db.query(models.Tenant).join(
        models.Listing, models.Tenant.listing_id == models.Listing.id
    ).filter(
        models.Tenant.id == tenant_id,
        models.Listing.owner_id == owner.id,
    ).first()
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found among your PGs",
        )
    return tenant


@router.get("/me", response_model=schemas.OwnerMeResponse)
def me(owner: models.User = Depends(get_current_owner)):
    return schemas.OwnerMeResponse(
        id=owner.id, name=owner.name, whatsapp=owner.whatsapp,
        role=owner.role, verified_owner=bool(owner.verified_owner),
        approval_status=owner.approval_status or "approved",
        approval_note=owner.approval_note,
    )


@router.get("/listings", response_model=list[schemas.ListingResponse])
def my_listings(owner: models.User = Depends(get_current_owner),
                db: Session = Depends(get_db)):
    return db.query(models.Listing).filter(
        models.Listing.owner_id == owner.id
    ).order_by(models.Listing.id).all()


@router.get("/enquiries", response_model=list[schemas.EnquiryResponse])
def my_enquiries(owner: models.User = Depends(get_current_owner),
                 db: Session = Depends(get_db)):
    ids = _own_listing_ids(db, owner)
    if not ids:
        return []
    return db.query(models.Enquiry).filter(
        models.Enquiry.listing_id.in_(ids)
    ).order_by(models.Enquiry.created_at.desc()).all()


@router.patch("/enquiries/{enquiry_id}",
              response_model=schemas.EnquiryResponse)
def update_enquiry_status(
    enquiry_id: int,
    body: schemas.EnquiryStatusUpdate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    ids = _own_listing_ids(db, owner)
    enquiry = db.query(models.Enquiry).filter(
        models.Enquiry.id == enquiry_id,
        models.Enquiry.listing_id.in_(ids),
    ).first()
    if enquiry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enquiry not found among your PGs",
        )
    enquiry.status = body.status
    db.add(enquiry)
    db.commit()
    db.refresh(enquiry)
    return enquiry


# ---------------------------------------------------------------- tenants
# (Onboarded tenants living in the owner's PGs — replaces the old
# enquiry-derived view; enquiries still live under /api/owner/enquiries.)
@router.post("/tenants", response_model=schemas.TenantResponse,
             status_code=status.HTTP_201_CREATED)
def create_tenant(
    body: schemas.TenantCreate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    _own_listing_or_404(db, owner, body.listing_id)
    tenant = models.Tenant(**body.model_dump())
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


@router.get("/tenants", response_model=list[schemas.TenantResponse])
def my_tenants(
    listing_id: int | None = Query(None),
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    ids = _own_listing_ids(db, owner)
    if not ids:
        return []
    if listing_id is not None:
        _own_listing_or_404(db, owner, listing_id)
        ids = [listing_id]
    return db.query(models.Tenant).filter(
        models.Tenant.listing_id.in_(ids)
    ).order_by(models.Tenant.created_at.desc(),
               models.Tenant.id.desc()).all()


@router.patch("/tenants/{tenant_id}", response_model=schemas.TenantResponse)
def update_tenant(
    tenant_id: int,
    body: schemas.TenantUpdate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    tenant = _own_tenant_or_404(db, owner, tenant_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(tenant, field, value)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


# ---------------------------------------------------------------- tenant documents
@router.post("/tenants/{tenant_id}/documents",
             response_model=schemas.DocumentResponse,
             status_code=status.HTTP_201_CREATED)
def create_document(
    tenant_id: int,
    body: schemas.DocumentCreate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    tenant = _own_tenant_or_404(db, owner, tenant_id)
    doc = models.TenantDocument(tenant_id=tenant.id, **body.model_dump())
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/tenants/{tenant_id}/documents",
            response_model=list[schemas.DocumentResponse])
def list_documents(
    tenant_id: int,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    tenant = _own_tenant_or_404(db, owner, tenant_id)
    return db.query(models.TenantDocument).filter(
        models.TenantDocument.tenant_id == tenant.id
    ).order_by(models.TenantDocument.created_at.desc(),
               models.TenantDocument.id.desc()).all()


@router.patch("/documents/{doc_id}", response_model=schemas.DocumentResponse)
def update_document(
    doc_id: int,
    body: schemas.DocumentUpdate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    doc = db.query(models.TenantDocument).join(
        models.Tenant,
        models.TenantDocument.tenant_id == models.Tenant.id,
    ).join(
        models.Listing,
        models.Tenant.listing_id == models.Listing.id,
    ).filter(
        models.TenantDocument.id == doc_id,
        models.Listing.owner_id == owner.id,
    ).first()
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found among your PGs",
        )
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(doc, field, value)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


# ---------------------------------------------------------------- mess
def _mess_response(listing_id: int, cfg: models.MessConfig | None
                   ) -> schemas.MessConfigResponse:
    if cfg is None:
        return schemas.MessConfigResponse(
            listing_id=listing_id, enabled=False, monthly_fee=0, menu={})
    try:
        menu = json.loads(cfg.menu) if cfg.menu else {}
    except (ValueError, TypeError):
        menu = {}
    if not isinstance(menu, dict):
        menu = {}
    return schemas.MessConfigResponse(
        listing_id=listing_id, enabled=cfg.enabled,
        monthly_fee=cfg.monthly_fee, menu=menu)


@router.get("/listings/{listing_id}/mess",
            response_model=schemas.MessConfigResponse)
def get_mess(
    listing_id: int,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    _own_listing_or_404(db, owner, listing_id)
    cfg = db.query(models.MessConfig).filter(
        models.MessConfig.listing_id == listing_id
    ).first()
    return _mess_response(listing_id, cfg)


@router.put("/listings/{listing_id}/mess",
            response_model=schemas.MessConfigResponse)
def put_mess(
    listing_id: int,
    body: schemas.MessConfigUpsert,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    _own_listing_or_404(db, owner, listing_id)
    cfg = db.query(models.MessConfig).filter(
        models.MessConfig.listing_id == listing_id
    ).first()
    if cfg is None:
        cfg = models.MessConfig(listing_id=listing_id)
    cfg.enabled = body.enabled
    cfg.monthly_fee = body.monthly_fee
    cfg.menu = json.dumps(body.menu)
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _mess_response(listing_id, cfg)


# ---------------------------------------------------------------- mess payments
@router.post("/mess-payments", response_model=schemas.MessPaymentResponse,
             status_code=status.HTTP_201_CREATED)
def create_mess_payment(
    body: schemas.MessPaymentCreate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    _own_listing_or_404(db, owner, body.listing_id)
    tenant = _own_tenant_or_404(db, owner, body.tenant_id)
    if tenant.listing_id != body.listing_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found in this PG",
        )
    payment = models.MessPayment(**body.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/mess-payments", response_model=list[schemas.MessPaymentResponse])
def list_mess_payments(
    listing_id: int | None = Query(None),
    month: str | None = Query(None),
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    ids = _own_listing_ids(db, owner)
    if not ids:
        return []
    if listing_id is not None:
        _own_listing_or_404(db, owner, listing_id)
        ids = [listing_id]
    q = db.query(models.MessPayment).filter(
        models.MessPayment.listing_id.in_(ids)
    )
    if month:
        q = q.filter(models.MessPayment.month == month)
    return q.order_by(models.MessPayment.created_at.desc(),
                      models.MessPayment.id.desc()).all()


@router.get("/complaints", response_model=list[schemas.ComplaintResponse])
def my_complaints(owner: models.User = Depends(get_current_owner),
                  db: Session = Depends(get_db)):
    ids = _own_listing_ids(db, owner)
    if not ids:
        return []
    return db.query(models.Complaint).filter(
        models.Complaint.listing_id.in_(ids)
    ).order_by(models.Complaint.created_at.desc()).all()


@router.patch("/complaints/{complaint_id}",
              response_model=schemas.ComplaintResponse)
def update_complaint_status(
    complaint_id: int,
    body: schemas.ComplaintStatusUpdate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    ids = _own_listing_ids(db, owner)
    complaint = db.query(models.Complaint).filter(
        models.Complaint.id == complaint_id,
        models.Complaint.listing_id.in_(ids),
    ).first()
    if complaint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Complaint not found among your PGs",
        )
    complaint.status = body.status
    db.add(complaint)
    db.commit()
    db.refresh(complaint)
    return complaint


@router.get("/rent", response_model=list[schemas.RentRecordResponse])
def my_rent(owner: models.User = Depends(get_current_owner),
            db: Session = Depends(get_db)):
    _require_verified_owner(owner)
    ids = _own_listing_ids(db, owner)
    if not ids:
        return []
    return db.query(models.RentRecord).filter(
        models.RentRecord.listing_id.in_(ids)
    ).order_by(models.RentRecord.month.desc()).all()


@router.post("/rent", response_model=schemas.RentRecordResponse,
             status_code=status.HTTP_201_CREATED)
def create_rent(
    body: schemas.RentRecordCreate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    _require_verified_owner(owner)
    _own_listing_or_404(db, owner, body.listing_id)
    record = models.RentRecord(**body.model_dump())
    db.add(record)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A rent record already exists for this tenant and month",
        )
    db.refresh(record)
    return record


@router.patch("/rent/{record_id}", response_model=schemas.RentRecordResponse)
def update_rent_status(
    record_id: int,
    body: schemas.RentStatusUpdate,
    owner: models.User = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    ids = _own_listing_ids(db, owner)
    record = db.query(models.RentRecord).filter(
        models.RentRecord.id == record_id,
        models.RentRecord.listing_id.in_(ids),
    ).first()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rent record not found among your PGs",
        )
    record.status = body.status
    record.paid_at = datetime.utcnow() if body.status == "paid" else None
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/summary", response_model=schemas.OwnerSummaryResponse)
def summary(owner: models.User = Depends(get_current_owner),
            db: Session = Depends(get_db)):
    ids = _own_listing_ids(db, owner)
    if not ids:
        return schemas.OwnerSummaryResponse(
            listings_count=0, verified_count=0, pending_count=0,
            live_count=0, verified_owner=bool(owner.verified_owner),
            enquiries_count=0,
            enquiries_new=0, tenants_count=0, complaints_open=0,
            rent_pending_amount=0.0, rent_paid_amount=0.0,
        )
    listings_count = len(ids)
    verified_count = db.query(func.count(models.Listing.id)).filter(
        models.Listing.id.in_(ids), models.Listing.verified.is_(True)
    ).scalar() or 0
    pending_count = db.query(func.count(models.Listing.id)).filter(
        models.Listing.id.in_(ids), models.Listing.status == "pending"
    ).scalar() or 0
    live_count = db.query(func.count(models.Listing.id)).filter(
        models.Listing.id.in_(ids), models.Listing.status == "live"
    ).scalar() or 0
    enquiries_count = db.query(func.count(models.Enquiry.id)).filter(
        models.Enquiry.listing_id.in_(ids)
    ).scalar() or 0
    enquiries_new = db.query(func.count(models.Enquiry.id)).filter(
        models.Enquiry.listing_id.in_(ids),
        models.Enquiry.status == "new",
    ).scalar() or 0
    tenants_count = db.query(func.count(models.Enquiry.id)).filter(
        models.Enquiry.listing_id.in_(ids),
        models.Enquiry.status.in_(("booked", "tenant")),
    ).scalar() or 0
    complaints_open = db.query(func.count(models.Complaint.id)).filter(
        models.Complaint.listing_id.in_(ids),
        models.Complaint.status == "open",
    ).scalar() or 0
    rent_pending = db.query(
        func.coalesce(func.sum(models.RentRecord.amount), 0.0)
    ).filter(
        models.RentRecord.listing_id.in_(ids),
        models.RentRecord.status.in_(("pending", "overdue")),
    ).scalar() or 0.0
    rent_paid = db.query(
        func.coalesce(func.sum(models.RentRecord.amount), 0.0)
    ).filter(
        models.RentRecord.listing_id.in_(ids),
        models.RentRecord.status == "paid",
    ).scalar() or 0.0
    return schemas.OwnerSummaryResponse(
        listings_count=listings_count,
        verified_count=verified_count,
        pending_count=pending_count,
        live_count=live_count,
        verified_owner=bool(owner.verified_owner),
        enquiries_count=enquiries_count,
        enquiries_new=enquiries_new,
        tenants_count=tenants_count,
        complaints_open=complaints_open,
        rent_pending_amount=float(rent_pending),
        rent_paid_amount=float(rent_paid),
    )
