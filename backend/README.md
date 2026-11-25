# StayHazaribagh API — FastAPI backend

PG / hostel / flat finder and owner management for Hazaribagh and Ranchi.
FastAPI + SQLAlchemy. Postgres on Render (`DATABASE_URL`), local SQLite
fallback (`backend/stayhazaribagh.db`) so tests and dev run with no DB server.

## Layout

| File | What it does |
|---|---|
| `main.py` | App entrypoint, CORS, router wiring, `GET /api/health` |
| `config.py` | Env settings (`SECRET_KEY`, `DATABASE_URL`, `CORS_ORIGINS`) |
| `database.py` | Engine/session; Postgres or SQLite fallback |
| `models.py` | `users`, `admin_account`, `owner_pins`, `listings`, `enquiries`, `reviews`, `complaints`, `rent_records` |
| `schemas.py` | Pydantic validation (no hashes ever leave the API) |
| `auth.py` | bcrypt hashing, PyJWT (30-day tokens), 5-wrong = 15-min lockout |
| `deps.py` | `get_current_user` / `get_current_owner` / `get_current_admin` |
| `routers/auth.py` | Register/login, admin setup+login, owner PIN setup/verify/PIN-login |
| `routers/listings.py` | Listings CRUD, enquiries, reviews, complaints, admin verify |
| `routers/owner.py` | Owner portal: own listings / enquiries / tenants / complaints / rent / summary |
| `routers/admin.py` | Super Admin overview, all enquiries, all complaints |
| `seed.py` | Seeds all 933 rows from `stayhazaribagh-seed/seed.json` |
| `test_api.py` | Pytest smoke tests (throwaway SQLite DB in `/tmp`) |

## Run locally

```bash
cd ~/workspace/pg-khoj
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/pip install pytest        # tests only
cp backend/.env.example backend/.env        # optional; SQLite works without it
backend/.venv/bin/python -m backend.seed    # inserts 933 listings (idempotent)
backend/.venv/bin/uvicorn backend.main:app --reload --port 8000
```

Docs: http://127.0.0.1:8000/docs

## Tests

```bash
cd ~/workspace/pg-khoj
backend/.venv/bin/python -m pytest backend/test_api.py -q
# 5 passed (health, admin setup-once-only, admin lockout, full
# owner/tenant/admin flow incl. PIN login + verify, seed-shape check)
```

## Seed data — what was done and what was NOT invented

Source: `~/workspace/stayhazaribagh-seed/seed.json` — 933 rows
(242 `named` + 691 `olx`). The `listings` table holds **every** seed field:
`external_id` (seed `id`, e.g. `gm-1`/`olx-1`), `sheet`, `name`, `area`,
`type`, `for_whom` (seed `for`), `address`, `contact`, `rating`,
`reviews_count` (seed `reviews`), `rent`, `bhk`, `size`, `posted`,
`source`, `source_url`, `maps` — plus `city`, `verified` (default
`false`), `owner_id` (NULL until an owner claims a listing).

- Nulls stay null; contact strings are verbatim (`"Via OLX ad"`,
  `"Not published — in LeadSetu app"`, …); rent is stored as scraped,
  including odd values (₹2, ₹900,000).
- **Derived, not in the seed:** `city` is matched from the area/address
  text against Jharkhand/Bihar city names (Ranchi 302, Hazaribagh 276,
  Gaya 27, …). 270 rows name no recognisable city and keep `city = NULL`
  — we do not guess. `source` for OLX rows is `"OLX"` (their sheet is
  `OLX_Listings`; OLX rows carry no `source` key).
- **Idempotency:** dedup is by `external_id`, NOT by (name, area,
  source) — the seed itself contains 18 (name, area, source)
  collisions, so that key would silently drop rows. Re-running the
  seeder inserts 0 and reports 933 skipped.

## Endpoints

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/health` | — | `{"status":"ok",…}` |
| `POST /api/auth/register` | — | `{name, whatsapp, password, role: tenant\|owner}` → JWT |
| `POST /api/auth/login` | — | WhatsApp + password → JWT (30 days) |
| `POST /api/auth/admin/setup` | — | **Once only** — 409 if an admin already exists. No preset ID/password. |
| `POST /api/auth/admin/login` | — | Admin ID + password → `super_admin` JWT |
| `POST /api/auth/owner/pin/setup` | owner | Set/change 4–6 digit PIN (stored bcrypt-hashed) |
| `POST /api/auth/owner/pin/verify` | owner | Verify PIN |
| `POST /api/auth/owner/pin-login` | — | WhatsApp + PIN → owner JWT (Owner Portal) |
| `GET /api/listings` | — | Filters: `city`, `area`, `type`, `for`/`gender`, `search` (name/area), `verified`, `min_rent`, `max_rent`; `limit` (1–100, default 20), `offset` |
| `GET /api/listings/{id}` | — | |
| `POST /api/listings` | owner | New listings start `verified=false` |
| `PATCH /api/listings/{id}` | owner (own) / admin | |
| `DELETE /api/listings/{id}` | owner (own) / admin | Deletes its enquiries/reviews/complaints/rent too |
| `POST /api/admin/listings/{id}/verify` | admin | Body `{"verified": true}` (default true) |
| `GET /api/admin/overview` | admin | Counts: users, listings, verified/unverified, enquiries, open complaints |
| `GET /api/admin/enquiries`, `GET /api/admin/complaints` | admin | |
| `POST /api/enquiries` | — | Book a visit / enquiry for a listing |
| `POST /api/reviews` | user | `{listing_id, reviewer_name, rating 1–5, comment}` |
| `GET /api/listings/{id}/reviews` | — | |
| `POST /api/complaints` | user | Tenant complaint |
| `GET /api/owner/listings` | owner | Own PGs only |
| `GET /api/owner/enquiries` | owner | Own PGs only |
| `PATCH /api/owner/enquiries/{id}` | owner | Status: new/contacted/booked/tenant/closed |
| `GET /api/owner/tenants` | owner | Enquiries marked booked/tenant |
| `GET /api/owner/complaints` | owner | Own PGs only |
| `PATCH /api/owner/complaints/{id}` | owner | Status: open/in_progress/resolved |
| `GET /api/owner/rent`, `POST /api/owner/rent` | owner | Rent/dues records (`{listing_id, tenant_name, month: YYYY-MM, amount, status}`) |
| `PATCH /api/owner/rent/{id}` | owner | Status: pending/paid/overdue (paid sets `paid_at`) |
| `GET /api/owner/summary` | owner | Counts + pending/paid rent totals for own PGs |

## Security

- `SECRET_KEY` / `DATABASE_URL` come from the environment only
  (`.env.example` has placeholders; never commit `.env`).
- Passwords and owner PINs are bcrypt-hashed; no hash is ever returned.
- Login / PIN lockout: **5 wrong attempts = 15-minute lock** (HTTP 423),
  counters + lock timestamps stored in the DB so locks survive restarts.
- CORS is locked to `CORS_ORIGINS` (default
  `https://stayhazaribagh.vercel.app,http://localhost:5173`).
- Pydantic validation on every input; 401/403/404/409 used properly.

## Deploy to Render

`../render.yaml` (at the repo root) defines the web service + a free
Postgres database. Steps:

1. Push this repo to GitHub (do **not** commit `.env`,
   `stayhazaribagh.db`, or `.venv/` — see `.gitignore`).
2. In Render: **New → Blueprint**, point it at the repo. It reads
   `render.yaml` and creates `stayhazaribagh-api` (web) +
   `stayhazaribagh-db` (Postgres, free).
3. Render auto-sets from the blueprint — verify these env vars exist
   on the web service:

   | Variable | Value / source |
   |---|---|
   | `SECRET_KEY` | auto-generated by Render (`generateValue: true`) |
   | `DATABASE_URL` | from the `stayhazaribagh-db` database (`fromDatabase`) |
   | `CORS_ORIGINS` | `https://stayhazaribagh.vercel.app` |

4. After the first deploy, seed the production DB **once** (Render Shell
   on the web service):
   ```bash
   python -m backend.seed
   ```
   It reads `~/workspace/stayhazaribagh-seed/seed.json` locally; for
   Render, set `SEED_PATH` to wherever the seed file is, or upload
   `seed.json` and run `SEED_PATH=/path/to/seed.json python -m backend.seed`.
   NOTE: the seed file is **not** in this repo — copy it to the Render
   service (or a private gist / storage) before seeding prod.
5. Create the Super Admin account (once, via curl — pick the ID and a
   strong password; nothing is preset):
   ```bash
   curl -X POST https://<your-render-url>/api/auth/admin/setup \
     -H 'Content-Type: application/json' \
     -d '{"admin_id": "YOUR_ADMIN_ID", "password": "YOUR_STRONG_PASSWORD"}'
   ```
   A second call returns 409 — the account can only be created once.
6. Verify: `curl https://<your-render-url>/api/health` →
   `{"status":"ok","service":"stayhazaribagh-api"}`, and
   `GET /api/listings?limit=1` should show `"total":933`.
