"""Public listings, enquiries and reviews."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import (
    get_current_admin,
    get_current_owner_or_admin,
    get_current_user,
    get_optional_user,
)

router = APIRouter(prefix="/api", tags=["listings"])


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


@router.get("/listings", response_model=schemas.ListingListResponse)
def list_listings(
    city: str | None = Query(None, description="e.g. Hazaribagh, Ranchi"),
    area: str | None = Query(None),
    type: str | None = Query(None, alias="type"),
    for_whom: str | None = Query(None, alias="for"),
    gender: str | None = Query(None, description="alias for `for`"),
    search: str | None = Query(None, description="search name / area"),
    verified: bool | None = Query(None),
    min_rent: float | None = Query(None, ge=0),
    max_rent: float | None = Query(None, ge=0),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(models.Listing)
    if city:
        q = q.filter(models.Listing.city.ilike(f"%{city.strip()}%"))
    if area:
        q = q.filter(models.Listing.area.ilike(f"%{area.strip()}%"))
    if type:
        q = q.filter(models.Listing.type.ilike(f"%{type.strip()}%"))
    who = for_whom or gender
    if who:
        q = q.filter(models.Listing.for_whom.ilike(f"%{who.strip()}%"))
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(or_(models.Listing.name.ilike(s),
                         models.Listing.area.ilike(s)))
    if verified is not None:
        q = q.filter(models.Listing.verified == verified)
    if min_rent is not None:
        q = q.filter(models.Listing.rent >= min_rent)
    if max_rent is not None:
        q = q.filter(models.Listing.rent <= max_rent)
    total = q.count()
    items = q.order_by(models.Listing.id).offset(offset).limit(limit).all()
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get("/listings/{listing_id}", response_model=schemas.ListingResponse)
def get_listing(listing_id: int, db: Session = Depends(get_db)):
    return _listing_or_404(db, listing_id)


@router.post("/listings", response_model=schemas.ListingResponse,
             status_code=status.HTTP_201_CREATED)
def create_listing(
    body: schemas.ListingCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Owners (and Super Admin via their own flow) can list a PG.
    New owner listings start unverified; Super Admin verifies them."""
    if user.role != "owner":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners can create listings",
        )
    listing = models.Listing(**body.model_dump(), owner_id=user.id,
                            verified=False)
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return listing


@router.patch("/listings/{listing_id}", response_model=schemas.ListingResponse)
def update_listing(
    listing_id: int,
    body: schemas.ListingUpdate,
    actor: tuple[str, models.User | models.AdminAccount] = Depends(
        get_current_owner_or_admin
    ),
    db: Session = Depends(get_db),
):
    listing = _listing_or_404(db, listing_id)
    kind, who = actor
    if kind == "owner" and listing.owner_id != who.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own listings",
        )
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(listing, field, value)
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return listing


@router.delete("/listings/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_listing(
    listing_id: int,
    actor: tuple[str, models.User | models.AdminAccount] = Depends(
        get_current_owner_or_admin
    ),
    db: Session = Depends(get_db),
):
    listing = _listing_or_404(db, listing_id)
    kind, who = actor
    if kind == "owner" and listing.owner_id != who.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own listings",
        )
    db.delete(listing)
    db.commit()
    return None


# ---------------------------------------------------------------- complaints
@router.post("/complaints", response_model=schemas.ComplaintResponse,
             status_code=status.HTTP_201_CREATED)
def create_complaint(
    body: schemas.ComplaintCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _listing_or_404(db, body.listing_id)
    complaint = models.Complaint(**body.model_dump())
    db.add(complaint)
    db.commit()
    db.refresh(complaint)
    return complaint


# ---------------------------------------------------------------- enquiries
@router.post("/enquiries", response_model=schemas.EnquiryResponse,
             status_code=status.HTTP_201_CREATED)
def create_enquiry(
    body: schemas.EnquiryCreate,
    db: Session = Depends(get_db),
    _user: models.User | None = Depends(get_optional_user),
):
    _listing_or_404(db, body.listing_id)
    enquiry = models.Enquiry(**body.model_dump())
    db.add(enquiry)
    db.commit()
    db.refresh(enquiry)
    return enquiry


# ---------------------------------------------------------------- reviews
@router.post("/reviews", response_model=schemas.ReviewResponse,
             status_code=status.HTTP_201_CREATED)
def create_review(
    body: schemas.ReviewCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _listing_or_404(db, body.listing_id)
    review = models.Review(
        listing_id=body.listing_id,
        user_id=user.id,
        reviewer_name=body.reviewer_name,
        rating=body.rating,
        comment=body.comment,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


@router.get("/listings/{listing_id}/reviews",
            response_model=list[schemas.ReviewResponse])
def list_reviews(listing_id: int, db: Session = Depends(get_db)):
    _listing_or_404(db, listing_id)
    return db.query(models.Review).filter(
        models.Review.listing_id == listing_id
    ).order_by(models.Review.created_at.desc()).all()


# ---------------------------------------------------------------- admin verify
@router.post("/admin/listings/{listing_id}/verify",
             response_model=schemas.ListingResponse)
def verify_listing(
    listing_id: int,
    body: schemas.VerifyRequest | None = None,
    db: Session = Depends(get_db),
    _admin: models.AdminAccount = Depends(get_current_admin),
):
    listing = _listing_or_404(db, listing_id)
    listing.verified = True if body is None else body.verified
    db.add(listing)
    db.commit()
    db.refresh(listing)
    return listing
