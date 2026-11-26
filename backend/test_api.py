"""API smoke tests. Run from ~/workspace/pg-khoj/ with:
    backend/.venv/bin/python -m pytest backend/test_api.py -q
Uses a throwaway SQLite DB (TEST_DATABASE_URL) — never the dev DB.
"""
import os
import sys

os.environ["TEST_DATABASE_URL"] = "sqlite:////tmp/stayhazaribagh_test.db"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

if os.path.exists("/tmp/stayhazaribagh_test.db"):
    os.remove("/tmp/stayhazaribagh_test.db")

# Point the app at the test DB before importing main.
import backend.database as database  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

test_engine = create_engine(
    "sqlite:////tmp/stayhazaribagh_test.db",
    connect_args={"check_same_thread": False},
)
database.engine = test_engine
database.SessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=test_engine
)

from backend.main import app  # noqa: E402
from backend.models import Listing  # noqa: E402

client = TestClient(app)


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _admin_token() -> str:
    """Log in as Super Admin, resetting the 15-min lockout first
    (test-only setup; the lockout test locks the account)."""
    from backend.database import SessionLocal as _SL
    from backend.models import AdminAccount as _AA
    _db = _SL()
    _admin = _db.query(_AA).first()
    if _admin is None:
        _db.close()
        client.post("/api/auth/admin/setup",
                    json={"admin_id": "superadmin",
                          "password": "AdminPass123"})
        _db = _SL()
        _admin = _db.query(_AA).first()
    _admin.failed_login_attempts = 0
    _admin.locked_until = None
    _db.commit()
    _db.close()
    admin = client.post("/api/auth/admin/login",
                        json={"admin_id": "superadmin",
                              "password": "AdminPass123"})
    assert admin.status_code == 200
    return admin.json()["access_token"]


def _make_owner(whatsapp: str, name: str = "Owner") -> tuple[str, dict]:
    r = client.post("/api/auth/register", json={
        "name": name, "whatsapp": whatsapp,
        "password": "ownerpass", "role": "owner"})
    assert r.status_code == 201
    return r.json()["access_token"], _auth_headers(r.json()["access_token"])


def _make_listing(headers: dict, name: str = "PG") -> dict:
    r = client.post("/api/listings", json={
        "name": name, "area": "Korrah", "city": "Hazaribagh",
        "type": "PG", "for_whom": "Boys", "rent": 3000}, headers=headers)
    assert r.status_code == 201
    return r.json()


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_admin_setup_once_only():
    r = client.post("/api/auth/admin/setup",
                    json={"admin_id": "superadmin", "password": "AdminPass123"})
    assert r.status_code == 201
    r2 = client.post("/api/auth/admin/setup",
                     json={"admin_id": "other", "password": "AdminPass123"})
    assert r2.status_code == 409


def test_admin_login_and_lockout():
    r = client.post("/api/auth/admin/login",
                    json={"admin_id": "superadmin",
                          "password": "AdminPass123"})
    assert r.status_code == 200
    assert r.json()["role"] == "super_admin"
    # 5 wrong attempts -> 423 lock
    for _ in range(5):
        bad = client.post("/api/auth/admin/login",
                          json={"admin_id": "superadmin",
                                "password": "wrongpass"})
    assert bad.status_code == 423


def test_register_login_and_owner_listing_flow():
    r = client.post("/api/auth/register", json={
        "name": "Test Owner", "whatsapp": "919999999999",
        "password": "ownerpass", "role": "owner"})
    assert r.status_code == 201
    token = r.json()["access_token"]
    headers = _auth_headers(token)

    dup = client.post("/api/auth/register", json={
        "name": "Again", "whatsapp": "919999999999",
        "password": "ownerpass", "role": "owner"})
    assert dup.status_code == 409

    r = client.post("/api/listings", json={
        "name": "Test PG", "area": "Korrah", "city": "Hazaribagh",
        "type": "PG", "for_whom": "Boys", "rent": 3000}, headers=headers)
    assert r.status_code == 201
    listing_id = r.json()["id"]
    assert r.json()["verified"] is False
    # New listings start pending and are hidden from the public list.
    assert r.json()["status"] == "pending"

    r = client.get(f"/api/listings/{listing_id}")
    assert r.status_code == 200

    r = client.patch(f"/api/listings/{listing_id}",
                     json={"rent": 3500}, headers=headers)
    assert r.status_code == 200 and r.json()["rent"] == 3500

    # Owner cannot flip verified / status via PATCH.
    r = client.patch(f"/api/listings/{listing_id}",
                     json={"verified": True, "rent": 3600}, headers=headers)
    assert r.status_code == 200
    assert r.json()["verified"] is False and r.json()["rent"] == 3600
    assert r.json()["status"] == "pending"

    r = client.get("/api/listings", params={"city": "Hazaribagh"})
    assert r.status_code == 200
    assert listing_id not in [item["id"] for item in r.json()["items"]]

    # Summary counts the pending listing before approval.
    r = client.get("/api/owner/summary", headers=headers)
    assert r.status_code == 200
    assert r.json()["pending_count"] == 1
    assert r.json()["live_count"] == 0
    assert r.json()["verified_owner"] is False

    # Admin approves -> live + verified + visible publicly + owner
    # auto-verified (first live PG).
    admin = _admin_token()
    r = client.post(f"/api/admin/listings/{listing_id}/approve", json={},
                    headers=_auth_headers(admin))
    assert r.status_code == 200
    assert r.json()["status"] == "live" and r.json()["verified"] is True

    r = client.get("/api/owner/me", headers=headers)
    assert r.status_code == 200 and r.json()["verified_owner"] is True

    r = client.get("/api/listings", params={"city": "Hazaribagh"})
    assert r.status_code == 200
    assert listing_id in [item["id"] for item in r.json()["items"]]

    r = client.get("/api/owner/summary", headers=headers)
    assert r.json()["pending_count"] == 0
    assert r.json()["live_count"] == 1
    assert r.json()["verified_owner"] is True

    # Enquiry (public) + review (authed)
    r = client.post("/api/enquiries", json={
        "listing_id": listing_id, "name": "Ravi",
        "whatsapp": "918888888888", "message": "Room available?"})
    assert r.status_code == 201

    r = client.post("/api/reviews", json={
        "listing_id": listing_id, "reviewer_name": "Ravi",
        "rating": 5, "comment": "Good PG"}, headers=headers)
    assert r.status_code == 201

    # Owner sees own enquiry in the owner portal
    r = client.get("/api/owner/enquiries", headers=headers)
    assert r.status_code == 200 and len(r.json()) == 1
    r = client.get("/api/owner/summary", headers=headers)
    assert r.status_code == 200
    assert r.json()["listings_count"] == 1
    assert r.json()["enquiries_count"] == 1

    # Owner PIN set + verify + PIN login
    r = client.post("/api/auth/owner/pin/setup", json={"pin": "1234"},
                    headers=headers)
    assert r.status_code == 200
    r = client.post("/api/auth/owner/pin-login",
                    json={"whatsapp": "919999999999", "pin": "1234"})
    assert r.status_code == 200

    # Admin verifies the listing
    # (The lockout test runs before this one and locks the admin account
    # for 15 min — reset the lock directly; this is test-only setup.
    # If this test runs alone, create the admin first.)
    from backend.database import SessionLocal as _SL
    from backend.models import AdminAccount as _AA
    _db = _SL()
    _admin = _db.query(_AA).first()
    if _admin is None:
        _db.close()
        client.post("/api/auth/admin/setup",
                    json={"admin_id": "superadmin",
                          "password": "AdminPass123"})
        _db = _SL()
        _admin = _db.query(_AA).first()
    _admin.failed_login_attempts = 0
    _admin.locked_until = None
    _db.commit()
    _db.close()
    admin = client.post("/api/auth/admin/login",
                        json={"admin_id": "superadmin",
                              "password": "AdminPass123"})
    assert admin.status_code == 200
    r = client.post(f"/api/admin/listings/{listing_id}/verify", json={},
                    headers=_auth_headers(admin.json()["access_token"]))
    assert r.status_code == 200 and r.json()["verified"] is True

    # Owner deletes own listing
    r = client.delete(f"/api/listings/{listing_id}", headers=headers)
    assert r.status_code == 204


def test_seed_count_matches_file():
    from backend.seed import derive_city, row_to_listing
    import json
    data = json.load(open(os.path.expanduser(
        "~/workspace/stayhazaribagh-seed/seed.json")))
    rows = data["named"] + data["olx"]
    assert len(rows) == 933
    # City derivation is honest: named rows resolve via address,
    # OLX rows without a city token stay None.
    assert derive_city(rows[0]) == "Hazaribagh"
    assert all(row_to_listing(r, r["sheet"]).name for r in rows)


# ---------------------------------------------------------------- new: approval workflow
def test_listing_approve_flow_and_admin_list():
    _, headers = _make_owner("919111111111", "Approve Owner")
    listing = _make_listing(headers, "Approve PG")
    lid = listing["id"]
    assert listing["status"] == "pending"

    admin = _admin_token()
    ah = _auth_headers(admin)
    # Admin list sees the pending listing; public list does not.
    r = client.get("/api/admin/listings", params={"status": "pending"},
                   headers=ah)
    assert r.status_code == 200
    assert lid in [item["id"] for item in r.json()]
    r = client.get("/api/listings")
    assert lid not in [item["id"] for item in r.json()["items"]]

    r = client.post(f"/api/admin/listings/{lid}/approve", json={},
                    headers=ah)
    assert r.status_code == 200
    assert r.json()["status"] == "live"
    assert r.json()["verified"] is True
    assert r.json()["rejection_reason"] is None

    r = client.get("/api/listings")
    assert lid in [item["id"] for item in r.json()["items"]]
    # Owner auto-verified on first live PG.
    r = client.get("/api/owner/me", headers=headers)
    assert r.json()["verified_owner"] is True


def test_listing_reject_flow():
    _, headers = _make_owner("919222222222", "Reject Owner")
    listing = _make_listing(headers, "Reject PG")
    lid = listing["id"]

    admin = _admin_token()
    ah = _auth_headers(admin)
    r = client.post(f"/api/admin/listings/{lid}/reject",
                    json={"reason": "Photos unclear, re-upload karo"},
                    headers=ah)
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    assert r.json()["verified"] is False
    assert r.json()["rejection_reason"] == "Photos unclear, re-upload karo"

    r = client.get("/api/listings")
    assert lid not in [item["id"] for item in r.json()["items"]]
    r = client.get("/api/admin/listings", params={"status": "rejected"},
                   headers=ah)
    assert lid in [item["id"] for item in r.json()]

    # Too-short reason is rejected by validation.
    listing2 = _make_listing(headers, "Reject PG 2")
    r = client.post(f"/api/admin/listings/{listing2['id']}/reject",
                    json={"reason": "x"}, headers=ah)
    assert r.status_code == 422


def test_admin_cannot_change_status_via_patch():
    _, headers = _make_owner("919333333333", "Patch Owner")
    listing = _make_listing(headers, "Patch PG")
    lid = listing["id"]
    admin = _admin_token()
    ah = _auth_headers(admin)
    r = client.patch(f"/api/listings/{lid}",
                     json={"status": "live", "rent": 4000}, headers=ah)
    assert r.status_code == 200
    assert r.json()["status"] == "pending"  # unchanged
    assert r.json()["rent"] == 4000


def test_admin_owners_list_and_verify():
    token, headers = _make_owner("919444444444", "Owners List Owner")
    listing = _make_listing(headers, "Owners List PG")
    admin = _admin_token()
    ah = _auth_headers(admin)
    r = client.get("/api/admin/owners", headers=ah)
    assert r.status_code == 200
    mine = [o for o in r.json() if o["whatsapp"] == "919444444444"]
    assert len(mine) == 1
    assert mine[0]["listings_count"] == 1
    assert mine[0]["verified_owner"] is False
    owner_id = mine[0]["id"]

    r = client.post(f"/api/admin/owners/{owner_id}/verify",
                    json={"verified": True}, headers=ah)
    assert r.status_code == 200
    assert r.json()["verified_owner"] is True
    r = client.get("/api/owner/me", headers=headers)
    assert r.json()["verified_owner"] is True


# ---------------------------------------------------------------- new: verified-owner gate
def test_tenant_gate_then_verify_then_create():
    _, headers = _make_owner("919555555555", "Gate Owner")
    listing = _make_listing(headers, "Gate PG")
    lid = listing["id"]
    tenant_body = {"listing_id": lid, "name": "Ravi Kumar",
                   "whatsapp": "918888888881", "room": "101",
                   "bed": "A", "rent": 3000, "move_in_date": "2026-11-01"}

    # Unverified owner: tenant + rent endpoints are gated (403).
    r = client.post("/api/owner/tenants", json=tenant_body, headers=headers)
    assert r.status_code == 403
    assert "verification pending" in r.json()["detail"].lower()
    r = client.post("/api/owner/rent", json={
        "listing_id": lid, "tenant_name": "Ravi Kumar",
        "month": "2026-11", "amount": 3000}, headers=headers)
    assert r.status_code == 403
    r = client.get("/api/owner/rent", headers=headers)
    assert r.status_code == 403
    # Enquiries/complaints stay ungated.
    r = client.get("/api/owner/enquiries", headers=headers)
    assert r.status_code == 200

    # Admin verifies the owner -> tenant create succeeds.
    admin = _admin_token()
    ah = _auth_headers(admin)
    owners = client.get("/api/admin/owners", headers=ah).json()
    owner_id = [o for o in owners
                if o["whatsapp"] == "919555555555"][0]["id"]
    r = client.post(f"/api/admin/owners/{owner_id}/verify",
                    json={"verified": True}, headers=ah)
    assert r.status_code == 200

    r = client.post("/api/owner/tenants", json=tenant_body, headers=headers)
    assert r.status_code == 201
    tenant_id = r.json()["id"]
    assert r.json()["moved_out"] is False
    assert r.json()["room"] == "101"

    r = client.get("/api/owner/tenants", params={"listing_id": lid},
                   headers=headers)
    assert r.status_code == 200 and len(r.json()) == 1

    r = client.patch(f"/api/owner/tenants/{tenant_id}",
                     json={"moved_out": True,
                           "moved_out_date": "2026-11-20"},
                     headers=headers)
    assert r.status_code == 200 and r.json()["moved_out"] is True
    assert r.json()["moved_out_date"] == "2026-11-20"


def test_tenant_documents_flow():
    _, headers = _make_owner("919666666666", "Docs Owner")
    listing = _make_listing(headers, "Docs PG")
    admin = _admin_token()
    ah = _auth_headers(admin)
    owners = client.get("/api/admin/owners", headers=ah).json()
    owner_id = [o for o in owners
                if o["whatsapp"] == "919666666666"][0]["id"]
    client.post(f"/api/admin/owners/{owner_id}/verify",
                json={"verified": True}, headers=ah)
    r = client.post("/api/owner/tenants", json={
        "listing_id": listing["id"], "name": "Sita",
        "whatsapp": "918888888882"}, headers=headers)
    assert r.status_code == 201
    tenant_id = r.json()["id"]

    r = client.post(f"/api/owner/tenants/{tenant_id}/documents", json={
        "doc_type": "Aadhaar", "doc_number": "1234-5678-9012",
        "agreement_date": "2026-11-01",
        "police_verification": "pending"}, headers=headers)
    assert r.status_code == 201
    doc_id = r.json()["id"]
    assert r.json()["police_verification"] == "pending"

    r = client.get(f"/api/owner/tenants/{tenant_id}/documents",
                   headers=headers)
    assert r.status_code == 200 and len(r.json()) == 1

    r = client.patch(f"/api/owner/documents/{doc_id}",
                     json={"police_verification": "done"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["police_verification"] == "done"


def test_mess_config_roundtrip():
    _, headers = _make_owner("919777777777", "Mess Owner")
    listing = _make_listing(headers, "Mess PG")
    lid = listing["id"]
    admin = _admin_token()
    ah = _auth_headers(admin)
    owners = client.get("/api/admin/owners", headers=ah).json()
    owner_id = [o for o in owners
                if o["whatsapp"] == "919777777777"][0]["id"]
    client.post(f"/api/admin/owners/{owner_id}/verify",
                json={"verified": True}, headers=ah)

    # Default config before anything is set.
    r = client.get(f"/api/owner/listings/{lid}/mess", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"listing_id": lid, "enabled": False,
                        "monthly_fee": 0, "menu": {}}

    r = client.put(f"/api/owner/listings/{lid}/mess", json={
        "enabled": True, "monthly_fee": 2500,
        "menu": {"monday": ["Dal", "Rice"], "tuesday": ["Sabzi", "Roti"]}},
        headers=headers)
    assert r.status_code == 200
    assert r.json()["enabled"] is True
    assert r.json()["monthly_fee"] == 2500
    assert r.json()["menu"]["monday"] == ["Dal", "Rice"]

    r = client.get(f"/api/owner/listings/{lid}/mess", headers=headers)
    assert r.json()["menu"]["tuesday"] == ["Sabzi", "Roti"]

    # Mess payment for a tenant in this PG.
    r = client.post("/api/owner/tenants", json={
        "listing_id": lid, "name": "Mess Tenant",
        "whatsapp": "918888888883"}, headers=headers)
    tenant_id = r.json()["id"]
    r = client.post("/api/owner/mess-payments", json={
        "listing_id": lid, "tenant_id": tenant_id,
        "month": "2026-11", "amount": 2500, "status": "paid"},
        headers=headers)
    assert r.status_code == 201
    assert r.json()["status"] == "paid"
    r = client.get("/api/owner/mess-payments",
                   params={"listing_id": lid, "month": "2026-11"},
                   headers=headers)
    assert r.status_code == 200 and len(r.json()) == 1


def test_rent_record_with_method_upi():
    _, headers = _make_owner("919888888888", "Rent Owner")
    listing = _make_listing(headers, "Rent PG")
    admin = _admin_token()
    ah = _auth_headers(admin)
    owners = client.get("/api/admin/owners", headers=ah).json()
    owner_id = [o for o in owners
                if o["whatsapp"] == "919888888888"][0]["id"]
    client.post(f"/api/admin/owners/{owner_id}/verify",
                json={"verified": True}, headers=ah)

    r = client.post("/api/owner/rent", json={
        "listing_id": listing["id"], "tenant_name": "Ravi Kumar",
        "tenant_whatsapp": "918888888884", "month": "2026-11",
        "amount": 3000, "status": "paid", "method": "upi"},
        headers=headers)
    assert r.status_code == 201
    assert r.json()["method"] == "upi"

    r = client.get("/api/owner/rent", headers=headers)
    assert r.status_code == 200 and len(r.json()) == 1
    assert r.json()[0]["method"] == "upi"

    # Invalid method is rejected.
    r = client.post("/api/owner/rent", json={
        "listing_id": listing["id"], "tenant_name": "Other",
        "month": "2026-12", "amount": 100, "method": "card"},
        headers=headers)
    assert r.status_code == 422
