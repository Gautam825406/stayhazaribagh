"""Owner-portal router. Every query is scoped to the logged-in owner's
own listings — an owner can never see another owner's PGs, enquiries,
complaints or rent records."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_owner

router = APIRouter(prefix="/api/owner", tags=["owner"])


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


@router.get("/tenants", response_model=list[schemas.EnquiryResponse])
def my_tenants(owner: models.User = Depends(get_current_owner),
               db: Session = Depends(get_db)):
    """Tenants = enquiries the owner marked as booked / tenant."""
    ids = _own_listing_ids(db, owner)
    if not ids:
        return []
    return db.query(models.Enquiry).filter(
        models.Enquiry.listing_id.in_(ids),
        models.Enquiry.status.in_(("booked", "tenant")),
    ).order_by(models.Enquiry.created_at.desc()).all()


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
            listings_count=0, verified_count=0, enquiries_count=0,
            enquiries_new=0, tenants_count=0, complaints_open=0,
            rent_pending_amount=0.0, rent_paid_amount=0.0,
        )
    listings_count = len(ids)
    verified_count = db.query(func.count(models.Listing.id)).filter(
        models.Listing.id.in_(ids), models.Listing.verified.is_(True)
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
        enquiries_count=enquiries_count,
        enquiries_new=enquiries_new,
        tenants_count=tenants_count,
        complaints_open=complaints_open,
        rent_pending_amount=float(rent_pending),
        rent_paid_amount=float(rent_paid),
    )
