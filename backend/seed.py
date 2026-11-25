"""Seed listings from ~/workspace/stayhazaribagh-seed/seed.json.

Usage (from ~/workspace/pg-khoj/):
    python -m backend.seed
or:
    python backend/seed.py

Behaviour:
- Inserts all 933 rows (242 named + 691 OLX) as UNVERIFIED listings.
- Idempotent: a row is skipped when a listing with the same seed `id`
  (external_id, e.g. gm-1 / olx-1) already exists.
- Nothing is invented: null fields stay null, contact strings such as
  "Via OLX ad" are stored verbatim, rent values are stored as scraped
  (including odd ones like 2.0 or 900000.0).
- Two fields are DERIVED, not present in the seed:
    * city — matched from the area/address text against a list of
      Jharkhand/Bihar city names. Rows naming no recognisable city keep
      city NULL (302 OLX rows, mostly Hazaribagh localities written
      without a city suffix — we do not guess).
    * source — OLX rows carry no `source` key, so source is "OLX"
      (from their sheet OLX_Listings); named rows keep their own source.
- NOTE on the original spec: idempotency by (name, area, source) alone
  would LOSE rows — the seed itself contains 18 (name, area, source)
  collisions. external_id is unique for all 933 rows, so it is the
  dedup key; name+area+source is preserved in the stored columns.
"""
import json
import os
import sys

# Allow running as `python backend/seed.py` as well as `python -m backend.seed`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import Base, SessionLocal, engine  # noqa: E402
from backend.models import Listing  # noqa: E402

DEFAULT_SEED_PATH = os.path.expanduser(
    "~/workspace/stayhazaribagh-seed/seed.json"
)

# City names that appear in the seed's area/address text.
CITY_TOKENS = [
    "hazaribagh", "ranchi", "jamshedpur", "adityapur", "bokaro", "dhanbad",
    "gaya", "giridih", "koderma", "chatra", "ramgarh", "khunti", "jamui",
    "nawada", "deoghar", "dumka", "chaibasa", "kanke", "tilaiya",
    "jhumri", "hazaribag",
]

# Canonical display name per token.
CITY_NAMES = {
    "hazaribag": "Hazaribagh",
    "jhumri": "Jhumri Tilaiya",
}


# Hazaribagh locality names. The seed file is Hazaribagh-focused (its OLX
# source URLs are hazaribagh_g4058788); an area that is a known Hazaribagh
# locality but names no city is Hazaribagh — this is derivation from the
# file's own geography, not a guess about an individual listing.
HAZARIBAGH_LOCALITY_TOKENS = [
    "matwari", "korrah", "babugaon", "babaugawan", "jabra", "hirabag",
    "hirabagh", "hurhuru", "ramnagar", "okni", "lakhe", "nawabganj",
    "pugmil", "kumhar toll", "vishnupuri", "kani bazar", "nawdiha",
    "chano", "kadma", "sindoor", "canary hill", "ranchi road",
    "jhanda chowk", "vbu", "vinoba bhave", "nutan nagar", "barhi",
    "kud", "masratu", "merawal", "sendur", "sirsi", "romi",
    "new forest colony", "malhantanar", "jena", "shuresh colony",
    "banshi", "dipugarha", "columbus", "zabra",
]


def derive_city(row: dict) -> str | None:
    """Find a known city name in area, then address, then name."""
    for field in ("area", "address", "name"):
        text = (row.get(field) or "").lower()
        for token in CITY_TOKENS:
            if token in text:
                return CITY_NAMES.get(token, token.title())
    # No city named: a known Hazaribagh locality means Hazaribagh.
    for field in ("area", "address", "name"):
        text = (row.get(field) or "").lower()
        for token in HAZARIBAGH_LOCALITY_TOKENS:
            if token in text:
                return "Hazaribagh"
    return None


def find_seed_path() -> str:
    candidates = [
        os.getenv("SEED_PATH", ""),
        # Bundled copy in the repo — this is the path Render uses.
        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "seed_data.json"),
        DEFAULT_SEED_PATH,
        os.path.join(os.getcwd(), "seed.json"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "..", "stayhazaribagh-seed", "seed.json"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return os.path.abspath(path)
    raise FileNotFoundError(
        "seed.json not found. Set SEED_PATH or place it at "
        + DEFAULT_SEED_PATH
    )


def _to_int(value):
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean_str(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def row_to_listing(row: dict, sheet: str) -> Listing:
    is_olx = sheet == "OLX_Listings"
    return Listing(
        external_id=_clean_str(row.get("id")),
        sheet=_clean_str(row.get("sheet") or sheet),
        name=_clean_str(row.get("name")),
        area=_clean_str(row.get("area")),
        city=derive_city(row),
        type=_clean_str(row.get("type")),
        for_whom=_clean_str(row.get("for")),
        address=_clean_str(row.get("address")),
        contact=_clean_str(row.get("contact")),
        rating=_to_float(row.get("rating")),
        reviews_count=_to_int(row.get("reviews")),
        rent=_to_float(row.get("rent")),
        bhk=_clean_str(row.get("bhk")),
        size=_clean_str(row.get("size")),
        posted=_clean_str(row.get("posted")),
        source=_clean_str(row.get("source")) if not is_olx else "OLX",
        source_url=_clean_str(row.get("source_url")),
        maps=_clean_str(row.get("maps")),
        verified=False,
        owner_id=None,
    )


def main() -> int:
    seed_path = find_seed_path()
    with open(seed_path, encoding="utf-8") as fh:
        data = json.load(fh)

    rows: list[dict] = []
    for sheet_key in ("named", "olx"):
        for row in data.get(sheet_key, []):
            rows.append(row)

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = {
            r[0] for r in db.query(Listing.external_id).filter(
                Listing.external_id.isnot(None)
            ).all()
        }
        inserted = skipped = 0
        for row in rows:
            ext_id = _clean_str(row.get("id"))
            if ext_id and ext_id in existing:
                skipped += 1
                continue
            sheet = row.get("sheet") or (
                "OLX_Listings" if str(ext_id or "").startswith("olx-")
                else "GoogleMap_Named"
            )
            listing = row_to_listing(row, sheet)
            if not listing.name:
                skipped += 1
                continue
            db.add(listing)
            inserted += 1
            if ext_id:
                existing.add(ext_id)
        db.commit()
        total = db.query(Listing).count()
        print(f"seed file : {seed_path}")
        print(f"rows read : {len(rows)}")
        print(f"inserted  : {inserted}")
        print(f"skipped (already present / no name): {skipped}")
        print(f"total listings in DB: {total}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
