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
        approval_status=owner.approval_status or "approved",
        approval_note=owner.approval_note,
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
        owner.approval_status = "approved"
        owner.approval_note = None
        db.add(owner)
    db.commit()
    db.refresh(listing)
    return listing


def _owner_or_404(db: Session, owner_id: int) -> models.User:
    owner = db.query(models.User).filter(
        models.User.id == owner_id, models.User.role == "owner"
    ).first()
    if owner is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Owner not found",
        )
    return owner


@router.get("/requests", response_model=schemas.NewRequestsResponse)
def new_requests(db: Session = Depends(get_db),
                 _admin: models.AdminAccount = Depends(get_current_admin)):
    """Super Admin New Requests queue — new owner registrations AND
    pending PG listings from approved owners, in one place."""
    owners = db.query(models.User).filter(
        models.User.role == "owner",
        models.User.approval_status.in_(("pending", "hold")),
    ).order_by(models.User.id.desc()).all()
    listings = db.query(models.Listing).filter(
        models.Listing.status == "pending"
    ).order_by(models.Listing.id.desc()).all()
    return schemas.NewRequestsResponse(
        owner_requests=[_owner_response(db, o) for o in owners],
        listing_requests=listings,
    )


@router.post("/owners/{owner_id}/approve",
             response_model=schemas.OwnerAdminResponse)
def approve_owner(
    owner_id: int,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    """Approve an owner registration — unlocks the full suite
    (PG Management, Tenants, Payments, Documents, Mess)."""
    owner = _owner_or_404(db, owner_id)
    owner.approval_status = "approved"
    owner.approval_note = None
    owner.verified_owner = True
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return _owner_response(db, owner)


@router.post("/owners/{owner_id}/reject",
             response_model=schemas.OwnerAdminResponse)
def reject_owner(
    owner_id: int,
    body: schemas.OwnerApprovalRequest,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    owner = _owner_or_404(db, owner_id)
    owner.approval_status = "rejected"
    owner.approval_note = (body.reason or "").strip() or None
    owner.verified_owner = False
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return _owner_response(db, owner)


@router.post("/owners/{owner_id}/hold",
             response_model=schemas.OwnerAdminResponse)
def hold_owner(
    owner_id: int,
    body: schemas.OwnerApprovalRequest,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    owner = _owner_or_404(db, owner_id)
    owner.approval_status = "hold"
    owner.approval_note = (body.note or body.reason or "").strip() or None
    owner.verified_owner = False
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return _owner_response(db, owner)


@router.post("/owners/{owner_id}/unhold",
             response_model=schemas.OwnerAdminResponse)
def unhold_owner(
    owner_id: int,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    """Hold se wapas Pending — admin dobara review kar sakta hai."""
    owner = _owner_or_404(db, owner_id)
    owner.approval_status = "pending"
    owner.approval_note = None
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return _owner_response(db, owner)


@router.patch("/owners/{owner_id}",
              response_model=schemas.OwnerAdminResponse)
def update_owner(
    owner_id: int,
    body: schemas.OwnerUpdateRequest,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    """Admin edits an owner's details before approving them."""
    owner = _owner_or_404(db, owner_id)
    if body.name is not None:
        owner.name = body.name
    db.add(owner)
    db.commit()
    db.refresh(owner)
    return _owner_response(db, owner)


@router.post("/listings", response_model=schemas.ListingResponse,
             status_code=status.HTTP_201_CREATED)
def admin_create_listing(
    body: schemas.AdminListingCreate,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    """Super Admin adds a PG himself — goes LIVE + Verified directly,
    never through the approval queue."""
    owner_id = body.owner_id
    if owner_id is not None:
        _owner_or_404(db, owner_id)
    data = body.model_dump(exclude={"owner_id"})
    listing = models.Listing(**data, owner_id=owner_id,
                             verified=True, status="live",
                             rejection_reason=None)
    db.add(listing)
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
    if body.verified:
        # Verifying an owner also clears their registration approval.
        owner.approval_status = "approved"
        owner.approval_note = None
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
        "pending_owner_requests": db.query(
            func.count(models.User.id)).filter(
            models.User.role == "owner",
            models.User.approval_status.in_(("pending", "hold")),
        ).scalar() or 0,
        "pending_listings": db.query(func.count(models.Listing.id)).filter(
            models.Listing.status == "pending"
        ).scalar() or 0,
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
