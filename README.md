# StayHazaribagh — PG & Hostel Finder — Hazaribagh • Ranchi, Jharkhand

PG & hostel finder + management for Hazaribagh & Ranchi.

Free-first, no paid services. Tenant search + owner (Makan Malik) management +
Super Admin, all in one clean Vite + React + TypeScript app. Data is stored
locally in the browser (`localStorage`) — this is the GitHub-ready standalone
version, built fresh from the PRD.

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

## Data rule — zero fake listings

The app starts with **ZERO listings**. No PG names, phone numbers, rents,
photos or reviews are invented or scraped. The empty state guides owners to
List PG. The first real listing appears as soon as a real owner lists it,
and only becomes Verified after Super Admin checks it.

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
   Output directory: `dist`. No environment variables needed.
4. Deploy. Every push to `main` redeploys automatically.

No backend, database or paid service is required — everything runs
client-side with `localStorage`.

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
- No backend, no database, no API keys, no paid services
- Data: `localStorage` key `stayhazaribagh_v1` (per browser/device)
