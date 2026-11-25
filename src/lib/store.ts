// StayHazaribagh — local-first data store (localStorage). No server, no paid service.
// Data starts EMPTY by design: zero fake listings. Owners add real PGs;
// Super Admin verifies them. Nothing here is scraped or invented.

export type Role = 'tenant' | 'owner'
export type City = 'Hazaribagh' | 'Ranchi'
export type Gender = 'Boys' | 'Girls' | 'Co-ed'

export interface User {
  id: string
  name: string
  phone: string // 10-digit WhatsApp number
  email?: string
  role: Role
  salt: string
  passwordHash: string
  pinHash?: string // owner portal PIN (hashed)
  createdAt: string
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
    return { ...emptyDB(), ...parsed, settings: { ...emptyDB().settings, ...(parsed.settings || {}) } }
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
