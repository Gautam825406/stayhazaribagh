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
- **Login & Signup** — free accounts (name, WhatsApp number, optional email,
  password, role: tenant *"PG Dhoondhna Hai"* or owner *"Main PG Owner
  Hoon"*). Session lasts 30 days. Passwords are stored only as a salted
  SHA-256 hash (Web Crypto, per-user salt) — never plain text. 5 wrong
  passwords = 15-minute lock.
- **Owner Portal (Makan Malik)** — WhatsApp number + 4-digit Portal PIN or
  account login, scoped to the owner's own PGs only: beds +/-, tenants,
  rent & dues, enquiries, complaints, occupancy stats.
- **Super Admin Panel** — dark dashboard: platform stats, Hazaribagh vs
  Ranchi split, listing verify/delete, owners directory, owner PIN
  set/reset. Gated by a staff passcode you set on first run (hashed).
- **Tenant My Bookings** — enquiry status tracker, via login or via the
  private 6-letter enquiry code given at enquiry time.
- **List PG FREE** — 4-step owner listing form. Tells the owner the listing
  starts as Not Verified.
- **SEO for Hazaribagh** — title/meta description, locality guide sections,
  rent FAQs, popular-searches footer, semantic headings, Hinglish copy.
- **Mobile 100% responsive, Android-app feel** — fixed bottom tab bar on
  mobile only (Home, Bookings, raised List PG button, Owner, Admin), slim
  app bar, full-width city toggle, 44px touch targets, no horizontal
  overflow, safe-area padding. Animations respect
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

1. **Super Admin passcode** — open the site → **Admin** tab → set your
   staff passcode the first time (you will be prompted). Keep it private.
   Only this passcode opens the Super Admin panel.
2. **First owner listing** — ask one real PG owner in Hazaribagh to tap
   **List PG FREE** and fill the 4 steps, or list it for them from their
   WhatsApp number. It goes live immediately as **Not Verified**.
3. **Verify it** — Admin tab → unlock with your passcode → Listings →
   **Verify Karo**. The teal Verified badge appears everywhere.
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
