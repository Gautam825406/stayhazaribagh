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

    r = client.get(f"/api/listings/{listing_id}")
    assert r.status_code == 200

    r = client.patch(f"/api/listings/{listing_id}",
                     json={"rent": 3500}, headers=headers)
    assert r.status_code == 200 and r.json()["rent"] == 3500

    r = client.get("/api/listings", params={"city": "Hazaribagh"})
    assert r.status_code == 200
    assert r.json()["total"] >= 1

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
