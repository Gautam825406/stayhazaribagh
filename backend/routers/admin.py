"""Super Admin router: platform-wide views (all listings, enquiries,
complaints) and stats. All endpoints require the Super Admin JWT."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _listing_or_404(db: Session, listing_id: int) -> models.Listing:
    listing = db.query(models.Listing).filter(
        models.Listing.id == listing_id
    ).first()
    if listing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Listing not found",
        )
    return listing


def _owner_response(db: Session, owner: models.User
                    ) -> schemas.OwnerAdminResponse:
    count = db.query(func.count(models.Listing.id)).filter(
        models.Listing.owner_id == owner.id
    ).scalar() or 0
    return schemas.OwnerAdminResponse(
        id=owner.id, name=owner.name, whatsapp=owner.whatsapp,
        role=owner.role, verified_owner=bool(owner.verified_owner),
        listings_count=count, created_at=owner.created_at,
    )


@router.get("/listings", response_model=list[schemas.ListingResponse])
def all_listings(
    status: str | None = Query(None, description="pending | live | rejected"),
    city: str | None = Query(None),
    owner_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    """All listings including pending/rejected (unlike the public list)."""
    q = db.query(models.Listing)
    if status:
        q = q.filter(models.Listing.status == status)
    if city:
        q = q.filter(models.Listing.city.ilike(f"%{city.strip()}%"))
    if owner_id is not None:
        q = q.filter(models.Listing.owner_id == owner_id)
    return q.order_by(models.Listing.id.desc()).all()


@router.post("/listings/{listing_id}/approve",
             response_model=schemas.ListingResponse)
def approve_listing(
    listing_id: int,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    listing = _listing_or_404(db, listing_id)
    # Is this the owner's first live PG? (checked before flipping status)
    owner = None
    first_live = False
    if listing.owner_id is not None:
        owner = db.query(models.User).filter(
            models.User.id == listing.owner_id
        ).first()
        if owner is not None:
            other_live = db.query(func.count(models.Listing.id)).filter(
                models.Listing.owner_id == owner.id,
                models.Listing.id != listing.id,
                models.Listing.status == "live",
            ).scalar() or 0
            first_live = other_live == 0
    listing.status = "live"
    listing.verified = True
    listing.rejection_reason = None
    db.add(listing)
    if owner is not None and first_live:
        # Auto-verify the owner on their first approved PG.
        owner.verified_owner = True
        db.add(owner)
    db.commit()
    db.refresh(listing)
    return listing


@router.post("/listings/{listing_id}/reject",
             response_model=schemas.ListingResponse)
def reject_listing(
    listing_id: int,
    body: schemas.RejectRequest,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    listing = _listing_or_404(db, listing_id)
    listing.status = "rejected"
    listing.verified = False
    listing.rejection_reason = body.reason
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return listing


@router.get("/owners", response_model=list[schemas.OwnerAdminResponse])
def all_owners(db: Session = Depends(get_db),
               _admin: models.AdminAccount = Depends(get_current_admin)):
    owners = db.query(models.User).filter(
        models.User.role == "owner"
    ).order_by(models.User.id).all()
    return [_owner_response(db, owner) for owner in owners]


@router.post("/owners/{owner_id}/verify",
             response_model=schemas.OwnerAdminResponse)
def verify_owner(
    owner_id: int,
    body: schemas.OwnerVerifyRequest,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    owner = db.query(models.User).filter(
        models.User.id == owner_id, models.User.role == "owner"
    ).first()
    if owner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner not found",
        )
    owner.verified_owner = body.verified
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return _owner_response(db, owner)


@router.get("/overview")
def overview(db: Session = Depends(get_db),
             _admin: models.AdminAccount = Depends(get_current_admin)):
    return {
        "users": db.query(func.count(models.User.id)).scalar() or 0,
        "owners": db.query(func.count(models.User.id)).filter(
            models.User.role == "owner"
        ).scalar() or 0,
        "listings": db.query(func.count(models.Listing.id)).scalar() or 0,
        "verified_listings": db.query(func.count(models.Listing.id)).filter(
            models.Listing.verified.is_(True)
        ).scalar() or 0,
        "unverified_listings": db.query(func.count(models.Listing.id)).filter(
            models.Listing.verified.is_(False)
        ).scalar() or 0,
        "enquiries": db.query(func.count(models.Enquiry.id)).scalar() or 0,
        "complaints_open": db.query(func.count(models.Complaint.id)).filter(
            models.Complaint.status == "open"
        ).scalar() or 0,
        "reviews": db.query(func.count(models.Review.id)).scalar() or 0,
    }


@router.get("/enquiries", response_model=list[schemas.EnquiryResponse])
def all_enquiries(db: Session = Depends(get_db),
                  _admin: models.AdminAccount = Depends(get_current_admin)):
    return db.query(models.Enquiry).order_by(
        models.Enquiry.created_at.desc()
    ).all()


@router.get("/complaints", response_model=list[schemas.ComplaintResponse])
def all_complaints(db: Session = Depends(get_db),
                   _admin: models.AdminAccount = Depends(get_current_admin)):
    return db.query(models.Complaint).order_by(
        models.Complaint.created_at.desc()
    ).all()
