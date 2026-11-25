# StayHazaribagh — PG & Hostel Finder — Hazaribagh • Ranchi, Jharkhand

PG & hostel finder + management for Hazaribagh & Ranchi.

Free-first, no paid services. Tenant search + owner (Makan Malik) management +
Super Admin, all in one clean Vite + React + TypeScript app. The frontend
works standalone with `localStorage`, and connects to the production
FastAPI + Postgres backend in `backend/` when `VITE_API_URL` is set —
that is how listings, logins and verifications are shared across all
users and devices. See **Backend (production)** below.

## What it does

- **Tenant search** — Hazaribagh / Ranchi / Both toggle, locality filters
  (Matwari, Korrah, Babugaon, Near VBU, Lalpur, Bariatu, Kanke Road, Harmu,
  Doranda, Ashok Nagar), Boys / Girls / Co-ed, rent slider, live available
  beds, PG detail view.
- **Google Maps** — Directions button + "Google Maps par dekho" link built
  from the listing's own name/address/locality/city (standard
  `google.com/maps` search/dir URLs). No scraping, no API key.
- **Verified system** — every new listing starts amber **Not Verified**.
  Super Admin verifies it → teal **Verified** badge, shown on cards, detail,
  owner and admin dashboards, with explanation text.
- **Reviews** — detail view has average stars, a review list with dates, and
  a form (name + stars + comment). Only reviews written on this site.
- **Login & Signup hub** — one polished hub with three clear entrances:
  **User** (tenant), **PG Admin** (owner) and **Super Admin**. Tenant/owner
  signup/login with name, WhatsApp number, optional email, password (salted
  SHA-256 hash, 30-day session, 5 wrong passwords = 15-minute lock). Each
  entrance lands on its own dashboard.
- **Super Admin account (real ID + password)** — the site owner creates a
  Super Admin ID + password **once** from the Super Admin panel. There is
  **no public admin signup** and **no preset ID/password**, so nobody else
  can claim it. After that, the admin logs in from any browser with that
  ID + password (30-day session, header admin chip, proper logout). The
  account is stored hashed in localStorage. The old staff passcode stays
  as a fallback unlock path only if it was already set.
- **Owner Portal (Makan Malik)** — WhatsApp number + 4-digit Portal PIN or
  account login, scoped to the owner's own PGs only: beds +/-, tenants,
  rent & dues, enquiries, complaints, occupancy stats. Bed steppers are
  36px for thumbs; dashboard rows wrap cleanly on ~320px phones.
- **Tenant My Bookings** — summary tiles (total enquiries, booked,
  in-progress, open complaints) plus the enquiry status tracker, via login
  or via the private 6-letter enquiry code given at enquiry time.
- **List PG FREE** — 4-step owner listing form. Tells the owner the listing
  starts as Not Verified.
- **SEO for Hazaribagh** — title/meta description, locality guide sections,
  rent FAQs, popular-searches footer, semantic headings, Hinglish copy.
- **Header (clean)** — no desktop pill nav. Header shows only the
  StayHazaribagh brand, List PG FREE button and Login / Sign Up (or the
  account / admin chip). Home, My Bookings and Owner stay reachable
  via footer links, the mobile bottom tab bar, and the logo (= Home);
  Super Admin is desktop-only (footer link on desktop).
- **Mobile 100% responsive, Android-app feel — User (tenant) + Makan Malik
  (owner) only, NOT Super Admin** — fixed bottom tab bar on
  mobile only (Home, Bookings, raised List PG button, Owner — no Admin tab),
  sticky header pinned on top, slim app bar, full-width city toggle, 44px touch
  targets, no horizontal overflow, safe-area padding. The login hub on
  phones shows only the User and PG Admin entrances and the footer
  Super Admin link is desktop-only; the Super Admin console stays
  desktop-first. Logout is a labelled red pill in the header (never clipped
  off-screen), plus a full-width Logout row in the Owner Portal and a
  Logout button in My Bookings. Form controls are
  16px on phones (stops iOS auto-zoom on focus); the PG detail sheet locks
  body scroll, closes on backdrop tap or Escape, and has a grab handle.
  Login/Sign Up buttons always fit inside the viewport. Animations respect
  `prefers-reduced-motion`.

## Data — 933 real listings, all Unverified

The app ships with **933 listings from the user's own spreadsheet**
(`backend/seed_data.json`: 242 named Google Maps places + 691 OLX ads),
all **Unverified** (amber Not Verified badge). Nothing is invented:
where the file says "Not listed", the app shows "Not listed"; OLX
contacts stay "Via OLX ad". A Super Admin verifies each listing
(Verify → teal Verified badge) after checking it on the ground.
Search matches PG/hostel name **and** area name; a **Near Me** button
shows approx. distance in km and sorts nearest first.

No PG names, phone numbers, rents, photos or reviews are invented or
scraped beyond this user-supplied file. The empty state guides owners
to List PG. The first real owner listing appears as soon as a real
owner lists it, and only becomes Verified after Super Admin checks it.

## Backend (production) — FastAPI + Postgres on Render

`backend/` is a production-level FastAPI backend (see
`backend/README.md` for the full API reference):

- **Stack:** FastAPI, SQLAlchemy, Postgres (`DATABASE_URL`, SQLite
  fallback for local dev), JWT auth (30-day sessions), bcrypt password
  hashing, Pydantic validation.
- **Tables:** users (tenant/owner), admin_account (single Super Admin),
  owner_pins (hashed, 5 wrong = 15-min lock), listings, enquiries,
  reviews, complaints, rent_records.
- **Auth:** `POST /api/auth/register`, `/api/auth/login`,
  `/api/auth/admin/setup` (once only — refuses with 409 if an admin
  already exists; **no preset ID/password**),
  `/api/auth/admin/login`, plus Owner Portal PIN login.
- **Listings:** `GET /api/listings` (filters: city, area, type, for,
  search by name/area, verified/unverified, pagination),
  `GET /api/listings/{id}`, `POST/PATCH/DELETE /api/listings/{id}`,
  `POST /api/admin/listings/{id}/verify` (admin only).
- **More:** enquiries, reviews, complaints, owner-scoped
  `GET /api/owner/*`, `GET /api/admin/overview`, `GET /api/health`.
- **Security:** secrets only via env vars (never committed), CORS
  allow-listed via `CORS_ORIGINS` (default
  `https://stayhazaribagh.vercel.app`), login lockout stored in DB,
  passwords/PINs never returned.
- **Seed:** `python -m backend.seed` loads `backend/seed_data.json`
  (933 rows, idempotent by seed `id` — re-running inserts 0).

### Run the backend locally

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill SECRET_KEY (dev only)
.venv/bin/python -m backend.seed   # 933 unverified listings
.venv/bin/uvicorn backend.main:app --reload --port 8001
# curl http://127.0.0.1:8001/api/health
# curl "http://127.0.0.1:8001/api/listings?search=Korrah"
```

### Deploy the backend on Render (free tier)

`render.yaml` in the repo root defines the service + free Postgres DB,
so Render can deploy it from the repo directly:

1. Render dashboard → **New → Blueprint** → select the
   `Gautam825406/stayhazaribagh` repo (or **New → Web Service**,
   same repo, build `pip install -r backend/requirements.txt`,
   start `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`).
2. Render creates the web service `stayhazaribagh-api` **and** the
   free Postgres DB `stayhazaribagh-db` from `render.yaml`.
3. Env vars (set automatically by the Blueprint, verify them):
   `SECRET_KEY` (auto-generated), `DATABASE_URL` (from the DB),
   `CORS_ORIGINS=https://stayhazaribagh.vercel.app`.
4. Wait for the first deploy to go Live, note the service URL, e.g.
   `https://stayhazaribagh-api.onrender.com`.
5. **Seed the production DB** (once): Render dashboard → the service
   → **Shell** → `python -m backend.seed` (uses the bundled
   `backend/seed_data.json`). Expect `inserted: 933`.
6. **Create the Super Admin once:** `POST /api/auth/admin/setup`
   with your chosen `admin_id` + `password` (curl, or the site's
   Super Admin setup screen once the frontend points at the API).
   There is no preset ID/password — you set it.
7. **Point the frontend at the backend:** in Vercel → project
   `stayhazaribagh` → Settings → Environment Variables →
   `VITE_API_URL=https://stayhazaribagh-api.onrender.com` →
   redeploy. Without this variable the site keeps working in
   localStorage (offline) mode.
8. Render free tier sleeps after ~15 min idle — the first request
   after that takes ~30–60s to wake up. That is normal on free.

### Frontend ↔ backend wiring

`src/lib/api.ts` talks to the API when `VITE_API_URL` is set, and
falls back to `localStorage` when it is not set or the API is
unreachable (with an "Offline mode" note). Auth, enquiries, reviews,
verify/edit/delete go through the API when configured. `.env.example`
at the repo root holds the `VITE_API_URL` placeholder.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm install
npm run build
```

Output goes to `dist/`.

## Deploy free on Vercel

1. Push this folder to GitHub (see below).
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Vite**. Build command: `npm run build`.
   Output directory: `dist`.
4. Environment variable: `VITE_API_URL` = your Render backend URL
   (e.g. `https://stayhazaribagh-api.onrender.com`). If you skip this,
   the site runs in localStorage (offline) mode until you add it.
5. Deploy. Every push to `main` redeploys automatically.

The backend is deployed separately on Render (see **Backend** above);
the frontend only needs its URL via `VITE_API_URL`.

## Push to GitHub

```bash
cd stayhazaribagh
git init
git add .
git commit -m "StayHazaribagh v1 — Hazaribagh & Ranchi PG finder + owner & admin panels"
git branch -M main
git remote add origin https://github.com/<your-username>/stayhazaribagh.git
git push -u origin main
```

## First launch checklist

1. **Super Admin ID + password** — open the site → **Admin** tab → create
   your Super Admin ID + password once (min. 4-char ID, min. 6-char
   password). Keep it private. After that, log in from any browser via
   Login → Super Admin with that ID + password. (If a staff passcode was
   already set, it still works as a fallback unlock.)
2. **First owner listing** — ask one real PG owner in Hazaribagh to tap
   **List PG FREE** and fill the 4 steps, or list it for them from their
   WhatsApp number. It goes live immediately as **Not Verified**.
3. **Verify it** — Admin tab → log in with your Super Admin ID +
   password → Listings → **Verify Karo**. The teal Verified badge appears
   everywhere.
4. **Owner PIN** — in the Owner Portal the owner sets a 4-digit Portal PIN;
   Super Admin can also set/reset any owner's PIN from the Admin panel.
5. **Tenant test** — search, open a PG, send an enquiry, note the 6-letter
   code, check it in **My Bookings** (no login needed, code + number).
6. Share the Vercel link in Hazaribagh student/owner WhatsApp groups.

## Tech

- Vite 5 + React 18 + TypeScript (strict)
- `lucide-react` icons, no other UI framework
- Backend: FastAPI + SQLAlchemy + Postgres (Render free tier),
  JWT + bcrypt auth — see `backend/README.md`
- Data: API when `VITE_API_URL` is set, else `localStorage` key
  `stayhazaribagh_v1` (per browser/device, offline fallback)
