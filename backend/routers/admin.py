"""Super Admin router: platform-wide views (all listings, enquiries,
complaints) and stats. All endpoints require the Super Admin JWT."""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..deps import get_current_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


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
