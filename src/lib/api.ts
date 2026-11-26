// StayHazaribagh — FastAPI backend client.
// Talks to the backend described by the API contract when VITE_API_URL is set;
// the site keeps working from localStorage when it is not set or the call fails.
//
// Backend base URL comes ONLY from import.meta.env.VITE_API_URL — no URL is
// hardcoded here. Default (empty) = offline / localStorage-only mode.

import type { City, Gender, Property } from './store'

export const TOKEN_KEY = 'stayhazaribagh_token'
export const ADMIN_TOKEN_KEY = 'stayhazaribagh_admin_token'
const TOKEN_EXP_KEY = 'stayhazaribagh_token_expires_at'
const ADMIN_TOKEN_EXP_KEY = 'stayhazaribagh_admin_token_expires_at'
const USER_KEY = 'stayhazaribagh_user'

/** 30-day sessions, same as the localStorage sessions. */
const SESSION_MS = 30 * 86400000

export function getBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined
  return (raw ?? '').trim().replace(/\/+$/, '')
}

/** True when a backend URL is configured. False = offline / fallback mode. */
export function apiConfigured(): boolean {
  return getBaseUrl().length > 0
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || `Server error (${err.status})`
  if (err instanceof Error) return err.message
  return 'Kuch galat ho gaya — dobara try karo'
}

/* ---------------- tokens + stored user (localStorage) ---------------- */

function readToken(key: string, expKey: string): string | null {
  try {
    const exp = Number(localStorage.getItem(expKey) || 0)
    if (exp && exp < Date.now()) {
      localStorage.removeItem(key)
      localStorage.removeItem(expKey)
      return null
    }
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeToken(key: string, expKey: string, token: string): void {
  try {
    localStorage.setItem(key, token)
    localStorage.setItem(expKey, String(Date.now() + SESSION_MS))
  } catch {
    /* storage unavailable — calls will just go out without a token */
  }
}

function dropToken(key: string, expKey: string): void {
  try {
    localStorage.removeItem(key)
    localStorage.removeItem(expKey)
  } catch {
    /* ignore */
  }
}

export function getToken(): string | null {
  return readToken(TOKEN_KEY, TOKEN_EXP_KEY)
}
export function setToken(token: string): void {
  writeToken(TOKEN_KEY, TOKEN_EXP_KEY, token)
}
export function clearToken(): void {
  dropToken(TOKEN_KEY, TOKEN_EXP_KEY)
  clearStoredUser()
}

export function getAdminToken(): string | null {
  return readToken(ADMIN_TOKEN_KEY, ADMIN_TOKEN_EXP_KEY)
}
export function setAdminToken(token: string): void {
  writeToken(ADMIN_TOKEN_KEY, ADMIN_TOKEN_EXP_KEY, token)
}
export function clearAdminToken(): void {
  dropToken(ADMIN_TOKEN_KEY, ADMIN_TOKEN_EXP_KEY)
}

export interface ApiUser {
  id?: string | number
  name: string
  phone: string
  role: 'tenant' | 'owner'
  email?: string
}

export function setStoredUser(user: ApiUser): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
}

export function getStoredUser(): ApiUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ApiUser>
    if (!parsed.phone || !parsed.name) return null
    return {
      id: parsed.id,
      name: parsed.name,
      phone: parsed.phone,
      role: parsed.role === 'owner' ? 'owner' : 'tenant',
      email: parsed.email,
    }
  } catch {
    return null
  }
}

export function clearStoredUser(): void {
  try {
    localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

/* ---------------- low-level fetch wrapper ---------------- */

type TokenKind = 'user' | 'admin' | 'none'

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: TokenKind } = {},
): Promise<T> {
  const base = getBaseUrl()
  if (!base) throw new ApiError(0, 'Backend URL set nahi hai (VITE_API_URL)')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const kind = opts.token ?? 'none'
  const token = kind === 'admin' ? getAdminToken() : kind === 'user' ? getToken() : null
  if (token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Backend se connect nahi ho paya — internet ya server check karo')
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const obj = (data ?? {}) as Record<string, unknown>
    const detail = obj.detail ?? obj.message ?? obj.error
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail) && detail.length > 0
          ? String((detail[0] as Record<string, unknown>).msg ?? detail[0])
          : `Request fail ho gayi (${res.status})`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/* ---------------- listings ---------------- */

/**
 * Listing as the backend returns it. The contract's seed fields use several
 * spellings (name/title, area/locality, for/type, contact/phone, snake_case
 * and camelCase), so every field is optional here and the mapper below
 * normalises them. Unknown extra fields are ignored.
 */
export interface ApiListing {
  id: string | number
  title?: string
  name?: string
  area?: string
  locality?: string
  city?: string
  type?: string
  for?: string
  bhk?: string
  address?: string
  contact?: string
  phone?: string
  rent?: number | string
  deposit?: number | string
  rating?: number
  reviews_count?: number
  review_count?: number
  reviews?: number
  source?: string
  maps_url?: string
  mapsUrl?: string
  verified?: boolean
  total_beds?: number
  totalBeds?: number
  available_beds?: number
  availableBeds?: number
  beds?: number
  sharing?: string
  facilities?: string[]
  food_included?: boolean
  foodIncluded?: boolean
  food_note?: string
  foodNote?: string
  rules?: string
  owner_id?: string | number
  ownerId?: string | number
  owner_phone?: string
  created_at?: string
  createdAt?: string
  [key: string]: unknown
}

export interface ListingsResponse {
  items: ApiListing[]
  total: number
}

export interface ListingQuery {
  search?: string
  city?: string
  area?: string
  type?: string
  for?: string
  verified?: boolean
  limit?: number
  offset?: number
}

/** Ranchi areas named in the contract — anything else defaults to Hazaribagh. */
export const RANCHI_AREAS = [
  'Lalpur',
  'Bariatu',
  'Harmu',
  'Kokar',
  'Morabadi',
  'Kadru',
  'Argora',
  'Doranda',
  'Kanke Road',
  'Ashok Nagar',
]

export function deriveCity(area: string | undefined, hint: string | undefined): City {
  const h = (hint ?? '').trim().toLowerCase()
  if (h === 'ranchi') return 'Ranchi'
  if (h === 'hazaribagh') return 'Hazaribagh'
  const a = (area ?? '').trim().toLowerCase()
  if (RANCHI_AREAS.some((r) => r.toLowerCase() === a)) return 'Ranchi'
  return 'Hazaribagh'
}

function toNumber(v: number | string | undefined, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : (v ?? NaN)
  return Number.isFinite(n) ? n : fallback
}

function parseGender(raw: ApiListing): Gender {
  const hay = `${raw.for ?? ''} ${raw.type ?? ''} ${String(raw.gender ?? '')}`.toLowerCase()
  if (hay.includes('girl') || hay.includes('female') || hay.includes('ladki')) return 'Girls'
  if (hay.includes('boy') || hay.includes('male') || hay.includes('ladka')) return 'Boys'
  return 'Co-ed'
}

/** Normalise a backend listing into the app's local Property shape. */
export function apiListingToProperty(raw: ApiListing): Property {
  const area = raw.area ?? raw.locality ?? ''
  const city = deriveCity(area, raw.city)
  const totalBeds = toNumber(raw.total_beds ?? raw.totalBeds ?? raw.beds, 1)
  const availableBeds = toNumber(
    raw.available_beds ?? raw.availableBeds,
    Math.max(0, totalBeds),
  )
  const bhk =
    typeof raw.bhk === 'string' && raw.bhk
      ? raw.bhk
      : /bhk/i.test(raw.type ?? '') || /bhk/i.test(raw.for ?? '')
        ? (raw.type ?? raw.for ?? '')
        : ''
  return {
    id: String(raw.id),
    ownerId: raw.owner_id !== undefined ? String(raw.owner_id) : 'api-owner',
    ownerPhone: String(raw.contact ?? raw.phone ?? raw.owner_phone ?? '').replace(/\D/g, '').slice(-10),
    name: (raw.title ?? raw.name ?? 'PG').toString(),
    city,
    locality: area,
    address: (raw.address ?? '').toString(),
    gender: parseGender(raw),
    rent: toNumber(raw.rent, 0),
    deposit: toNumber(raw.deposit, 0),
    foodIncluded: Boolean(
      raw.food_included ?? raw.foodIncluded ?? (raw.facilities ?? []).some((f) => /mess|khana/i.test(f)),
    ),
    foodNote: (raw.food_note ?? raw.foodNote ?? undefined) as string | undefined,
    totalBeds: Math.max(1, totalBeds),
    availableBeds: Math.min(Math.max(0, availableBeds), Math.max(1, totalBeds)),
    sharing: (raw.sharing ?? bhk ?? 'Double').toString(),
    facilities: Array.isArray(raw.facilities) ? raw.facilities.map(String) : [],
    rules: (raw.rules ?? '').toString(),
    mapsQuery: (raw.maps_url ?? raw.mapsUrl ?? undefined) as string | undefined,
    verified: Boolean(raw.verified),
    createdAt: (raw.created_at ?? raw.createdAt ?? new Date().toISOString()).toString(),
    rating: typeof raw.rating === 'number' ? raw.rating : undefined,
    reviewCount:
      typeof raw.reviews_count === 'number'
        ? raw.reviews_count
        : typeof raw.review_count === 'number'
          ? raw.review_count
          : typeof raw.reviews === 'number'
            ? raw.reviews
            : undefined,
    source: raw.source ? String(raw.source) : undefined,
    mapsUrl: (raw.maps_url ?? raw.mapsUrl ?? undefined) as string | undefined,
  }
}

/**
 * Map a local Property to the backend's create/update body. A superset of
 * spellings is sent (title+name, area+locality, snake_case counts) because
 * the contract does not pin the exact POST body; extra fields are ignored
 * by a standard FastAPI/Pydantic model.
 */
export function propertyToApiListing(p: Partial<Property>): Record<string, unknown> {
  return {
    title: p.name,
    name: p.name,
    area: p.locality,
    locality: p.locality,
    city: p.city,
    type: 'PG',
    for: p.gender,
    for_whom: p.gender,
    address: p.address,
    contact: p.ownerPhone,
    phone: p.ownerPhone,
    rent: p.rent,
    deposit: p.deposit ?? 0,
    total_beds: p.totalBeds,
    available_beds: p.availableBeds,
    sharing: p.sharing,
    facilities: p.facilities ?? [],
    food_included: p.foodIncluded ?? false,
    food_note: p.foodNote,
    rules: p.rules,
    maps_url: p.mapsUrl ?? p.mapsQuery,
    maps: p.mapsUrl ?? p.mapsQuery,
    verified: p.verified ?? false,
  }
}

export async function health(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/health', { token: 'none' })
}

export async function listListings(query: ListingQuery = {}): Promise<ListingsResponse> {
  const qs = toQuery({
    search: query.search,
    city: query.city,
    area: query.area,
    type: query.type,
    for: query.for,
    verified: query.verified,
    limit: query.limit,
    offset: query.offset,
  })
  const data = await request<unknown>(`/api/listings${qs}`, { token: 'none' })
  if (Array.isArray(data)) return { items: data as ApiListing[], total: data.length }
  const obj = (data ?? {}) as { items?: ApiListing[]; total?: number }
  return { items: obj.items ?? [], total: obj.total ?? (obj.items ?? []).length }
}

/**
 * Fetch ALL listings, paging through the backend's limit (max 100/page).
 * The app used to ask for limit=500 in one call, which the backend rejects
 * with 422 — that is why the live site stayed in offline mode. Each page is
 * retried once on a network/5xx error (Render free tier can 500 on a cold
 * start), then the error propagates and the app falls back to local data.
 */
export async function listAllListings(
  query: Omit<ListingQuery, 'limit' | 'offset'> = {},
): Promise<ListingsResponse> {
  const PAGE = 100
  const items: ApiListing[] = []
  let total = 0
  let offset = 0
  for (;;) {
    let page: ListingsResponse | null = null
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        page = await listListings({ ...query, limit: PAGE, offset })
        break
      } catch (err) {
        lastErr = err
        const retryable =
          err instanceof ApiError && (err.status === 0 || err.status >= 500)
        if (!retryable || attempt === 1) throw err
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    if (!page) throw lastErr instanceof Error ? lastErr : new Error('Listings load nahi hui')
    total = page.total
    items.push(...page.items)
    offset += page.items.length
    if (page.items.length === 0 || items.length >= total) break
  }
  return { items, total }
}

export async function getListing(id: string | number): Promise<ApiListing> {
  return request<ApiListing>(`/api/listings/${encodeURIComponent(String(id))}`, { token: 'none' })
}

export async function createListing(body: Record<string, unknown>): Promise<ApiListing> {
  return request<ApiListing>('/api/listings', { method: 'POST', body, token: 'user' })
}

export async function updateListing(
  id: string | number,
  body: Record<string, unknown>,
): Promise<ApiListing> {
  return request<ApiListing>(`/api/listings/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    body,
    token: 'user',
  })
}

export async function deleteListing(id: string | number): Promise<void> {
  await request<unknown>(`/api/listings/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    token: 'user',
  })
}

/**
 * Super Admin verify. The contract defines POST /api/admin/listings/{id}/verify
 * with no body specified, so {verified} is sent — a backend that only flips
 * the flag to verified can ignore it, and it also lets the UI unverify.
 */
export async function verifyListing(
  id: string | number,
  verified = true,
): Promise<ApiListing | Record<string, unknown>> {
  return request<ApiListing>(`/api/admin/listings/${encodeURIComponent(String(id))}/verify`, {
    method: 'POST',
    body: { verified },
    token: 'admin',
  })
}

/* ---------------- auth ---------------- */

export interface AuthResponse {
  access_token?: string
  token?: string
  user?: Partial<ApiUser> & { [key: string]: unknown }
  [key: string]: unknown
}

/**
 * Normalise the many shapes a login/register response can take into
 * {token, user}. Falls back to the details the caller already knows
 * (phone/name/role from the form) when the server omits the user object.
 */
export function normalizeAuthResponse(
  data: AuthResponse,
  fallback: { phone: string; name?: string; role: 'tenant' | 'owner' },
): { token: string; user: ApiUser | null } {
  const token = data.access_token ?? data.token ?? ''
  const u = data.user
  if (!u) {
    return {
      token,
      user: { name: fallback.name ?? fallback.phone, phone: fallback.phone, role: fallback.role },
    }
  }
  // Backend user objects carry `whatsapp`, not `phone` (UserResponse schema).
  const phone = String(u.phone ?? (u as Record<string, unknown>).whatsapp ?? fallback.phone)
  const role = u.role === 'owner' ? 'owner' : 'tenant'
  return {
    token,
    user: {
      id: u.id,
      name: String(u.name ?? fallback.name ?? phone),
      phone,
      role,
      email: u.email ? String(u.email) : undefined,
    },
  }
}

export async function register(input: {
  name: string
  phone: string
  password: string
  role: 'tenant' | 'owner'
}): Promise<AuthResponse> {
  // Backend RegisterRequest requires `whatsapp`; `phone` is kept too for
  // backward compatibility (Pydantic ignores extra fields).
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: { ...input, whatsapp: input.phone },
    token: 'none',
  })
}

export async function login(input: { phone: string; password: string }): Promise<AuthResponse> {
  // Backend LoginRequest requires `whatsapp` — sending only `phone` 422s.
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { ...input, whatsapp: input.phone },
    token: 'none',
  })
}

export async function adminSetup(input: { admin_id: string; password: string }): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/admin/setup', { method: 'POST', body: input, token: 'none' })
}

export async function adminLogin(input: { admin_id: string; password: string }): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/admin/login', { method: 'POST', body: input, token: 'none' })
}

/* ---------------- enquiries + reviews ---------------- */

export interface ApiEnquiryResponse {
  id?: string | number
  code?: string
  [key: string]: unknown
}

export async function createEnquiry(input: {
  listing_id: string
  name: string
  phone: string
  message: string
}): Promise<ApiEnquiryResponse> {
  // Backend EnquiryCreate requires `whatsapp` — sending only `phone` 422s.
  return request<ApiEnquiryResponse>('/api/enquiries', {
    method: 'POST',
    body: { ...input, whatsapp: input.phone },
    token: 'none',
  })
}

export async function createReview(input: {
  listing_id: string
  name: string
  stars: number
  comment: string
}): Promise<Record<string, unknown>> {
  // Backend ReviewCreate requires `reviewer_name` and `rating` — the
  // frontend's `name`/`stars` spellings are kept too for compatibility.
  return request<Record<string, unknown>>('/api/reviews', {
    method: 'POST',
    body: { ...input, reviewer_name: input.name, rating: input.stars },
    token: 'none',
  })
}

/* ---------------- owner ---------------- */

/**
 * GET /api/owner/* — the contract does not pin these paths, so the two
 * wrappers below try the natural paths and return [] on 404 (the app then
 * keeps using its local enquiries/tenants data). Use ownerGet() for any
 * other owner path the backend adds later.
 */
export async function ownerGet<T>(path: string): Promise<T> {
  return request<T>(path.startsWith('/api/') ? path : `/api/owner/${path.replace(/^\//, '')}`, {
    token: 'user',
  })
}

export async function getOwnerListings(): Promise<ApiListing[]> {
  try {
    const data = await ownerGet<unknown>('/api/owner/listings')
    if (Array.isArray(data)) return data as ApiListing[]
    const obj = (data ?? {}) as { items?: ApiListing[] }
    return obj.items ?? []
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}

export async function getOwnerEnquiries(): Promise<unknown[]> {
  try {
    const data = await ownerGet<unknown>('/api/owner/enquiries')
    if (Array.isArray(data)) return data as unknown[]
    const obj = (data ?? {}) as { items?: unknown[] }
    return obj.items ?? []
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return []
    throw err
  }
}
