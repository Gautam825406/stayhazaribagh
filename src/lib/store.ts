// StayHazaribagh — local-first data store (localStorage). No server, no paid service.
// Data starts EMPTY by design: zero fake listings. Owners add real PGs;
// Super Admin verifies them. Nothing here is scraped or invented.

export type Role = 'tenant' | 'owner'
export type City = 'Hazaribagh' | 'Ranchi'
export type Gender = 'Boys' | 'Girls' | 'Co-ed'

/** Owner registration approval: a new owner starts 'pending' and only goes
    live once Super Admin approves. Tenants are always 'approved'. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'hold'

export interface User {
  id: string
  name: string
  phone: string // 10-digit WhatsApp number
  email?: string
  role: Role
  salt: string
  passwordHash: string
  pinHash?: string // owner portal PIN (hashed)
  /** True once Super Admin verifies the owner (or their first PG is approved). */
  verifiedOwner?: boolean
  /** Owner approval (see ApprovalStatus). Missing = grandfathered 'approved'
      — existing saved users are never locked out by this field. */
  approvalStatus?: ApprovalStatus
  /** Admin's note/reason for 'hold' / 'rejected' — shown to the owner. */
  approvalNote?: string
  createdAt: string
}

/** Effective approval status: missing field = 'approved' (grandfathered). */
export function approvalStatusOf(u: User | null | undefined): ApprovalStatus {
  return u?.approvalStatus ?? 'approved'
}

export interface Property {
  id: string
  ownerId: string
  ownerPhone: string
  name: string
  city: City
  locality: string
  address: string
  gender: Gender
  rent: number // monthly rent per bed, INR
  deposit: number
  foodIncluded: boolean
  foodNote?: string
  totalBeds: number
  availableBeds: number
  sharing: string // e.g. "Single / Double / Triple"
  facilities: string[]
  rules: string
  mapsQuery?: string // optional free-text for Google Maps
  verified: boolean
  createdAt: string
  /** Approval workflow: owner-added PGs start 'pending' (hidden from public
      search until Super Admin approves them → 'live'). Seeded PGs have no
      status (undefined) and keep showing as before. */
  status?: 'pending' | 'live' | 'rejected'
  rejectionReason?: string
  // Optional extras carried from the backend (src/lib/api.ts) — never invented locally.
  rating?: number // backend average rating, when the API supplies one
  reviewCount?: number // backend review count, when the API supplies one
  source?: string
  mapsUrl?: string
}

export interface Review {
  id: string
  propertyId: string
  author: string
  stars: number
  comment: string
  createdAt: string
}

export interface Enquiry {
  id: string
  code: string // private 6-char code given to the tenant
  propertyId: string
  propertyName: string
  tenantName: string
  tenantPhone: string
  message: string
  status: 'New' | 'Contacted' | 'Visit Scheduled' | 'Booked' | 'Closed'
  createdAt: string
}

export interface TenantRecord {
  id: string
  propertyId: string
  name: string
  phone: string
  room: string
  bed: string
  rent: number
  rentPaid: boolean
  dueAmount: number
  kycDone: boolean
  joinedAt: string
  /** Move-in date (YYYY-MM-DD) from the add-tenant form. */
  moveInDate?: string
  movedOut?: boolean
  movedOutDate?: string
}

/** Rent payment record — one row per tenant per month. `method` is the
    payment mode (UPI / cash); history is shown in Rent & Dues. */
export interface RentRecord {
  id: string
  propertyId: string
  tenantId?: string
  tenantName: string
  month: string // YYYY-MM
  amount: number
  method?: 'upi' | 'cash'
  status: 'paid' | 'pending'
  createdAt: string
}

export type PoliceVerification = 'pending' | 'done' | 'not_required'

/** Per-tenant document / KYC record (ID proof + agreement + police verification). */
export interface TenantDocument {
  id: string
  tenantId: string
  propertyId: string
  docType: string // Aadhaar / PAN / Voter ID / Passport / Driving Licence
  docNumber?: string
  agreementDate?: string // YYYY-MM-DD
  policeVerification: PoliceVerification
  createdAt: string
}

/** Per-PG mess configuration: on/off, monthly fee and a Mon–Sun menu. */
export interface MessConfig {
  enabled: boolean
  monthlyFee: number
  menu: Record<string, string[]> // e.g. { Monday: ['Dal', 'Chawal', ...] }
}

/** One mess-fee collection row per tenant per month. */
export interface MessPayment {
  id: string
  propertyId: string
  tenantId: string
  month: string // YYYY-MM
  amount: number
  status: 'paid' | 'pending'
  createdAt: string
}

export interface Complaint {
  id: string
  propertyId: string
  propertyName: string
  tenantName: string
  tenantPhone: string
  text: string
  status: 'Open' | 'In Progress' | 'Resolved'
  createdAt: string
}

export interface AdminAccount {
  id: string
  username: string // Super Admin ID, chosen once by the site owner
  salt: string
  passwordHash: string
  createdAt: string
}

export interface AdminSession {
  adminId: string
  expiresAt: number
}

export interface Settings {
  adminPasscodeHash: string | null
  adminSalt: string | null
}

export interface Session {
  userId: string
  expiresAt: number
}

export interface DB {
  users: User[]
  properties: Property[]
  reviews: Review[]
  enquiries: Enquiry[]
  tenants: TenantRecord[]
  rentPayments: RentRecord[]
  documents: TenantDocument[]
  messConfigs: Record<string, MessConfig>
  messPayments: MessPayment[]
  complaints: Complaint[]
  settings: Settings
  session: Session | null
  adminAccount: AdminAccount | null
  adminSession: AdminSession | null
  failedLogins: Record<string, { count: number; lockUntil: number }>
}

export const LOCALITIES: Record<City, string[]> = {
  Hazaribagh: ['Matwari', 'Korrah', 'Babugaon', 'Near VBU', 'Jhanda Chowk', 'Hirabag', 'Ompuri'],
  Ranchi: ['Lalpur', 'Bariatu', 'Kanke Road', 'Harmu', 'Doranda', 'Ashok Nagar', 'Argora'],
}

export const ALL_LOCALITIES = [...LOCALITIES.Hazaribagh, ...LOCALITIES.Ranchi]

const KEY = 'stayhazaribagh_v1'

export function emptyDB(): DB {
  return {
    users: [],
    properties: [],
    reviews: [],
    enquiries: [],
    tenants: [],
    rentPayments: [],
    documents: [],
    messConfigs: {},
    messPayments: [],
    complaints: [],
    settings: { adminPasscodeHash: null, adminSalt: null },
    session: null,
    adminAccount: null,
    adminSession: null,
    failedLogins: {},
  }
}

export function loadDB(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyDB()
    const parsed = JSON.parse(raw) as Partial<DB>
    // Merge over emptyDB() so old saved data (without the newer arrays)
    // still loads instead of crashing on undefined.
    const db: DB = {
      ...emptyDB(),
      ...parsed,
      settings: { ...emptyDB().settings, ...(parsed.settings || {}) },
      users: (parsed.users ?? []).map((u) => ({
        // Grandfathered: saved users without an approvalStatus were created
        // before owner approval existed — they stay 'approved' (never lock
        // anyone out). Tenants are always 'approved'.
        ...u,
        approvalStatus: u.approvalStatus ?? 'approved',
      })),
      tenants: (parsed.tenants ?? []).map((t) => ({ ...t })),
      rentPayments: parsed.rentPayments ?? [],
      documents: parsed.documents ?? [],
      messConfigs: parsed.messConfigs ?? {},
      messPayments: parsed.messPayments ?? [],
    }
    return db
  } catch {
    return emptyDB()
  }
}

export function saveDB(db: DB) {
  localStorage.setItem(KEY, JSON.stringify(db))
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

export function enquiryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export function randomSalt(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** SHA-256(salt + password) via Web Crypto. Never stores plain-text passwords. */
export async function hashSecret(secret: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + '::' + secret)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

/** Google Maps URLs built from the listing's own name/address — no scraping, no API key. */
export function mapsSearchUrl(p: Pick<Property, 'name' | 'address' | 'locality' | 'city'>): string {
  const q = encodeURIComponent([p.name, p.address, p.locality, p.city, 'Jharkhand'].filter(Boolean).join(', '))
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}
export function mapsDirectionsUrl(p: Pick<Property, 'name' | 'address' | 'locality' | 'city'>): string {
  const q = encodeURIComponent([p.name, p.address, p.locality, p.city, 'Jharkhand'].filter(Boolean).join(', '))
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}

export function avgRating(reviews: Review[]): { avg: number; count: number } {
  if (!reviews.length) return { avg: 0, count: 0 }
  const avg = reviews.reduce((s, r) => s + r.stars, 0) / reviews.length
  return { avg: Math.round(avg * 10) / 10, count: reviews.length }
}

export function occupancy(p: Property): number {
  if (!p.totalBeds) return 0
  return Math.round(((p.totalBeds - p.availableBeds) / p.totalBeds) * 100)
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  const days = Math.floor(diff / 86400000)
  if (days <= 0) return 'aaj'
  if (days === 1) return 'kal'
  if (days < 30) return `${days} din pehle`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
