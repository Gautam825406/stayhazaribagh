import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, BedDouble, BookOpen, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Crown, Heart, Home,
  KeyRound, LayoutDashboard, LogOut, MapPin, Menu, MessageSquare, Navigation, Phone, Plus, Search,
  Settings, ShieldAlert, ShieldCheck, Star, UserRound, Users, UtensilsCrossed, Wallet, X,
} from 'lucide-react'
import {
  ALL_LOCALITIES, LOCALITIES, avgRating, enquiryCode, hashSecret, inr, loadDB,
  mapsDirectionsUrl, mapsSearchUrl, occupancy, randomSalt, saveDB, timeAgo, uid,
  type City, type DB, type Enquiry, type Gender, type Property, type Role, type User,
} from './lib/store'
import {
  ApiError, apiConfigured, apiErrorMessage, apiListingToProperty, adminLogin,
  adminSetup, clearAdminToken, clearToken, createEnquiry, createListing, createReview,
  deleteListing as apiDeleteListing, getStoredUser, getToken, listAllListings,
  normalizeAuthResponse, propertyToApiListing, register as apiRegister, login as apiLogin,
  setAdminToken, setStoredUser, setToken, updateListing as apiUpdateListing,
  verifyListing as apiVerifyListing,
} from './lib/api'
import { approxDistanceKm, CITY_CENTRES, type LatLng } from './lib/geo'
import DashboardSidebar, { type SidebarSection } from './components/DashboardSidebar'
import './styles.css'

/** Results pagination: 5 listings per page — page 1 is the 5 nearest PGs. */
const PAGE_SIZE = 5
/** Saved / favourite PGs, persisted in localStorage. */
const SAVED_KEY = 'stayhazaribagh_saved_v1'

type View = 'home' | 'bookings' | 'owner' | 'admin'
type CityFilter = 'Both' | City
type VerifiedTab = 'All' | 'Verified' | 'Unverified'
type ApiStatus = 'local' | 'live' | 'offline'
type OwnerSection = 'dashboard' | 'PGs' | 'Enquiries' | 'Tenants' | 'Rent & Dues' | 'Complaints' | 'reviews' | 'profile'
type AdminSection = 'dashboard' | 'all' | 'verified' | 'unverified' | 'owners' | 'users' | 'enquiries' | 'reviews' | 'complaints' | 'settings'
type TenantSection = 'bookings' | 'saved' | 'profile'

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(to); return }
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900)
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <>{n.toLocaleString('en-IN')}{suffix}</>
}

const FACILITIES = ['Wi-Fi', 'Mess / Khana', 'RO Paani', 'Geyser', 'CCTV', 'Warden', 'Study Table', 'Laundry', 'Parking', 'Power Backup']

export default function App() {
  const [db, setDb] = useState<DB>(() => loadDB())
  const [view, setView] = useState<View>('home')
  const [city, setCity] = useState<CityFilter>('Both')
  const [locality, setLocality] = useState('All')
  const [gender, setGender] = useState<'All' | Gender>('All')
  const [maxRent, setMaxRent] = useState(8000)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Property | null>(null)
  const [authOpen, setAuthOpen] = useState<null | { mode: 'login' | 'signup'; portal: 'user' | 'owner' | 'admin' }>(null)
  const [listOpen, setListOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [bookingCode, setBookingCode] = useState('')
  const [bookingPhone, setBookingPhone] = useState('')

  // --- Backend (FastAPI) wiring: listings come from the API when
  // VITE_API_URL is set; apiListings stays null in offline/fallback mode,
  // and the site then reads exactly the same localStorage data as before.
  const [apiListings, setApiListings] = useState<Property[] | null>(null)
  const [apiLoading, setApiLoading] = useState(false)
  const [apiFailed, setApiFailed] = useState(false)
  const [verifiedTab, setVerifiedTab] = useState<VerifiedTab>('All')
  const [userLoc, setUserLoc] = useState<LatLng | null>(null)
  const [nearestFirst, setNearestFirst] = useState(false)
  const [page, setPage] = useState(1)
  /** Dashboard left-sidebar sections (per role) + mobile drawer + collapse. */
  const [ownerSection, setOwnerSection] = useState<OwnerSection>('dashboard')
  const [adminSection, setAdminSection] = useState<AdminSection>('dashboard')
  const [tenantSection, setTenantSection] = useState<TenantSection>('bookings')
  // True only right after a fresh password login/signup as owner — the portal
  // then opens straight away without asking for the Portal PIN again. A
  // session restored from localStorage (page reload) still needs the PIN.
  const [ownerPinUnlocked, setOwnerPinUnlocked] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  /** Saved / favourite PGs — heart on a PG card, listed in the tenant dashboard. */
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as string[] } catch { return [] }
  })
  useEffect(() => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds)) } catch { /* storage full/blocked */ } }, [savedIds])
  function toggleSave(id: string) {
    setSavedIds((prev) => {
      const on = prev.includes(id)
      showToast(on ? 'Saved PG se hataya gaya.' : 'PG save ho gaya — My Bookings > Saved PGs me dekho.')
      return on ? prev.filter((x) => x !== id) : [...prev, id]
    })
  }

  const apiStatus: ApiStatus = !apiConfigured() ? 'local' : apiListings ? 'live' : apiFailed ? 'offline' : 'local'
  const apiIds = useMemo(() => new Set((apiListings ?? []).map((p) => p.id)), [apiListings])
  /** Listings actually shown: API data when loaded, else localStorage data. */
  const displayProperties: Property[] = apiListings ?? db.properties
  /** db with its properties swapped for the displayed ones (reviews/enquiries stay local). */
  const viewDb: DB = useMemo(
    () => (apiListings ? { ...db, properties: apiListings } : db),
    [db, apiListings],
  )

  async function refreshListings(): Promise<void> {
    if (!apiConfigured()) return
    setApiLoading(true)
    try {
      const res = await listAllListings({
        verified: verifiedTab === 'All' ? undefined : verifiedTab === 'Verified',
      })
      setApiListings(res.items.map(apiListingToProperty))
      setApiFailed(false)
    } catch {
      // Render free tier sleeps when idle — the first call can fail while it
      // wakes up. Retry once after a short wait before giving up to local data.
      try {
        await new Promise((r) => setTimeout(r, 5000))
        const res = await listAllListings({
          verified: verifiedTab === 'All' ? undefined : verifiedTab === 'Verified',
        })
        setApiListings(res.items.map(apiListingToProperty))
        setApiFailed(false)
      } catch {
        // Backend unreachable / bad response — keep working from localStorage.
        setApiListings(null)
        setApiFailed(true)
        showToast('Backend se connect nahi ho paya — device par save hua data dikh raha hai')
      }
    } finally {
      setApiLoading(false)
    }
  }

  useEffect(() => { saveDB(db) }, [db])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) } }, [toast])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [view])

  // API mode: if a token + stored user exist but the local 30-day session
  // expired (or was cleared), restore the local session for the same user
  // so the header / portals keep working. Only restores users that were
  // already mirrored locally at login time — never invents an account.
  useEffect(() => {
    if (!apiConfigured() || !getToken()) return
    const stored = getStoredUser()
    if (!stored) return
    setDb((prev) => {
      const next = structuredClone(prev)
      const existing = next.users.find((u) => u.phone === stored.phone)
      if (existing && (!next.session || next.session.expiresAt < Date.now())) {
        next.session = { userId: existing.id, expiresAt: Date.now() + 30 * 86400000 }
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // API mode: (re)load listings from the backend — on mount and whenever
  // the Verified tab changes (the tab is also passed as ?verified=).
  useEffect(() => {
    if (apiConfigured()) void refreshListings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedTab])

  const adminSessionUser = useMemo(() => {
    if (!db.adminSession || db.adminSession.expiresAt < Date.now() || !db.adminAccount) return null
    return db.adminAccount.id === db.adminSession.adminId ? db.adminAccount : null
  }, [db])

  const sessionUser: User | null = useMemo(() => {
    if (!db.session || db.session.expiresAt < Date.now()) return null
    return db.users.find((u) => u.id === db.session!.userId) || null
  }, [db])

  const showToast = (m: string) => setToast(m)
  const update = (fn: (d: DB) => DB) => setDb((prev) => fn(structuredClone(prev)))

  const totalBeds = displayProperties.reduce((s, p) => s + p.availableBeds, 0)
  const totalProps = displayProperties.length
  /** While the backend is still waking up (Render free tier sleeps), never
      show a misleading "0" — show "…" until real data (or a real 0) arrives. */
  const bedsLoading = apiConfigured() && apiListings === null && !apiFailed
  const verifiedCount = displayProperties.filter((p) => p.verified).length

  const filtered = useMemo(() => {
    const list = displayProperties.filter((p) => {
      if (verifiedTab !== 'All' && p.verified !== (verifiedTab === 'Verified')) return false
      if (city !== 'Both' && p.city !== city) return false
      if (locality !== 'All' && p.locality !== locality) return false
      if (gender !== 'All' && p.gender !== gender) return false
      if (p.rent > maxRent) return false
      if (query && !(p.name + p.locality + p.address).toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    // "Nearby first" ordering (approx, locality centre se — see src/lib/geo.ts):
    // Near Me on + location mili ho to user ki location se, warna Hazaribagh
    // centre (23.992, 85.361) se — taaki page 1 hamesha 5 sabse nazdeek PG ho.
    // Naam tie-breaker rakhta hai taaki order har render par stable rahe.
    const ref = nearestFirst && userLoc ? userLoc : CITY_CENTRES.Hazaribagh
    return [...list].sort((a, b) => {
      const d = approxDistanceKm(ref, a.locality, a.city) - approxDistanceKm(ref, b.locality, b.city)
      return d !== 0 ? d : a.name.localeCompare(b.name)
    })
  }, [displayProperties, verifiedTab, city, locality, gender, maxRent, query, nearestFirst, userLoc])

  // Pagination: search / filter / tab / sort badalte hi wapas page 1 par.
  useEffect(() => { setPage(1) }, [verifiedTab, city, locality, gender, maxRent, query, nearestFirst, userLoc])

  /** Total pages for the current filtered list (min 1, taaki "Page 1 of 1" dikhe). */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  /** Clamp: list chhoti ho jaye (jaise API reload ke baad) to page khaali na rahe. */
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function goToPage(n: number) {
    setPage(Math.min(Math.max(1, n), totalPages))
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const localitiesForCity = city === 'Both' ? ALL_LOCALITIES : LOCALITIES[city]

  // View change always starts at the top — so a login from deep down the
  // home page lands on the dashboard itself, not scrolled halfway down it.
  function go(v: View) { setView(v); setSelected(null); setSidebarOpen(false); window.scrollTo(0, 0) }

  async function handleAuth(mode: 'login' | 'signup', data: { name: string; phone: string; email: string; password: string; role: Role }) {
    const phone = data.phone.replace(/\D/g, '').slice(-10)
    if (phone.length !== 10) return showToast('Sahi 10-digit WhatsApp number daalein')
    if (data.password.length < 4) return showToast('Password kam se kam 4 character ka ho')
    const lock = db.failedLogins[phone]
    if (lock && lock.lockUntil > Date.now()) return showToast('5 galat koshish — 15 minute ke liye lock hai. Thodi der baad try karein.')
    // API mode: register/login against the backend first. A 4xx reply is a
    // real answer (galat password / account pehle se hai) — show it. Only a
    // network/server failure falls through to the local behaviour below.
    if (apiConfigured()) {
      try {
        const res = mode === 'signup'
          ? await apiRegister({ name: data.name.trim(), phone, password: data.password, role: data.role })
          : await apiLogin({ phone, password: data.password })
        const auth = normalizeAuthResponse(res, { phone, name: data.name.trim(), role: data.role })
        if (!auth.token) throw new Error('Server se token nahi mila — dobara try karo')
        setToken(auth.token)
        const apiUser = auth.user ?? { name: data.name.trim() || phone, phone, role: data.role }
        setStoredUser(apiUser)
        // Mirror the account locally (salted hash, 30-day session) so the
        // existing session logic and the offline fallback keep working.
        const salt = randomSalt()
        const passwordHash = await hashSecret(data.password, salt)
        update((d) => {
          const existing = d.users.find((u) => u.phone === phone)
          if (existing) {
            existing.name = apiUser.name
            existing.role = apiUser.role
            existing.salt = salt
            existing.passwordHash = passwordHash
            d.session = { userId: existing.id, expiresAt: Date.now() + 30 * 86400000 }
          } else {
            const user: User = {
              id: apiUser.id !== undefined ? String(apiUser.id) : uid(),
              name: apiUser.name, phone, email: data.email.trim() || undefined,
              role: apiUser.role, salt, passwordHash, createdAt: new Date().toISOString(),
            }
            d.users.push(user)
            d.session = { userId: user.id, expiresAt: Date.now() + 30 * 86400000 }
          }
          d.failedLogins[phone] = { count: 0, lockUntil: 0 }
          return d
        })
        setAuthOpen(null)
        showToast(mode === 'signup' ? `Welcome, ${apiUser.name}! Account ban gaya — 30 din tak login rahega.` : `Welcome back, ${apiUser.name}!`)
        // Login/signup ke baad seedha role ka dashboard (left-sidebar layout) kholo.
        if (apiUser.role === 'owner') { setOwnerSection('dashboard'); setOwnerPinUnlocked(true); go('owner') }
        else { setTenantSection('bookings'); go('bookings') }
        return
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) return showToast(err.message)
        // Network / 5xx — fall through to local behaviour below.
      }
    }
    if (mode === 'signup') {
      if (!data.name.trim()) return showToast('Apna naam daalein')
      if (db.users.some((u) => u.phone === phone)) return showToast('Is number se account pehle se hai — Login karein')
      const salt = randomSalt()
      const passwordHash = await hashSecret(data.password, salt)
      const user: User = { id: uid(), name: data.name.trim(), phone, email: data.email.trim() || undefined, role: data.role, salt, passwordHash, createdAt: new Date().toISOString() }
      update((d) => { d.users.push(user); d.session = { userId: user.id, expiresAt: Date.now() + 30 * 86400000 }; return d })
      setAuthOpen(null)
      showToast(`Welcome, ${user.name}! Account ban gaya — 30 din tak login rahega.`)
      if (user.role === 'owner') { setOwnerSection('dashboard'); setOwnerPinUnlocked(true); go('owner') }
      else { setTenantSection('bookings'); go('bookings') }
    } else {
      const user = db.users.find((u) => u.phone === phone)
      const hash = user ? await hashSecret(data.password, user.salt) : ''
      if (!user || hash !== user.passwordHash) {
        update((d) => {
          const cur = d.failedLogins[phone] || { count: 0, lockUntil: 0 }
          cur.count += 1
          if (cur.count >= 5) { cur.lockUntil = Date.now() + 15 * 60000; cur.count = 0 }
          d.failedLogins[phone] = cur
          return d
        })
        return showToast('Galat number ya password. 5 galat koshish par 15 minute lock lagta hai.')
      }
      update((d) => { d.failedLogins[phone] = { count: 0, lockUntil: 0 }; d.session = { userId: user.id, expiresAt: Date.now() + 30 * 86400000 }; return d })
      setAuthOpen(null)
      showToast(`Welcome back, ${user.name}!`)
      if (user.role === 'owner') { setOwnerSection('dashboard'); setOwnerPinUnlocked(true); go('owner') }
      else { setTenantSection('bookings'); go('bookings') }
    }
  }

  async function handleAdminLogin(username: string, password: string) {
    const uname = username.trim()
    if (apiConfigured()) {
      try {
        const res = await adminLogin({ admin_id: uname, password })
        const token = res.access_token ?? res.token ?? ''
        if (!token) throw new Error('Server se token nahi mila — dobara try karo')
        setAdminToken(token)
        // Mirror the admin account locally (salted hash, 30-day session).
        const salt = randomSalt()
        const passwordHash = await hashSecret(password, salt)
        update((d) => {
          const key = 'admin:' + uname.toLowerCase()
          if (d.adminAccount) {
            d.adminAccount.username = uname.toLowerCase()
            d.adminAccount.salt = salt
            d.adminAccount.passwordHash = passwordHash
            d.adminSession = { adminId: d.adminAccount.id, expiresAt: Date.now() + 30 * 86400000 }
          } else {
            const acc = { id: uid(), username: uname.toLowerCase(), salt, passwordHash, createdAt: new Date().toISOString() }
            d.adminAccount = acc
            d.adminSession = { adminId: acc.id, expiresAt: Date.now() + 30 * 86400000 }
          }
          d.failedLogins[key] = { count: 0, lockUntil: 0 }
          return d
        })
        setAuthOpen(null)
        setAdminUnlocked(true)
        showToast(`Welcome back, Admin ${uname}!`)
        setAdminSection('dashboard')
        go('admin')
        return
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          return showToast('Galat Super Admin ID ya password.')
        }
        // Network / 5xx — fall through to local behaviour below.
      }
    }
    const acc = db.adminAccount
    if (!acc) return showToast('Super Admin account abhi set nahi hai — pehle Admin panel se banao')
    const lockKey = 'admin:' + uname.toLowerCase()
    const lock = db.failedLogins[lockKey]
    if (lock && lock.lockUntil > Date.now()) return showToast('5 galat koshish — 15 minute ke liye lock hai.')
    const h = await hashSecret(password, acc.salt)
    if (acc.username.toLowerCase() !== uname.toLowerCase() || h !== acc.passwordHash) {
      update((d) => {
        const cur = d.failedLogins[lockKey] || { count: 0, lockUntil: 0 }
        cur.count += 1
        if (cur.count >= 5) { cur.lockUntil = Date.now() + 15 * 60000; cur.count = 0 }
        d.failedLogins[lockKey] = cur
        return d
      })
      return showToast('Galat Super Admin ID ya password.')
    }
    update((d) => { d.failedLogins[lockKey] = { count: 0, lockUntil: 0 }; d.adminSession = { adminId: acc.id, expiresAt: Date.now() + 30 * 86400000 }; return d })
    setAuthOpen(null)
    setAdminUnlocked(true)
    showToast(`Welcome back, Admin ${acc.username}!`)
    setAdminSection('dashboard')
    go('admin')
  }

  /** Owner bed +/- on an API listing. Returns false if the API call failed. */
  async function handleApiBeds(id: string, availableBeds: number): Promise<boolean> {
    try {
      await apiUpdateListing(id, { available_beds: availableBeds })
      await refreshListings()
      return true
    } catch (err) {
      showToast(apiErrorMessage(err))
      return false
    }
  }

  /** Delete an API listing. Returns false if the API call failed. */
  async function handleApiDelete(id: string): Promise<boolean> {
    try {
      await apiDeleteListing(id)
      await refreshListings()
      showToast('Listing delete ho gayi.')
      return true
    } catch (err) {
      showToast(apiErrorMessage(err))
      return false
    }
  }

  /** Super Admin verify / unverify on an API listing. */
  async function handleApiVerify(id: string, verified: boolean): Promise<boolean> {
    try {
      await apiVerifyListing(id, verified)
      await refreshListings()
      showToast(verified ? 'Listing verify ho gayi.' : 'Listing unverified kar di gayi.')
      return true
    } catch (err) {
      showToast(apiErrorMessage(err))
      return false
    }
  }

  /** Near Me: browser location se nearest-first sort (approx distance). */
  function toggleNearMe() {
    if (nearestFirst) {
      setNearestFirst(false)
      setUserLoc(null)
      return
    }
    if (!('geolocation' in navigator)) {
      showToast('Is browser me location nahi milta — area se dhoondho')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setNearestFirst(true)
        showToast('Near Me on — nearest PG pehle (approx distance)')
      },
      () => showToast('Location nahi mila — permission allow karo ya area se dhoondho'),
      { timeout: 8000, maximumAge: 60000 },
    )
  }

  function adminLogout() {
    clearAdminToken()
    update((d) => { d.adminSession = null; return d })
    setAdminUnlocked(false)
    showToast('Super Admin logout ho gaya.')
  }

  function logout() {
    clearToken()
    setOwnerPinUnlocked(false)
    update((d) => { d.session = null; return d })
    showToast('Logout ho gaya.')
    go('home')
  }

  /* ---------- Left-sidebar menus (all three dashboards) ---------- */
  const ownerPropIds = useMemo(() => new Set(
    sessionUser ? displayProperties.filter((p) => p.ownerPhone === sessionUser.phone || p.ownerId === sessionUser.id).map((p) => p.id) : [],
  ), [displayProperties, sessionUser])
  const ownerNewEnquiries = db.enquiries.filter((e) => ownerPropIds.has(e.propertyId) && e.status === 'New').length
  const ownerOpenComplaints = db.complaints.filter((c) => ownerPropIds.has(c.propertyId) && c.status === 'Open').length
  const tenantEnquiryCount = sessionUser ? db.enquiries.filter((e) => e.tenantPhone === sessionUser.phone).length : 0
  const adminUnverified = totalProps - verifiedCount
  const sidebarProps = {
    collapsed: sidebarCollapsed,
    onToggleCollapsed: () => setSidebarCollapsed((c) => !c),
    drawerOpen: sidebarOpen,
    onCloseDrawer: () => setSidebarOpen(false),
  } as const

  const tenantSections: SidebarSection[] = [
    {
      heading: 'Dhoondho',
      items: [
        { id: 'home', label: 'Home / Search PGs', icon: Home, onClick: () => go('home') },
        { id: 'bookings', label: 'My Bookings', icon: BookOpen, badge: tenantEnquiryCount, onClick: () => { go('bookings'); setTenantSection('bookings') } },
        { id: 'saved', label: 'Saved PGs', icon: Heart, badge: savedIds.length, onClick: () => { go('bookings'); setTenantSection('saved') } },
      ],
    },
    {
      heading: 'Mera Account',
      items: [
        { id: 'list', label: 'Apna PG List Karo — FREE', icon: Plus, onClick: () => setListOpen(true) },
        ...(sessionUser
          ? [{ id: 'profile', label: 'Profile / My Account', icon: UserRound, onClick: () => { go('bookings'); setTenantSection('profile') } }]
          : [{ id: 'login', label: 'Login / Sign Up', icon: KeyRound, onClick: () => setAuthOpen({ mode: 'login', portal: 'user' }) }]),
      ],
    },
  ]
  const ownerSections: SidebarSection[] = [
    {
      heading: 'Makan Malik',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, onClick: () => { go('owner'); setOwnerSection('dashboard') } },
        { id: 'PGs', label: 'My PGs', icon: Building2, badge: ownerPropIds.size, onClick: () => { go('owner'); setOwnerSection('PGs') } },
        { id: 'add', label: 'Add New PG', icon: Plus, onClick: () => setListOpen(true) },
        { id: 'Enquiries', label: 'Enquiries', icon: MessageSquare, badge: ownerNewEnquiries, onClick: () => { go('owner'); setOwnerSection('Enquiries') } },
      ],
    },
    {
      heading: 'Manage',
      items: [
        { id: 'Tenants', label: 'Tenants', icon: Users, onClick: () => { go('owner'); setOwnerSection('Tenants') } },
        { id: 'Rent & Dues', label: 'Rent & Dues', icon: Wallet, onClick: () => { go('owner'); setOwnerSection('Rent & Dues') } },
        { id: 'Complaints', label: 'Complaints', icon: ClipboardList, badge: ownerOpenComplaints, onClick: () => { go('owner'); setOwnerSection('Complaints') } },
        { id: 'reviews', label: 'Reviews', icon: Star, onClick: () => { go('owner'); setOwnerSection('reviews') } },
      ],
    },
    {
      heading: 'Account',
      items: [
        { id: 'profile', label: 'Profile / Settings', icon: Settings, onClick: () => { go('owner'); setOwnerSection('profile') } },
      ],
    },
  ]
  const adminSections: SidebarSection[] = [
    {
      heading: 'Control Room',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, onClick: () => { go('admin'); setAdminSection('dashboard') } },
        { id: 'all', label: 'All PGs', icon: Building2, badge: totalProps, onClick: () => { go('admin'); setAdminSection('all') } },
        { id: 'verified', label: 'Verified PGs', icon: ShieldCheck, badge: verifiedCount, onClick: () => { go('admin'); setAdminSection('verified') } },
        { id: 'unverified', label: 'Unverified PGs', icon: ShieldAlert, badge: adminUnverified, onClick: () => { go('admin'); setAdminSection('unverified') } },
      ],
    },
    {
      heading: 'Log',
      items: [
        { id: 'owners', label: 'Owners', icon: Users, badge: db.users.filter((u) => u.role === 'owner').length, onClick: () => { go('admin'); setAdminSection('owners') } },
        { id: 'users', label: 'Users / Tenants', icon: UserRound, badge: db.users.length, onClick: () => { go('admin'); setAdminSection('users') } },
        { id: 'enquiries', label: 'Enquiries', icon: MessageSquare, badge: db.enquiries.length, onClick: () => { go('admin'); setAdminSection('enquiries') } },
        { id: 'reviews', label: 'Reviews', icon: Star, badge: db.reviews.length, onClick: () => { go('admin'); setAdminSection('reviews') } },
        { id: 'complaints', label: 'Complaints', icon: ClipboardList, badge: db.complaints.filter((c) => c.status === 'Open').length, onClick: () => { go('admin'); setAdminSection('complaints') } },
      ],
    },
    {
      heading: 'System',
      items: [
        { id: 'settings', label: 'Settings', icon: Settings, onClick: () => { go('admin'); setAdminSection('settings') } },
      ],
    },
  ]

  return (
    <div>
      {/* Trust strip */}
      <div className="trust-strip">
        <div className="container">
          <span><span className="pulse" /> {bedsLoading ? <b>…</b> : <b>{totalBeds}</b>}&nbsp;live beds available</span>
          <span><BadgeCheck size={14} /> No Brokerage</span>
          <span><ShieldCheck size={14} /> Verified Owners</span>
          <span><Plus size={14} /> Listing FREE</span>
        </div>
      </div>

      {/* Header */}
      <header className="topbar">
        <div className="container topbar-inner">
          {view !== 'home' && (
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Dashboard menu kholo">
              <Menu size={22} />
            </button>
          )}
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); go('home') }} aria-label="StayHazaribagh home">
            <img className="brand-mark" src="/logo.png" alt="StayHazaribagh logo" width={46} height={46} />
            <span>
              <span className="brand-name">StayHazaribagh<em>.</em></span>
              <span className="brand-sub">Hazaribagh • Ranchi — Jharkhand</span>
            </span>
          </a>
          <div className="header-actions">
            <button className="btn btn-orange" onClick={() => setListOpen(true)}><Plus size={18} /> List PG FREE</button>
            {adminSessionUser && (
              <span className="account-chip admin-chip" title="Super Admin logged in">
                <span className="avatar" style={{ background: '#b45309' }}><Crown size={15} /></span>
                <span className="account-name">Admin: {adminSessionUser.username}</span>
                <button className="btn btn-danger btn-sm logout-pill" onClick={adminLogout} aria-label="Super Admin log out"><LogOut size={15} /> <span className="logout-text">Logout</span></button>
              </span>
            )}
            {sessionUser ? (
              <span className="account-chip">
                <span className="avatar">{sessionUser.name[0]?.toUpperCase()}</span>
                <span className="account-name">{sessionUser.name.split(' ')[0]}</span>
                <button className="btn btn-danger btn-sm logout-pill" onClick={logout} aria-label="Log out"><LogOut size={15} /> <span className="logout-text">Logout</span></button>
              </span>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={() => setAuthOpen({ mode: 'login', portal: 'user' })}>Login</button>
                <button className="btn" onClick={() => setAuthOpen({ mode: 'signup', portal: 'user' })}>Sign Up</button>
              </>
            )}
          </div>
        </div>
        <div className="brand-line" />
      </header>

      <main>
        {view === 'home' && (
          <HomeView
            db={viewDb} city={city} setCity={setCity} locality={locality} setLocality={setLocality}
            gender={gender} setGender={setGender} maxRent={maxRent} setMaxRent={setMaxRent}
            query={query} setQuery={setQuery} filtered={filtered} localitiesForCity={localitiesForCity}
            pageItems={pageItems} page={safePage} totalPages={totalPages} onPageChange={goToPage}
            totalBeds={totalBeds} totalProps={totalProps} verifiedCount={verifiedCount}
            verifiedTab={verifiedTab} setVerifiedTab={setVerifiedTab}
            userLoc={userLoc} nearestFirst={nearestFirst} onToggleNearMe={toggleNearMe}
            apiStatus={apiStatus} apiLoading={apiLoading}
            onSelect={setSelected} onList={() => setListOpen(true)} onGo={go}
            savedIds={savedIds} onToggleSave={toggleSave}
            onClearFilters={() => { setCity('Both'); setLocality('All'); setGender('All'); setMaxRent(8000); setQuery(''); setVerifiedTab('All'); setPage(1) }}
          />
        )}
        {view === 'bookings' && (
          <div className={`dash-layout ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <DashboardSidebar
              title="My Dashboard" subtitle="PG dhoondho, bookings dekho"
              userInitial={sessionUser ? (sessionUser.name[0]?.toUpperCase() ?? 'G') : 'G'}
              userName={sessionUser ? sessionUser.name.split(' ')[0] : 'Guest'}
              userRole={sessionUser ? (sessionUser.role === 'owner' ? 'Makan Malik' : 'Tenant') : 'Guest — login karo'}
              sections={tenantSections} activeId={tenantSection} onLogout={sessionUser ? logout : undefined}
              {...sidebarProps}
            />
            <div className="dash-content">
              <BookingsView db={viewDb} sessionUser={sessionUser} code={bookingCode} setCode={setBookingCode}
                phone={bookingPhone} setPhone={setBookingPhone} onSelect={setSelected} onLogout={logout}
                section={tenantSection} setSection={setTenantSection}
                savedIds={savedIds} savedProps={displayProperties.filter((p) => savedIds.includes(p.id))}
                onToggleSave={toggleSave} userLoc={userLoc}
                onComplaint={(c) => update((d) => { d.complaints.push(c); return d })} showToast={showToast} />
            </div>
          </div>
        )}
        {view === 'owner' && (
          <div className={`dash-layout ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <DashboardSidebar
              title="Makan Malik Portal" subtitle="Apne PGs, tenants aur rent"
              userInitial={sessionUser ? (sessionUser.name[0]?.toUpperCase() ?? 'M') : 'M'}
              userName={sessionUser ? sessionUser.name.split(' ')[0] : 'Makan Malik'}
              userRole={sessionUser ? 'Owner' : 'Login karo'}
              sections={ownerSections} activeId={ownerSection} onLogout={sessionUser ? logout : undefined}
              {...sidebarProps}
            />
            <div className="dash-content">
              <OwnerView db={viewDb} sessionUser={sessionUser} update={update} showToast={showToast}
                apiIds={apiIds} onApiBeds={handleApiBeds} onApiDelete={handleApiDelete}
                section={ownerSection} setSection={setOwnerSection} freshLoginUnlocked={ownerPinUnlocked}
                onAuth={() => setAuthOpen({ mode: 'login', portal: 'owner' })} onList={() => setListOpen(true)} onLogout={logout} />
            </div>
          </div>
        )}
        {view === 'admin' && (
          <div className={`dash-layout ${sidebarCollapsed ? 'collapsed' : ''}`}>
            {adminSessionUser || adminUnlocked ? (
              <DashboardSidebar
                title="Super Admin" subtitle="Platform control room"
                userInitial={adminSessionUser ? (adminSessionUser.username[0]?.toUpperCase() ?? 'A') : 'A'}
                userName={adminSessionUser ? adminSessionUser.username : 'Super Admin'}
                userRole="Super Admin"
                sections={adminSections} activeId={adminSection} onLogout={adminSessionUser ? adminLogout : undefined}
                {...sidebarProps}
              />
            ) : null}
            <div className="dash-content">
              <AdminView db={viewDb} update={update} showToast={showToast} unlocked={adminUnlocked} setUnlocked={setAdminUnlocked}
                adminSessionUser={adminSessionUser} onAdminLogout={adminLogout}
                apiIds={apiIds} onApiVerify={handleApiVerify} onApiDelete={handleApiDelete}
                section={adminSection} setSection={setAdminSection}
                onOpenAuth={(portal) => setAuthOpen({ mode: 'login', portal })} />
            </div>
          </div>
        )}
      </main>

      <SiteFooter onGo={go} onGoCity={(c) => { setCity(c); go('home') }} />

      {/* Mobile bottom tab bar */}
      <nav className="bottom-bar" aria-label="Mobile">
        <button className={view === 'home' ? 'active' : ''} onClick={() => go('home')}><span className="bb-icon"><Home size={20} /></span>Home</button>
        <button className={view === 'bookings' ? 'active' : ''} onClick={() => go('bookings')}><span className="bb-icon"><BookOpen size={20} /></span>Bookings</button>
        <button className="bb-fab" onClick={() => setListOpen(true)} aria-label="List PG free"><span><Plus size={26} /></span>List PG</button>
        <button className={view === 'owner' ? 'active' : ''} onClick={() => go('owner')}><span className="bb-icon"><Building2 size={20} /></span>Owner</button>
      </nav>

      {selected && (
        <DetailSheet property={selected} db={viewDb} sessionUser={sessionUser}
          onClose={() => setSelected(null)} showToast={showToast}
          onEnquiry={async (e: Enquiry) => {
            // API mode: enquiry backend ko bhi bhejo; local copy tab bhi save
            // karo taaki My Bookings / Owner portal offline bhi kaam kare.
            // Server apna code de to wahi dikhao, warna local code.
            let code = e.code
            if (apiConfigured()) {
              try {
                const res = await createEnquiry({ listing_id: e.propertyId, name: e.tenantName, phone: e.tenantPhone, message: e.message })
                if (typeof res?.code === 'string' && res.code) code = res.code
              } catch {
                // Network fail — local save below still keeps the enquiry.
              }
            }
            const saved = { ...e, code }
            update((d) => { d.enquiries.push(saved); return d })
            return code
          }}
          onReview={async (propertyId: string, author: string, stars: number, comment: string) => {
            if (apiConfigured()) {
              try {
                await createReview({ listing_id: propertyId, name: author, stars, comment })
              } catch {
                // Network fail — local save below still keeps the review.
              }
            }
            update((d) => {
              d.reviews.push({ id: uid(), propertyId, author, stars, comment, createdAt: new Date().toISOString() }); return d
            })
          }} />
      )}
      {authOpen && (
        <AuthHub mode={authOpen.mode} portal={authOpen.portal}
          onClose={() => setAuthOpen(null)}
          onSwitch={(m, portal) => setAuthOpen({ mode: m, portal })}
          onSubmit={handleAuth}
          adminAccountConfigured={!!db.adminAccount}
          onAdminLogin={handleAdminLogin}
          onGoAdminSetup={() => { setAuthOpen(null); go('admin') }} />
      )}
      {listOpen && (
        <ListPGWizard db={db} sessionUser={sessionUser} onClose={() => setListOpen(false)}
          showToast={showToast}
          onCreate={async (p: Property) => {
            // API mode + logged-in owner: listing backend par banao. Guest
            // (bina login) ya network fail par purana local behaviour.
            if (apiConfigured() && getToken()) {
              try {
                await createListing(propertyToApiListing(p))
                setListOpen(false)
                showToast('PG list ho gaya — Not Verified se start hoga. Admin verify karega.')
                await refreshListings()
                return
              } catch (err) {
                if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
                  showToast(err.message)
                  return // wizard khula rehta hai — user data theek karke retry kare
                }
                showToast('Backend se connect nahi hua — listing device par save ho gayi.')
              }
            }
            update((d) => { d.properties.push(p); return d }); setListOpen(false); showToast('PG list ho gaya — Not Verified se start hoga. Admin verify karega.')
          }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

/* ---------------- Home ---------------- */
/** Page-number window for the pagination bar (e.g. 1 … 4 5 6 … 187). */
function pageWindow(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const keep = new Set([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1])
  const nums = [...keep].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('…')
    out.push(n)
  })
  return out
}

function HomeView(props: {
  db: DB; city: CityFilter; setCity: (c: CityFilter) => void; locality: string; setLocality: (s: string) => void
  gender: 'All' | Gender; setGender: (g: 'All' | Gender) => void; maxRent: number; setMaxRent: (n: number) => void
  query: string; setQuery: (s: string) => void; filtered: Property[]; localitiesForCity: string[]
  pageItems: Property[]; page: number; totalPages: number; onPageChange: (n: number) => void
  totalBeds: number; totalProps: number; verifiedCount: number
  verifiedTab: VerifiedTab; setVerifiedTab: (t: VerifiedTab) => void
  userLoc: LatLng | null; nearestFirst: boolean; onToggleNearMe: () => void
  apiStatus: ApiStatus; apiLoading: boolean
  onSelect: (p: Property) => void; onList: () => void; onGo: (v: View) => void
  savedIds: string[]; onToggleSave: (id: string) => void
  onClearFilters: () => void
}) {
  const { db, filtered } = props
  const unverifiedCount = props.totalProps - props.verifiedCount
  /** Backend still waking up — show "…" instead of a misleading 0. */
  const loadingCounts = props.apiLoading && props.totalProps === 0
  /** Filters currently applied, in plain words — shown when listings exist but none match. */
  const activeFilters: string[] = [
    ...(props.query.trim() ? [`Search: "${props.query.trim()}"`] : []),
    ...(props.city !== 'Both' ? [`City: ${props.city}`] : []),
    ...(props.locality !== 'All' ? [`Locality: ${props.locality}`] : []),
    ...(props.gender !== 'All' ? [`Kaun ke liye: ${props.gender}`] : []),
    `Max rent: ${inr(props.maxRent)} / month`,
    ...(props.verifiedTab !== 'All' ? [`Tab: ${props.verifiedTab}`] : []),
  ]
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const FAQS: [string, string][] = [
    ['Hazaribagh me PG ka rent kitna hota hai?', 'Rent area, sharing aur khane par depend karta hai. Is site par har PG ka total monthly cost (rent + mess + deposit) saaf dikhaya jata hai — koi chhupa hua charge nahi.'],
    ['StayHazaribagh par brokerage lagti hai?', 'Nahi. Tenant se koi brokerage nahi li jati, aur owner ki listing FREE hai.'],
    ['Verified badge ka matlab kya hai?', 'Super Admin ne us PG aur owner ki jaanch ki hai. Nayi listing hamesha Not Verified se start hoti hai.'],
    ['Owner apna PG kaise list kare?', 'Upar List PG FREE button se 4 steps me — PG details, rooms/beds, facilities, aur contact. Listing turant live hogi, Not Verified badge ke saath.'],
  ]
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <span className="pill-badge"><MapPin size={14} /> Hazaribagh • Ranchi — Jharkhand</span>
          <h1>Hazaribagh me apna <mark>PG dhoondho</mark>, bina brokerage ke.</h1>
          <p>Matwari, Korrah, Babugaon, Near VBU, Lalpur, Bariatu — live bed availability dekho, owner se seedha baat karo, aur visit book karo. Makan malik ke liye listing bilkul FREE hai.</p>
          <div className="search-panel">
            <div className="segmented" role="group" aria-label="City">
              {(['Hazaribagh', 'Ranchi', 'Both'] as CityFilter[]).map((c) => (
                <button key={c} className={props.city === c ? 'active' : ''} onClick={() => { props.setCity(c); props.setLocality('All') }}>
                  {c === 'Both' ? 'Dono Cities' : c}
                </button>
              ))}
            </div>
            <label htmlFor="q">PG ya area ka naam</label>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: 14, color: '#5f6f6d' }} />
              <input id="q" value={props.query} onChange={(e) => props.setQuery(e.target.value)} placeholder="Jaise — Vatika, Matwari, Korrah Road…" style={{ paddingLeft: 42 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label htmlFor="loc">Locality</label>
                <select id="loc" value={props.locality} onChange={(e) => props.setLocality(e.target.value)}>
                  <option value="All">Saari localities</option>
                  {props.localitiesForCity.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="gen">Kaun ke liye</label>
                <select id="gen" value={props.gender} onChange={(e) => props.setGender(e.target.value as 'All' | Gender)}>
                  <option value="All">Boys / Girls / Co-ed</option>
                  <option value="Boys">Boys</option>
                  <option value="Girls">Girls</option>
                  <option value="Co-ed">Co-ed</option>
                </select>
              </div>
            </div>
            <label htmlFor="rent">Max rent — {inr(props.maxRent)} / month</label>
            <input id="rent" type="range" min={1500} max={12000} step={500} value={props.maxRent} onChange={(e) => props.setMaxRent(Number(e.target.value))} style={{ padding: 0, accentColor: '#0f4c4c', height: 44 }} />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {['Boys', 'Girls', 'Co-ed'].map((g) => (
                <button key={g} className={`chip ${props.gender === g ? 'active' : ''}`} onClick={() => props.setGender(props.gender === g ? 'All' : g as Gender)}>{g} PG</button>
              ))}
              <button className="chip" onClick={() => props.onGo('bookings')}><BookOpen size={14} /> My Bookings</button>
            </div>
          </div>
          <div className="stats-row">
            <div className="stat"><b>{loadingCounts ? '…' : <CountUp to={props.totalProps} />}</b><span>PGs listed</span></div>
            <div className="stat"><b>{loadingCounts ? '…' : <CountUp to={props.totalBeds} />}</b><span>Beds available</span></div>
            <div className="stat"><b>{loadingCounts ? '…' : <CountUp to={props.verifiedCount} />}</b><span>Verified PGs</span></div>
            <div className="stat"><b>₹0</b><span>Brokerage — hamesha</span></div>
          </div>
        </div>
        <div className="ticker" aria-hidden="true"><div className="ticker-track">
          {[...ALL_LOCALITIES, ...ALL_LOCALITIES].map((l, i) => <span key={i}>• {l}</span>)}
        </div></div>
      </section>

      <section className="section container" id="listings">
        <h2>{filtered.length ? `${filtered.length} PG mile` : 'Abhi koi PG listed nahi hai'}</h2>
        <p className="muted">Har listing by default <b>Not Verified</b> hoti hai. Admin jaanch ke baad hi <b>Verified</b> badge lagta hai — taaki aapko fake listing na mile.</p>
        {props.apiStatus === 'live' && <p className="small muted">Live backend se load ho raha hai.</p>}
        {props.apiStatus === 'offline' && <p className="small" style={{ color: '#b45309' }}>Offline mode — device par save hua data dikh raha hai.</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          <div className="tabs" role="tablist" aria-label="Verified filter" style={{ flex: 1 }}>
            {([
              ['All', `Saare (${props.totalProps})`],
              ['Verified', `Verified (${props.verifiedCount})`],
              ['Unverified', `Unverified (${unverifiedCount})`],
            ] as [VerifiedTab, string][]).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={props.verifiedTab === t}
                className={props.verifiedTab === t ? 'active' : ''} onClick={() => props.setVerifiedTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <button className={`chip ${props.nearestFirst ? 'active' : ''}`} onClick={props.onToggleNearMe} aria-pressed={props.nearestFirst}>
            <Navigation size={14} /> {props.nearestFirst ? 'Near Me: On' : 'Near Me'}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {props.nearestFirst && props.userLoc
            ? 'Nearest pehle — tumhari location se (approx distance, locality ke centre se).'
            : 'Nearest pehle — Hazaribagh centre se (approx distance, locality ke centre se).'}
        </p>
        {props.apiLoading && filtered.length === 0 ? (
          <div className="grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        ) : filtered.length === 0 && props.totalProps === 0 ? (
          <div className="empty">
            <Building2 size={40} color="#0f4c4c" />
            <h3>Zero fake listings — isiliye yahan abhi kuch nahi dikh raha</h3>
            <p className="muted">Humne koi naam, number ya rent invent nahi kiya hai. Pehli real listing aate hi yahan dikhegi.<br />Agar aap makan malik hain, to apna PG free me list karein.</p>
            <button className="btn btn-orange" onClick={props.onList}><Plus size={18} /> Apna PG FREE List Karein</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <Search size={40} color="#0f4c4c" />
            <h3>Is filter/search se koi PG nahi mila</h3>
            <p className="muted">Site par {props.totalProps} PG listed hain, par ye filter/search unme se kisi se match nahi karta.</p>
            <p className="small" style={{ marginTop: 4 }}>
              Abhi lage hue filters: {activeFilters.join(' • ')}
            </p>
            <button className="btn btn-orange" onClick={props.onClearFilters}><X size={18} /> Filters saaf karo</button>
          </div>
        ) : (
          <>
            <div className="grid">
              {props.pageItems.map((p, i) => <PropertyCard key={p.id} p={p} db={db} index={i} userLoc={props.userLoc} onSelect={props.onSelect} saved={props.savedIds.includes(p.id)} onToggleSave={props.onToggleSave} />)}
            </div>
            <nav className="pagination" aria-label="PG results pages">
              <p className="page-info">
                Showing {(props.page - 1) * PAGE_SIZE + 1}–{Math.min(props.page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <button className="page-btn" disabled={props.page <= 1} onClick={() => props.onPageChange(props.page - 1)} aria-label="Previous page">
                <ChevronLeft size={18} /> Prev
              </button>
              {pageWindow(props.page, props.totalPages).map((n, i) =>
                n === '…' ? (
                  <span key={`e${i}`} className="page-ellipsis" aria-hidden="true">…</span>
                ) : (
                  <button key={n} className={`page-btn ${n === props.page ? 'active' : ''}`} aria-current={n === props.page ? 'page' : undefined}
                    onClick={() => props.onPageChange(n)}>
                    {n}
                  </button>
                ),
              )}
              <button className="page-btn" disabled={props.page >= props.totalPages} onClick={() => props.onPageChange(props.page + 1)} aria-label="Next page">
                Next <ChevronRight size={18} />
              </button>
              <p className="page-info small muted">Page {props.page} of {props.totalPages}</p>
            </nav>
          </>
        )}
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <h2>Hazaribagh Area Guide</h2>
        <p className="muted">Kahan rehna sahi rahega? VBU ke aas-paas ke areas students ke liye sabse popular hain.</p>
        <div className="guide-grid">
          {[
            ['Matwari', 'Hazaribagh ka main bazaar area — coaching, dukaan aur bus stand paas me. Students ke liye sabse zyada PG yahin milte hain.'],
            ['Korrah', 'Shant residential area, Korrah Road par girls hostels zyada hain. VBU se aane-jaane me aasan.'],
            ['Near VBU', 'Vinoba Bhave University ke bilkul paas — classes ke liye paidal ja sakte ho. Single aur sharing dono milte hain.'],
            ['Babugaon', 'Budget-friendly area — kam rent me room aur PG mil jata hai, shahar se thoda andar.'],
            ['Lalpur, Ranchi', 'Ranchi ka student hub — coaching institutes aur PGs ki badi choice.'],
            ['Bariatu & Kanke Road', 'Ranchi ke shaant, green areas — working professionals aur students dono ke liye achhe PG.'],
          ].map(([t, d], i) => (
            <article className="guide" key={t} style={{ animationDelay: `${i * 0.06}s` }}>
              <h3 style={{ marginTop: 0 }}>{t}</h3><p className="muted">{d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <h2>Kaise kaam karta hai?</h2>
        <div className="guide-grid">
          <div className="guide"><h3>1. Dhoondho</h3><p className="muted">City, locality, budget aur Boys/Girls se filter karo. Live beds dekho — jo available hai, wahi dikhega.</p></div>
          <div className="guide"><h3>2. Visit book karo</h3><p className="muted">Enquiry bhejo, apna private enquiry code sambhal ke rakho. Owner WhatsApp ya call par visit fix karega.</p></div>
          <div className="guide"><h3>3. Shift ho jao</h3><p className="muted">Room dekh ke, rent aur rules samajh ke hi shift ho. Verified badge wale PG ko pehle dekho.</p></div>
        </div>
        <h2 style={{ marginTop: 36 }}>Rent FAQs — Hazaribagh</h2>
        {FAQS.map(([q, a], i) => {
          const open = openFaq === i
          return (
            <div className={`faq ${open ? 'open' : ''}`} key={q}>
              <button type="button" className="faq-q" aria-expanded={open} onClick={() => setOpenFaq(open ? null : i)}>
                <b>{q}</b><ChevronDown size={18} className="faq-chev" />
              </button>
              {open && <span className="muted faq-a">{a}</span>}
            </div>
          )
        })}
      </section>
    </>
  )
}

function PropertyCard({ p, db, index, userLoc, onSelect, saved, onToggleSave }: { p: Property; db: DB; index: number; userLoc: LatLng | null; onSelect: (p: Property) => void; saved?: boolean; onToggleSave?: (id: string) => void }) {
  const revs = db.reviews.filter((r) => r.propertyId === p.id)
  const { avg, count } = avgRating(revs)
  const occ = occupancy(p)
  const dist = userLoc ? approxDistanceKm(userLoc, p.locality, p.city) : null
  return (
    <article className="card" style={{ animationDelay: `${Math.min(index, 6) * 0.07}s` }}>
      <div className="card-cover" onClick={() => onSelect(p)} role="button" tabIndex={0}>
        <div>
          <div className="cover-city">{p.city}</div>
          <div className="cover-locality"><MapPin size={13} /> {p.locality}</div>
        </div>
        <span className="badge badge-live" style={{ position: 'absolute', top: 12, right: 12 }}><span className="pulse" /> {p.availableBeds} beds left</span>
        {onToggleSave && (
          <button
            type="button"
            className={`save-heart ${saved ? 'saved' : ''}`}
            aria-label={saved ? 'Saved se hatayo' : 'PG save karo'}
            aria-pressed={!!saved}
            onClick={(e) => { e.stopPropagation(); onToggleSave(p.id) }}
          >
            <Heart size={18} fill={saved ? '#f59e0b' : 'none'} color={saved ? '#f59e0b' : '#fff'} />
          </button>
        )}
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <h3>{p.name}</h3>
          {p.verified
            ? <span className="badge badge-verified"><ShieldCheck size={13} /> Verified</span>
            : <span className="badge badge-unverified"><ShieldAlert size={13} /> Not Verified</span>}
        </div>
        <p className="muted small" style={{ margin: '2px 0' }}>{p.gender} • {p.sharing} • {p.locality}, {p.city}</p>
        {dist !== null && <p className="small muted" style={{ margin: '2px 0' }}><Navigation size={12} /> ~{dist} km away (approx)</p>}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span className="price">{inr(p.rent)}<small> /month</small></span>
          {count > 0
            ? <span className="small"><Star size={13} color="#f59e0b" fill="#f59e0b" /> {avg} ({count} review{count > 1 ? 's' : ''})</span>
            : p.rating !== undefined && p.rating > 0
              ? <span className="small"><Star size={13} color="#f59e0b" fill="#f59e0b" /> {p.rating}{p.reviewCount !== undefined ? ` (${p.reviewCount} review${p.reviewCount > 1 ? 's' : ''})` : ''}</span>
              : null}
        </div>
        <div className="occ"><i style={{ width: `${occ}%` }} /></div>
        <span className="small muted">{occ}% occupied • {p.availableBeds} / {p.totalBeds} beds free</span>
        <div className="facilities">
          {p.foodIncluded && <span><UtensilsCrossed size={12} /> Mess</span>}
          {p.facilities.slice(0, 3).map((f) => <span key={f}>{f}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" style={{ flex: 1, justifyContent: 'center' }} onClick={() => onSelect(p)}>Details <ChevronRight size={15} /></button>
          <a className="btn btn-ghost btn-sm" href={mapsDirectionsUrl(p)} target="_blank" rel="noreferrer"><Navigation size={15} /> Directions</a>
        </div>
      </div>
    </article>
  )
}

/* ---------------- Detail sheet: Maps, enquiry, reviews ---------------- */
function DetailSheet(props: {
  property: Property; db: DB; sessionUser: User | null; onClose: () => void; showToast: (m: string) => void
  onEnquiry: (e: Enquiry) => Promise<string>
  onReview: (propertyId: string, author: string, stars: number, comment: string) => Promise<void> | void
}) {
  const { property: p, db } = props
  const [name, setName] = useState(props.sessionUser?.name || '')
  const [phone, setPhone] = useState(props.sessionUser?.phone || '')
  const [msg, setMsg] = useState('Visit karna hai — kab aa sakte hain?')
  const [code, setCode] = useState('')
  const [rName, setRName] = useState(props.sessionUser?.name || '')
  const [rStars, setRStars] = useState(5)
  const [rComment, setRComment] = useState('')
  const revs = db.reviews.filter((r) => r.propertyId === p.id)
  const { avg, count } = avgRating(revs)

  // Mobile UI: sheet khulte hi peeche ka page scroll lock ho, Escape/backdrop se band ho.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [])

  async function sendEnquiry() {
    const ph = phone.replace(/\D/g, '').slice(-10)
    if (!name.trim() || ph.length !== 10) return props.showToast('Naam aur sahi 10-digit number daalein')
    const c = enquiryCode()
    const finalCode = await props.onEnquiry({ id: uid(), code: c, propertyId: p.id, propertyName: p.name, tenantName: name.trim(), tenantPhone: ph, message: msg, status: 'New', createdAt: new Date().toISOString() })
    setCode(finalCode)
    props.showToast('Enquiry bhej di gayi! Apna code sambhal ke rakho.')
  }

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={p.name}>
        <div className="grab-handle" aria-hidden="true" />
        <div className="sheet-head">
          <div>
            <h2 style={{ margin: 0 }}>{p.name}</h2>
            <p className="muted" style={{ margin: '4px 0' }}><MapPin size={14} /> {p.address}, {p.locality}, {p.city}</p>
            {p.verified
              ? <span className="badge badge-verified"><ShieldCheck size={13} /> Verified — Admin ne jaanch ki hai</span>
              : <span className="badge badge-unverified"><ShieldAlert size={13} /> Not Verified — abhi admin verification pending hai</span>}
          </div>
          <button className="close-btn" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
          <span className="price" style={{ fontSize: 28 }}>{inr(p.rent)}<small> /month</small></span>
          <span className="muted">Deposit: {inr(p.deposit)}<br />{p.gender} • {p.sharing}</span>
          <span className="muted"><BedDouble size={16} /> {p.availableBeds} / {p.totalBeds} beds free<br />{occupancy(p)}% occupied</span>
        </div>
        <div className="occ"><i style={{ width: `${occupancy(p)}%` }} /></div>
        <p><b>Khana:</b> {p.foodIncluded ? `Mess included${p.foodNote ? ` — ${p.foodNote}` : ''}` : 'Mess nahi hai — khud ka khana / tiffin'}</p>
        <p><b>Facilities:</b> {p.facilities.join(', ') || '—'}</p>
        <p><b>Rules:</b> {p.rules || 'Owner se confirm karein.'}</p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a className="btn" href={mapsSearchUrl(p)} target="_blank" rel="noreferrer"><MapPin size={17} /> Google Maps par dekho</a>
          <a className="btn btn-ghost" href={mapsDirectionsUrl(p)} target="_blank" rel="noreferrer"><Navigation size={17} /> Directions — Rasta dekho</a>
          <a className="btn btn-ghost" href={`https://wa.me/91${p.ownerPhone}?text=${encodeURIComponent(`Namaste! ${p.name} (${p.locality}, ${p.city}) me bed available hai kya?`)}`} target="_blank" rel="noreferrer"><MessageSquare size={17} /> WhatsApp Owner</a>
          <a className="btn btn-ghost" href={`tel:+91${p.ownerPhone}`}><Phone size={17} /> Call Owner</a>
        </div>
        <p className="small muted">Owner ka number sirf enquiry ke baad dikhaya jata hai — spam se bachane ke liye. Upar WhatsApp/Call se seedha baat kar sakte ho.</p>

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '20px 0' }} />
        <h3>Book a Visit — Free Enquiry</h3>
        {code ? (
          <div className="panel" style={{ background: '#dcf5e9' }}>
            <b>Enquiry bhej di gayi!</b>
            <p>Apna private enquiry code sambhal ke rakho — isi se My Bookings me status dekh paoge:</p>
            <p style={{ fontSize: 28, letterSpacing: 4, fontWeight: 800, margin: '6px 0' }}>{code}</p>
            <p className="small muted">Owner ko bhi ye code milega. Kisi aur ko mat batana.</p>
          </div>
        ) : (
          <>
            <label>Apna naam</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jaise — Gautam Keshri" />
            <label>WhatsApp number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" inputMode="tel" />
            <label>Message</label>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} />
            <button className="btn btn-orange" style={{ marginTop: 12 }} onClick={sendEnquiry}>Enquiry Bhejo — Free</button>
          </>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '20px 0' }} />
        <h3>Reviews {count > 0 ? `— ${avg} ★ (${count})` : ''}</h3>
        <p className="small muted">Ye reviews sirf is site par likhe gaye hain — Google se copy nahi kiye gaye.</p>
        {revs.length === 0 && <p className="muted">Abhi koi review nahi hai. Pehla review aap likh sakte ho — agar aap yahan reh chuke ho to.</p>}
        {revs.map((r) => (
          <div className="review" key={r.id}>
            <b>{r.author}</b> <span style={{ color: '#f59e0b' }}>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span>
            <span className="muted small"> • {timeAgo(r.createdAt)}</span>
            <p style={{ margin: '6px 0 0' }}>{r.comment}</p>
          </div>
        ))}
        <label>Apna naam</label>
        <input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Apna naam" />
        <label>Rating</label>
        <div className="stars" role="group" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((s) => (
            <button key={s} type="button" className={s <= rStars ? 'on' : ''} onClick={() => setRStars(s)} aria-label={`${s} star`}>★</button>
          ))}
        </div>
        <label>Apna experience likho</label>
        <textarea value={rComment} onChange={(e) => setRComment(e.target.value)} rows={3} placeholder="Khana kaisa hai? Paani, bijli, warden, safai… sach likho, dusre students ki madad hogi." />
        <button className="btn" style={{ marginTop: 12 }} onClick={async () => {
          if (!rName.trim() || !rComment.trim()) return props.showToast('Naam aur comment dono daalein')
          await props.onReview(p.id, rName.trim(), rStars, rComment.trim())
          setRComment('')
          props.showToast('Review publish ho gaya — dhanyavaad!')
        }}>Review Publish Karo</button>
      </div>
    </div>
  )
}

/* ---------------- Login / Signup hub: User • PG Admin • Super Admin ---------------- */
function AuthHub(props: {
  mode: 'login' | 'signup'; portal: 'user' | 'owner' | 'admin'
  onClose: () => void; onSwitch: (m: 'login' | 'signup', portal: 'user' | 'owner' | 'admin') => void
  onSubmit: (mode: 'login' | 'signup', d: { name: string; phone: string; email: string; password: string; role: Role }) => void
  adminAccountConfigured: boolean
  onAdminLogin: (username: string, password: string) => void
  onGoAdminSetup: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [adminId, setAdminId] = useState('')
  const [busy, setBusy] = useState(false)
  const portal = props.portal
  const role: Role = portal === 'owner' ? 'owner' : 'tenant'

  const portalBtn = (key: 'user' | 'owner' | 'admin', label: string, icon: React.ReactNode) => (
    <button type="button" key={key} className={`${portal === key ? 'active' : ''} ${key === 'admin' ? 'portal-admin-btn' : ''}`.trim()} onClick={() => props.onSwitch(props.mode, key)}>
      {icon} {label}
    </button>
  )

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="sheet auth-sheet" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Login ya Sign Up">
        <div className="grab-handle" aria-hidden="true" />
        <div className="auth-brand">
          <img src="/logo.png" alt="StayHazaribagh logo" width={56} height={56} />
          <span>StayHazaribagh<em>.</em></span>
        </div>
        <div className="sheet-head">
          <h2 style={{ margin: 0 }}>{portal === 'admin' ? 'Super Admin Login' : props.mode === 'login' ? 'Login karo' : 'Free account banao'}</h2>
          <button className="close-btn" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {/* Three clear entrances */}
        <label>Main kaun hoon?</label>
        <div className="portal-switch" role="group" aria-label="Aap kaun hain">
          {portalBtn('user', 'User', <UserRound size={15} />)}
          {portalBtn('owner', 'PG Admin', <Building2 size={15} />)}
          {portalBtn('admin', 'Super Admin', <Crown size={15} />)}
        </div>

        {portal === 'admin' ? (
          <>
            <p className="muted small">Super Admin ka account pehli baar <b>Admin panel se</b> banaya jata hai — yahan public signup nahi hai, taaki koi aur aapka admin account claim na kar sake. Password sirf salted hash ke roop me save hota hai, session 30 din tak rahega.</p>
            {!props.adminAccountConfigured ? (
              <div className="panel" style={{ background: '#fef3c7' }}>
                <b>Super Admin account abhi set nahi hai</b>
                <p className="small" style={{ margin: '6px 0 0' }}>Pehle Admin panel kholo aur apni Super Admin ID + password banao. Uske baad yahin se login hoga.</p>
                <button className="btn btn-orange" style={{ marginTop: 12 }} onClick={props.onGoAdminSetup}>Admin Panel Kholo — Account Set Karo</button>
              </div>
            ) : (
              <>
                <label>Super Admin ID</label>
                <input value={adminId} onChange={(e) => setAdminId(e.target.value)} placeholder="Jaise — gautam-admin" autoCapitalize="none" autoCorrect="off" />
                <label>Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Super Admin password" />
                <button className="btn btn-orange" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} disabled={busy}
                  onClick={async () => { setBusy(true); await props.onAdminLogin(adminId.trim(), password); setBusy(false) }}>
                  {busy ? 'Ruko…' : 'Super Admin Login Karo'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <p className="muted small">{portal === 'owner' ? 'Makan Malik — apne PGs, tenants, rent aur enquiries manage karo.' : 'Tenant — apni enquiries, bookings aur complaints dekho.'} Password sirf salted hash ke roop me save hota hai — plain text me kabhi nahi. Session 30 din tak rahega.</p>
            <div className="segmented" role="group" aria-label="Login ya Sign Up">
              <button type="button" className={props.mode === 'login' ? 'active' : ''} onClick={() => props.onSwitch('login', portal)}>Login</button>
              <button type="button" className={props.mode === 'signup' ? 'active' : ''} onClick={() => props.onSwitch('signup', portal)}>Sign Up</button>
            </div>
            {props.mode === 'signup' && (
              <>
                <div style={{ marginTop: 14 }}><span className="chip active">{portal === 'owner' ? 'Main PG Owner Hoon' : 'PG Dhoondhna Hai'}</span></div>
                <label>Apna naam</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jaise — Gautam Keshri" />
              </>
            )}
            <label>WhatsApp number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" inputMode="tel" />
            {props.mode === 'signup' && (
              <>
                <label>Email (optional)</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aap@example.com" inputMode="email" />
              </>
            )}
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Kam se kam 4 character" />
            <button className="btn btn-orange" style={{ width: '100%', justifyContent: 'center', marginTop: 18 }} disabled={busy}
              onClick={async () => { setBusy(true); await props.onSubmit(props.mode, { name, phone, email, password, role }); setBusy(false) }}>
              {busy ? 'Ruko…' : props.mode === 'login' ? 'Login Karo' : 'Account Banao — Free'}
            </button>
            <p style={{ textAlign: 'center' }}>
              <button className="btn-ghost btn btn-sm" onClick={() => props.onSwitch(props.mode === 'login' ? 'signup' : 'login', portal)}>
                {props.mode === 'login' ? 'Naya account banao — Sign Up' : 'Pehle se account hai? Login karo'}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------------- List PG wizard (4 steps) ---------------- */
function ListPGWizard(props: {
  db: DB; sessionUser: User | null; onClose: () => void; showToast: (m: string) => void
  onCreate: (p: Property) => void | Promise<void>
}) {
  const [step, setStep] = useState(1)
  const [city, setCity] = useState<City>('Hazaribagh')
  const [name, setName] = useState('')
  const [locality, setLocality] = useState('Matwari')
  const [address, setAddress] = useState('')
  const [gender, setGender] = useState<Gender>('Boys')
  const [rent, setRent] = useState('')
  const [deposit, setDeposit] = useState('')
  const [totalBeds, setTotalBeds] = useState('')
  const [avail, setAvail] = useState('')
  const [sharing, setSharing] = useState('Double')
  const [food, setFood] = useState(true)
  const [foodNote, setFoodNote] = useState('')
  const [facs, setFacs] = useState<string[]>(['Wi-Fi', 'RO Paani'])
  const [rules, setRules] = useState('Gate time raat 9 baje. Shor nahi.')
  const [ownerPhone, setOwnerPhone] = useState(props.sessionUser?.phone || '')

  useEffect(() => { setLocality(LOCALITIES[city][0]) }, [city])

  async function submit() {
    const ph = ownerPhone.replace(/\D/g, '').slice(-10)
    const r = Number(rent), d = Number(deposit), tb = Number(totalBeds), av = Number(avail)
    if (!name.trim() || !address.trim()) return props.showToast('PG ka naam aur address daalein')
    if (ph.length !== 10) return props.showToast('Sahi 10-digit WhatsApp number daalein')
    if (!r || !tb || av < 0 || av > tb) return props.showToast('Rent, total beds aur available beds sahi daalein')
    await props.onCreate({
      id: uid(), ownerId: props.sessionUser?.id || 'guest', ownerPhone: ph, name: name.trim(), city,
      locality, address: address.trim(), gender, rent: r, deposit: d || 0, foodIncluded: food,
      foodNote: foodNote.trim() || undefined, totalBeds: tb, availableBeds: av, sharing,
      facilities: facs, rules: rules.trim(), verified: false, createdAt: new Date().toISOString(),
    })
  }

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="List PG free">
        <div className="sheet-head">
          <div><h2 style={{ margin: 0 }}>Apna PG FREE List Karein</h2>
            <p className="muted small">Listing turant live hogi — <b>Not Verified</b> badge ke saath. Admin verify karega, tabhi Verified lagega.</p></div>
          <button className="close-btn" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="steps">
          {['PG Details', 'Rent & Beds', 'Facilities', 'Contact'].map((s, i) => (
            <span key={s} className={step === i + 1 ? 'on' : ''}>{i + 1}. {s}</span>
          ))}
        </div>

        {step === 1 && (<>
          <label>PG / Hostel ka naam</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jaise — Shanti Boys PG" />
          <label>City</label>
          <div className="segmented">
            {(['Hazaribagh', 'Ranchi'] as City[]).map((c) => (
              <button key={c} type="button" className={city === c ? 'active' : ''} onClick={() => setCity(c)}>{c}</button>
            ))}
          </div>
          <label>Locality</label>
          <select value={locality} onChange={(e) => setLocality(e.target.value)}>
            {LOCALITIES[city].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <label>Poora address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Gali / landmark — jaise Korrah Road, near Jhanda Chowk" />
          <label>Kaun ke liye</label>
          <div className="segmented">
            {(['Boys', 'Girls', 'Co-ed'] as Gender[]).map((g) => (
              <button key={g} type="button" className={gender === g ? 'active' : ''} onClick={() => setGender(g)}>{g}</button>
            ))}
          </div>
        </>)}

        {step === 2 && (<>
          <label>Monthly rent per bed (₹)</label>
          <input value={rent} onChange={(e) => setRent(e.target.value)} placeholder="Jaise — 2500" inputMode="numeric" />
          <label>Deposit (₹) — 0 bhi chalega</label>
          <input value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="Jaise — 2500" inputMode="numeric" />
          <label>Total beds</label>
          <input value={totalBeds} onChange={(e) => setTotalBeds(e.target.value)} placeholder="Jaise — 20" inputMode="numeric" />
          <label>Available beds (khali bed)</label>
          <input value={avail} onChange={(e) => setAvail(e.target.value)} placeholder="Jaise — 6" inputMode="numeric" />
          <label>Sharing</label>
          <select value={sharing} onChange={(e) => setSharing(e.target.value)}>
            <option>Single</option><option>Double</option><option>Triple</option><option>Single / Double</option><option>Single / Double / Triple</option>
          </select>
          <label>Mess / Khana</label>
          <div className="segmented">
            <button type="button" className={food ? 'active' : ''} onClick={() => setFood(true)}>Mess hai</button>
            <button type="button" className={!food ? 'active' : ''} onClick={() => setFood(false)}>Mess nahi hai</button>
          </div>
          {food && (<><label>Khane ke baare me (timing / veg)</label><input value={foodNote} onChange={(e) => setFoodNote(e.target.value)} placeholder="Jaise — Veg, subah 8 aur shaam 7 baje" /></>)}
        </>)}

        {step === 3 && (<>
          <label>Facilities — jo hai, wohi tick karo</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {FACILITIES.map((f) => (
              <button key={f} type="button" className={`chip ${facs.includes(f) ? 'active' : ''}`}
                onClick={() => setFacs(facs.includes(f) ? facs.filter((x) => x !== f) : [...facs, f])}>{f}</button>
            ))}
          </div>
          <label>PG ke rules</label>
          <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={3} />
        </>)}

        {step === 4 && (<>
          <label>Apna WhatsApp number</label>
          <input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="10-digit number" inputMode="tel" />
          <p className="small muted">Yahi number aapka Owner Portal login bhi banega. Enquiry aane par tenant isi number par WhatsApp/call karega.</p>
          <div className="panel" style={{ background: '#fef3c7' }}>
            <b><ShieldAlert size={15} /> Listing Not Verified se start hogi</b>
            <p className="small" style={{ margin: '6px 0 0' }}>Galat ya fake listing par Super Admin listing hata sakta hai. Sahi rent, sahi beds aur sahi photos/details daalein — verification jaldi milegi.</p>
          </div>
        </>)}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Peeche</button>}
          {step < 4
            ? <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setStep(step + 1)}>Aage <ChevronRight size={17} /></button>
            : <button className="btn btn-orange" style={{ flex: 1, justifyContent: 'center' }} onClick={submit}><Check size={18} /> PG List Karo — FREE</button>}
        </div>
      </div>
    </div>
  )
}

/* ---------------- My Bookings (tenant) ---------------- */
function BookingsView(props: {
  db: DB; sessionUser: User | null; code: string; setCode: (s: string) => void
  phone: string; setPhone: (s: string) => void; onSelect: (p: Property) => void; onLogout: () => void
  onComplaint: (c: { id: string; propertyId: string; propertyName: string; tenantName: string; tenantPhone: string; text: string; status: 'Open' | 'In Progress' | 'Resolved'; createdAt: string }) => void
  showToast: (m: string) => void
  section: TenantSection; setSection: (s: TenantSection) => void
  savedIds: string[]; savedProps: Property[]; onToggleSave: (id: string) => void; userLoc: LatLng | null
}) {
  const { db, sessionUser } = props
  const [cText, setCText] = useState('')
  const [cProp, setCProp] = useState('')
  const myEnquiries = sessionUser
    ? db.enquiries.filter((e) => e.tenantPhone === sessionUser.phone)
    : db.enquiries.filter((e) => e.code === props.code && e.tenantPhone === props.phone.replace(/\D/g, '').slice(-10))
  const myComplaints = sessionUser ? db.complaints.filter((c) => c.tenantPhone === sessionUser.phone) : []
  const lookedUp = sessionUser ? true : props.code.length === 6 && myEnquiries.length > 0

  return (
    <section className="section container">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{props.section === 'saved' ? 'Saved PGs' : props.section === 'profile' ? 'Profile / My Account' : 'My Bookings'}</h2>
        {sessionUser && (
          <button className="btn btn-danger btn-sm logout-pill" onClick={props.onLogout} aria-label="Log out"><LogOut size={15} /> Logout</button>
        )}
      </div>
      <p className="muted">{props.section === 'saved'
        ? 'Heart dabake save kiye hue PG — yahan se seedha details kholo ya enquiry bhejo.'
        : props.section === 'profile'
          ? 'Aapka account — naam, WhatsApp number aur role.'
          : 'Apni enquiries ka status dekho — login karke, ya enquiry time mile private code se.'}</p>
      {props.section === 'saved' && (
        <>
          {props.savedProps.length === 0 && (
            <div className="empty"><Heart size={40} color="#0f4c4c" /><h3>Abhi koi PG save nahi hai</h3><p className="muted">Home par kisi PG card ke heart par tap karo — saved PG yahan dikhega.</p></div>
          )}
          <div className="grid">
            {props.savedProps.map((p, i) => <PropertyCard key={p.id} p={p} db={db} index={i} userLoc={props.userLoc} onSelect={props.onSelect} saved={props.savedIds.includes(p.id)} onToggleSave={props.onToggleSave} />)}
          </div>
        </>
      )}
      {props.section === 'profile' && (
        <div className="panel">
          {sessionUser ? (
            <>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <span className="avatar" style={{ width: 56, height: 56, fontSize: 24 }}>{sessionUser.name[0]?.toUpperCase()}</span>
                <div><b style={{ fontSize: 20 }}>{sessionUser.name}</b><br /><span className="muted small">{sessionUser.role === 'owner' ? 'Makan Malik' : 'Tenant'} • {sessionUser.phone}</span></div>
              </div>
              <table className="table" style={{ marginTop: 16 }}>
                <tbody>
                  <tr><td><b>Naam</b></td><td>{sessionUser.name}</td></tr>
                  <tr><td><b>WhatsApp number</b></td><td>{sessionUser.phone}</td></tr>
                  <tr><td><b>Email</b></td><td>{sessionUser.email || 'Not listed'}</td></tr>
                  <tr><td><b>Role</b></td><td>{sessionUser.role === 'owner' ? 'Makan Malik (Owner)' : 'Tenant (User)'}</td></tr>
                  <tr><td><b>Account bana</b></td><td>{timeAgo(sessionUser.createdAt)}</td></tr>
                </tbody>
              </table>
              <button className="btn btn-danger logout-pill" style={{ marginTop: 12 }} onClick={props.onLogout}><LogOut size={15} /> Logout</button>
            </>
          ) : (
            <div className="empty"><p>Profile dekhne ke liye pehle login karo.</p></div>
          )}
        </div>
      )}
      {props.section === 'bookings' && (
      <>
      {lookedUp && (
        <div className="stat-tiles">
          <div className="tile"><b>{myEnquiries.length}</b><span>Total enquiries</span></div>
          <div className="tile"><b>{myEnquiries.filter((e) => e.status === 'Booked').length}</b><span>Booked</span></div>
          <div className="tile"><b>{myEnquiries.filter((e) => e.status === 'Contacted' || e.status === 'Visit Scheduled').length}</b><span>In progress</span></div>
          <div className="tile"><b>{myComplaints.filter((c) => c.status === 'Open').length}</b><span>Open complaints</span></div>
        </div>
      )}
      {!sessionUser && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Enquiry code se status dekho</h3>
          <label>WhatsApp number</label>
          <input value={props.phone} onChange={(e) => props.setPhone(e.target.value)} placeholder="10-digit number" inputMode="tel" />
          <label>Enquiry code (6 letter)</label>
          <input value={props.code} onChange={(e) => props.setCode(e.target.value.toUpperCase())} placeholder="Jaise — JGCTAR" maxLength={6} style={{ letterSpacing: 3, textTransform: 'uppercase' }} />
          {props.code && !lookedUp && <p className="small" style={{ color: '#b3261e' }}>Is number + code se koi enquiry nahi mili. Code sahi daala hai?</p>}
        </div>
      )}
      {lookedUp && myEnquiries.length === 0 && <div className="empty"><p>Abhi koi enquiry nahi hai. Pehle kisi PG par <b>Book a Visit</b> karo.</p></div>}
      {myEnquiries.map((e) => (
        <div className="panel" key={e.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div><b>{e.propertyName}</b><br /><span className="muted small">{e.message} • {timeAgo(e.createdAt)}</span></div>
            <span className="badge badge-verified">{e.status}</span>
          </div>
          <p className="small muted">Enquiry code: <b>{e.code}</b></p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['New', 'Contacted', 'Visit Scheduled', 'Booked'] as const).map((s) => (
              <span key={s} className={`chip ${e.status === s ? 'active' : ''}`}>{s}</span>
            ))}
          </div>
        </div>
      ))}

      <h3 style={{ marginTop: 28 }}>Complaint likho</h3>
      <div className="panel">
        <label>Kaun sa PG</label>
        <select value={cProp} onChange={(e) => setCProp(e.target.value)}>
          <option value="">— PG chuno —</option>
          {db.properties.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.locality}</option>)}
        </select>
        <label>Complaint kya hai?</label>
        <textarea value={cText} onChange={(e) => setCText(e.target.value)} rows={3} placeholder="Jaise — paani subah nahi aata, khana thanda milta hai…" />
        <button className="btn" style={{ marginTop: 12 }} onClick={() => {
          if (!cProp || !cText.trim() || !sessionUser) return props.showToast('Login karke PG chun ke complaint likho')
          const p = db.properties.find((x) => x.id === cProp)!
          props.onComplaint({ id: uid(), propertyId: p.id, propertyName: p.name, tenantName: sessionUser.name, tenantPhone: sessionUser.phone, text: cText.trim(), status: 'Open', createdAt: new Date().toISOString() })
          setCText('')
          props.showToast('Complaint bhej di gayi — owner ko dikhegi.')
        }}>Complaint Bhejo</button>
        {myComplaints.map((c) => (
          <div className="review" key={c.id}><b>{c.propertyName}</b> — <span className="badge badge-verified">{c.status}</span><p style={{ margin: '6px 0 0' }}>{c.text}</p></div>
        ))}
      </div>
      </>
      )}
    </section>
  )
}

/* ---------------- Owner Portal (Makan Malik) ---------------- */
function OwnerView(props: {
  db: DB; sessionUser: User | null; update: (fn: (d: DB) => DB) => void; showToast: (m: string) => void
  apiIds: Set<string>; onApiBeds: (id: string, availableBeds: number) => Promise<boolean>
  onApiDelete: (id: string) => Promise<boolean>
  section: OwnerSection; setSection: (s: OwnerSection) => void
  // True right after a fresh password login/signup: the owner already proved
  // who they are, so the Portal PIN is not asked again for this session.
  freshLoginUnlocked?: boolean
  onAuth: () => void; onList: () => void; onLogout: () => void
}) {
  const { db, sessionUser } = props
  const tab = props.section
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinOk, setPinOk] = useState(props.freshLoginUnlocked ?? false)
  useEffect(() => { if (props.freshLoginUnlocked) setPinOk(true) }, [props.freshLoginUnlocked])
  const [tName, setTName] = useState('')
  const [tPhone, setTPhone] = useState('')
  const [tRoom, setTRoom] = useState('')
  const [tProp, setTProp] = useState('')

  const myProps = sessionUser ? db.properties.filter((p) => p.ownerPhone === sessionUser.phone || p.ownerId === sessionUser.id) : []
  const myIds = myProps.map((p) => p.id)
  const myEnquiries = db.enquiries.filter((e) => myIds.includes(e.propertyId))
  const myTenants = db.tenants.filter((t) => myIds.includes(t.propertyId))
  const myComplaints = db.complaints.filter((c) => myIds.includes(c.propertyId))
  const myReviews = db.reviews.filter((r) => myIds.includes(r.propertyId))
  const myAvg = myReviews.length ? (myReviews.reduce((s, r) => s + r.stars, 0) / myReviews.length).toFixed(1) : '—'
  const totalBeds = myProps.reduce((s, p) => s + p.totalBeds, 0)
  const availBeds = myProps.reduce((s, p) => s + p.availableBeds, 0)
  const dues = myTenants.reduce((s, t) => s + (t.rentPaid ? 0 : t.dueAmount), 0)
  const occPct = totalBeds ? Math.round(((totalBeds - availBeds) / totalBeds) * 100) : 0

  if (!sessionUser) {
    return (
      <section className="section container">
        <h2>Makan Malik Portal</h2>
        <p className="muted">Owner apne PGs manage karne ke liye pehle login karein — ya apne account se Sign Up karein (role: Main PG Owner Hoon).</p>
        <div className="empty">
          <Building2 size={40} color="#0f4c4c" />
          <h3>Login karke apna dashboard kholo</h3>
          <p className="muted">Beds, tenants, rent/dues, enquiries aur complaints — sab sirf aapke PGs ke liye.</p>
          <button className="btn btn-orange" onClick={props.onAuth}>Login / Sign Up Karo</button>
        </div>
      </section>
    )
  }
  if (sessionUser.role !== 'owner') {
    return (
      <section className="section container">
        <h2>Makan Malik Portal</h2>
        <div className="empty"><p>Aapka account tenant ka hai. Owner portal ke liye owner account se login karein.</p></div>
      </section>
    )
  }

  async function adjustBeds(p: Property, delta: number) {
    const next = p.availableBeds + delta
    if (next < 0 || next > p.totalBeds) return
    if (props.apiIds.has(p.id)) {
      // API listing: PATCH the backend, then reload — local update would
      // silently no-op because the id does not exist in localStorage.
      await props.onApiBeds(p.id, next)
      return
    }
    props.update((d) => { const x = d.properties.find((y) => y.id === p.id); if (x) x.availableBeds = next; return d })
  }

  async function deleteMyListing(p: Property) {
    if (!confirm(`"${p.name}" delete karna hai?`)) return
    if (props.apiIds.has(p.id)) {
      await props.onApiDelete(p.id)
      return
    }
    props.update((d) => { d.properties = d.properties.filter((y) => y.id !== p.id); return d })
  }

  async function checkPin() {
    if (!sessionUser!.pinHash) return props.showToast('Pehle neeche se apna Portal PIN set karo')
    const h = await hashSecret(pin, sessionUser!.salt)
    if (h === sessionUser!.pinHash) { setPinOk(true); props.showToast('PIN sahi hai — portal khul gaya.') }
    else props.showToast('Galat PIN')
  }
  async function setPinNow() {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) return props.showToast('4-digit PIN daalein (sirf number)')
    const h = await hashSecret(newPin, sessionUser!.salt)
    props.update((d) => { const u = d.users.find((x) => x.id === sessionUser!.id); if (u) u.pinHash = h; return d })
    setNewPin('')
    props.showToast('Portal PIN set ho gaya.')
  }

  return (
    <section className="section container">
      <h2>Namaste, {sessionUser.name} ji — Makan Malik Portal</h2>
      <p className="muted">Sirf aapke PGs — {myProps.length} PG • {totalBeds} beds • {availBeds} khali</p>

      {!sessionUser.pinHash ? (
        <div className="panel" style={{ background: '#fef3c7' }}>
          <b>Apna 4-digit Portal PIN set karo</b>
          <p className="small">Is PIN se aap bina password ke bhi apna portal khol sakte ho. PIN hashed save hota hai.</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="4-digit PIN" maxLength={4} inputMode="numeric" style={{ maxWidth: 180 }} />
            <button className="btn" onClick={setPinNow}>PIN Set Karo</button>
          </div>
        </div>
      ) : !pinOk ? (
        <div className="panel">
          <b>Portal PIN daalo (ya password login se aaye ho to bhi PIN chahiye)</b>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4-digit PIN" maxLength={4} inputMode="numeric" style={{ maxWidth: 180 }} />
            <button className="btn" onClick={checkPin}>Portal Kholo</button>
          </div>
        </div>
      ) : null}
      {pinOk && <p className="small" style={{ color: '#0e7a5f' }}><Check size={14} /> {props.freshLoginUnlocked ? 'Portal unlocked — password login se khula hai, PIN ki zaroorat nahi.' : 'Portal unlocked — PIN verified.'}</p>}

      {tab === 'dashboard' && (
        <>
          <div className="stat-tiles">
            <div className="tile"><b><CountUp to={myProps.length} /></b><span>Mere PGs</span></div>
            <div className="tile"><b>{occPct}%</b><span>Occupancy</span><div className="occ"><i style={{ width: `${occPct}%` }} /></div></div>
            <div className="tile"><b>{availBeds}</b><span>Khali beds</span></div>
            <div className="tile"><b>{inr(dues)}</b><span>Pending dues</span></div>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Aaj kya karein?</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-orange" onClick={props.onList}><Plus size={18} /> Naya PG List Karo — FREE</button>
              <button className="btn btn-ghost" onClick={() => props.setSection('Enquiries')}><MessageSquare size={16} /> Enquiries ({myEnquiries.filter((e) => e.status === 'New').length} new)</button>
              <button className="btn btn-ghost" onClick={() => props.setSection('Rent & Dues')}><Wallet size={16} /> Rent &amp; Dues — {inr(dues)} pending</button>
              <button className="btn btn-ghost" onClick={() => props.setSection('Complaints')}><ClipboardList size={16} /> Complaints ({myComplaints.filter((c) => c.status === 'Open').length} open)</button>
            </div>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Latest enquiries</h3>
            {myEnquiries.length === 0 && <p className="muted">Abhi koi enquiry nahi aayi. Apna PG share karo — WhatsApp groups, coaching ke bahar poster, VBU ke paas.</p>}
            {myEnquiries.slice(0, 3).map((e) => (
              <div className="review" key={e.id}><b>{e.tenantName}</b> <span className="muted">({e.tenantPhone})</span> — {e.propertyName} <span className="badge badge-verified">{e.status}</span></div>
            ))}
            {myEnquiries.length > 0 && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => props.setSection('Enquiries')}>Saari enquiries dekho</button>}
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Reviews — {myAvg} ★ ({myReviews.length})</h3>
            {myReviews.length === 0 && <p className="muted">Abhi aapke PGs par koi review nahi hai.</p>}
            {myReviews.slice(0, 3).map((r) => (
              <div className="review" key={r.id}><b>{r.author}</b> — <Star size={13} color="#f59e0b" fill="#f59e0b" /> {r.stars}<p style={{ margin: '6px 0 0' }}>{r.comment}</p></div>
            ))}
            {myReviews.length > 0 && <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => props.setSection('reviews')}>Saare reviews dekho</button>}
          </div>
        </>
      )}

      {tab === 'PGs' && (
        <>
          <button className="btn btn-orange" style={{ marginTop: 14 }} onClick={props.onList}><Plus size={18} /> Naya PG List Karo — FREE</button>
          {myProps.length === 0 && <div className="empty" style={{ marginTop: 14 }}><p>Abhi aapka koi PG listed nahi hai. Upar se pehla PG list karein.</p></div>}
          {myProps.map((p) => (
            <div className="panel" key={p.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><b>{p.name}</b> — {p.locality}, {p.city} {p.verified ? <span className="badge badge-verified"><ShieldCheck size={12} /> Verified</span> : <span className="badge badge-unverified"><ShieldAlert size={12} /> Not Verified</span>}<br />
                  <span className="muted small">{inr(p.rent)}/month • {p.gender} • {p.availableBeds}/{p.totalBeds} beds free</span></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-ghost stepper" aria-label="Bed kam karo" onClick={() => void adjustBeds(p, -1)}>−</button>
                  <b>{p.availableBeds}</b>
                  <button className="btn btn-ghost stepper" aria-label="Bed badhao" onClick={() => void adjustBeds(p, 1)}>+</button>
                  <button className="btn btn-danger btn-sm" onClick={() => void deleteMyListing(p)}>Delete</button>
                </div>
              </div>
              <div className="occ"><i style={{ width: `${occupancy(p)}%` }} /></div>
            </div>
          ))}
        </>
      )}

      {tab === 'Enquiries' && (
        <div className="panel">
          {myEnquiries.length === 0 && <p className="muted">Abhi koi enquiry nahi aayi. Apna PG share karo — WhatsApp groups, coaching ke bahar poster, VBU ke paas.</p>}
          {myEnquiries.map((e) => (
            <div className="review" key={e.id}>
              <b>{e.tenantName}</b> <span className="muted">({e.tenantPhone})</span> — {e.propertyName}
              <p style={{ margin: '6px 0' }}>{e.message}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={e.status} style={{ maxWidth: 200 }} onChange={(ev) => props.update((d) => { const x = d.enquiries.find((y) => y.id === e.id); if (x) x.status = ev.target.value as Enquiry['status']; return d })}>
                  {(['New', 'Contacted', 'Visit Scheduled', 'Booked', 'Closed'] as const).map((s) => <option key={s}>{s}</option>)}
                </select>
                <a className="btn btn-ghost btn-sm" href={`https://wa.me/91${e.tenantPhone}`} target="_blank" rel="noreferrer"><MessageSquare size={14} /> WhatsApp</a>
                <span className="small muted">Code: {e.code}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Tenants' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Tenant add karo</h3>
          <div className="form-grid-2">
            <select value={tProp} onChange={(e) => setTProp(e.target.value)}>
              <option value="">— PG chuno —</option>
              {myProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="Tenant ka naam" />
            <input value={tPhone} onChange={(e) => setTPhone(e.target.value)} placeholder="Tenant phone" inputMode="tel" />
            <input value={tRoom} onChange={(e) => setTRoom(e.target.value)} placeholder="Room / Bed — jaise Room 3, Bed B" />
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => {
            if (!tProp || !tName.trim()) return props.showToast('PG aur tenant ka naam daalein')
            const p = myProps.find((x) => x.id === tProp)!
            props.update((d) => {
              d.tenants.push({ id: uid(), propertyId: p.id, name: tName.trim(), phone: tPhone.replace(/\D/g, '').slice(-10), room: tRoom || '—', bed: tRoom || '—', rent: p.rent, rentPaid: false, dueAmount: p.rent, kycDone: false, joinedAt: new Date().toISOString() })
              const x = d.properties.find((y) => y.id === p.id); if (x && x.availableBeds > 0) x.availableBeds -= 1
              return d
            })
            setTName(''); setTPhone(''); setTRoom('')
            props.showToast('Tenant add ho gaya — bed count update ho gaya.')
          }}>Tenant Add Karo</button>
          <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="table">
            <thead><tr><th>Tenant</th><th>Room</th><th>Rent</th><th>KYC</th></tr></thead>
            <tbody>{myTenants.map((t) => (
              <tr key={t.id}><td>{t.name}<br /><span className="muted small">{t.phone}</span></td><td>{t.room}</td><td>{inr(t.rent)}</td>
                <td><button className="chip" onClick={() => props.update((d) => { const x = d.tenants.find((y) => y.id === t.id); if (x) x.kycDone = !x.kycDone; return d })}>{t.kycDone ? '✓ Done' : 'Pending'}</button></td></tr>
            ))}</tbody>
          </table>
          </div>
          {myTenants.length === 0 && <p className="muted">Abhi koi tenant add nahi hai.</p>}
        </div>
      )}

      {tab === 'Rent & Dues' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}><Wallet size={18} /> Rent &amp; Dues — {inr(dues)} pending</h3>
          <p className="muted small">UPI ya cash — payment milte hi Paid mark karo, aur tenant ko WhatsApp par receipt bhej do.</p>
          {myTenants.length === 0 && <p className="muted">Pehle Tenants tab se tenant add karo.</p>}
          {myTenants.map((t) => (
            <div className="review" key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div><b>{t.name}</b> — {inr(t.rent)}/month<br /><span className="muted small">{t.rentPaid ? 'Is mahine ka rent mil gaya ✓' : `Due: ${inr(t.dueAmount)}`}</span></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => props.update((d) => { const x = d.tenants.find((y) => y.id === t.id); if (x) { x.rentPaid = true; x.dueAmount = 0 } return d })}>Paid Mark Karo</button>
                <a className="btn btn-ghost btn-sm" href={`https://wa.me/91${t.phone}?text=${encodeURIComponent(`Namaste ${t.name}, is mahine ka rent ${inr(t.rent)} due hai. UPI ya cash se bhej dein. — StayHazaribagh`)}`} target="_blank" rel="noreferrer">Reminder Bhejo</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Complaints' && (
        <div className="panel">
          {myComplaints.length === 0 && <p className="muted">Koi complaint nahi hai — achhi baat hai!</p>}
          {myComplaints.map((c) => (
            <div className="review" key={c.id}>
              <b>{c.tenantName}</b> — {c.propertyName}
              <p style={{ margin: '6px 0' }}>{c.text}</p>
              <select value={c.status} style={{ maxWidth: 200 }} onChange={(e) => props.update((d) => { const x = d.complaints.find((y) => y.id === c.id); if (x) x.status = e.target.value as 'Open' | 'In Progress' | 'Resolved'; return d })}>
                <option>Open</option><option>In Progress</option><option>Resolved</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {tab === 'reviews' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}><Star size={18} /> Mere PGs ke reviews — {myAvg} ★ ({myReviews.length})</h3>
          {myReviews.length === 0 && <p className="muted">Abhi aapke PGs par koi review nahi hai. Tenant site par review likhte hain — achha service do, review apne aap aayega.</p>}
          {myReviews.map((r) => {
            const p = myProps.find((x) => x.id === r.propertyId)
            return (
              <div className="review" key={r.id}>
                <b>{r.author}</b> — {p?.name ?? 'PG'} — <Star size={13} color="#f59e0b" fill="#f59e0b" /> {r.stars}
                <p style={{ margin: '6px 0 0' }}>{r.comment}</p>
                <span className="small muted">{timeAgo(r.createdAt)}</span>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'profile' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Profile / Settings</h3>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span className="avatar" style={{ width: 56, height: 56, fontSize: 24 }}>{sessionUser.name[0]?.toUpperCase()}</span>
            <div><b style={{ fontSize: 20 }}>{sessionUser.name}</b><br /><span className="muted small">Makan Malik • {sessionUser.phone}</span></div>
          </div>
          <table className="table" style={{ marginTop: 16 }}>
            <tbody>
              <tr><td><b>Naam</b></td><td>{sessionUser.name}</td></tr>
              <tr><td><b>WhatsApp number</b></td><td>{sessionUser.phone}</td></tr>
              <tr><td><b>Email</b></td><td>{sessionUser.email || 'Not listed'}</td></tr>
              <tr><td><b>Mere PGs</b></td><td>{myProps.length} PG • {totalBeds} beds • {availBeds} khali</td></tr>
              <tr><td><b>Portal PIN</b></td><td>{sessionUser.pinHash ? 'Set hai ✓' : 'Abhi set nahi hai'}</td></tr>
              <tr><td><b>Account bana</b></td><td>{timeAgo(sessionUser.createdAt)}</td></tr>
            </tbody>
          </table>
          <h4>Portal PIN badlo</h4>
          <p className="small muted">4-digit PIN — bina password ke bhi portal kholne ke liye. PIN hashed save hota hai.</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="Naya 4-digit PIN" maxLength={4} inputMode="numeric" style={{ maxWidth: 180 }} />
            <button className="btn" onClick={setPinNow}>PIN Set / Badlo</button>
          </div>
          <button className="btn btn-danger logout-pill" style={{ marginTop: 16 }} onClick={props.onLogout}><LogOut size={15} /> Logout</button>
        </div>
      )}
    </section>
  )
}

/* ---------------- Super Admin ---------------- */
function AdminView(props: {
  db: DB; update: (fn: (d: DB) => DB) => void; showToast: (m: string) => void
  unlocked: boolean; setUnlocked: (b: boolean) => void
  adminSessionUser: { id: string; username: string } | null
  onAdminLogout: () => void
  apiIds: Set<string>; onApiVerify: (id: string, verified: boolean) => Promise<boolean>
  onApiDelete: (id: string) => Promise<boolean>
  section: AdminSection; setSection: (s: AdminSection) => void
  onOpenAuth: (portal: 'user' | 'owner' | 'admin') => void
}) {
  const { db } = props
  const [pass, setPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newOwnerPin, setNewOwnerPin] = useState('')
  const [pinOwnerPhone, setPinOwnerPhone] = useState('')
  const [adminId, setAdminId] = useState('')
  const [adminPass, setAdminPass] = useState('')
  const [adminPass2, setAdminPass2] = useState('')

  const hzb = db.properties.filter((p) => p.city === 'Hazaribagh')
  const rnc = db.properties.filter((p) => p.city === 'Ranchi')
  const owners = db.users.filter((u) => u.role === 'owner')
  const tenants = db.users.filter((u) => u.role === 'tenant')
  const isAdminIn = !!props.adminSessionUser || props.unlocked
  const verifiedList = db.properties.filter((p) => p.verified)
  const unverifiedList = db.properties.filter((p) => !p.verified)

  /** One listing row with Verify / Delete — reused by All / Verified / Unverified sections. */
  function listingRow(p: Property) {
    return (
      <div className="review" key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}><b>{p.name}</b> — {p.locality}, {p.city} • {inr(p.rent)} • {p.availableBeds}/{p.totalBeds} beds<br />
          <span className="muted small">Owner: {p.ownerPhone} • {timeAgo(p.createdAt)}</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={async () => {
            if (props.apiIds.has(p.id)) {
              await props.onApiVerify(p.id, !p.verified)
              return
            }
            props.update((d) => { const x = d.properties.find((y) => y.id === p.id); if (x) x.verified = !x.verified; return d })
          }}>
            {p.verified ? 'Unverify Karo' : 'Verify Karo ✓'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={async () => {
            if (!confirm(`"${p.name}" delete karna hai?`)) return
            if (props.apiIds.has(p.id)) {
              await props.onApiDelete(p.id)
              return
            }
            props.update((d) => { d.properties = d.properties.filter((y) => y.id !== p.id); return d })
          }}>Delete</button>
        </div>
      </div>
    )
  }

  async function setupAdminAccount() {
    if (db.adminAccount) return props.showToast('Super Admin account pehle se set hai — login karo')
    const username = adminId.trim().toLowerCase()
    if (username.length < 4 || !/^[a-z0-9._-]+$/.test(username)) return props.showToast('Super Admin ID kam se kam 4 character ki ho — sirf a-z, 0-9, . _ -')
    if (adminPass.length < 6) return props.showToast('Password kam se kam 6 character ka ho')
    if (adminPass !== adminPass2) return props.showToast('Dono password match nahi kar rahe')
    // API mode: create the admin on the backend (once only). A 409 means
    // the server already has an admin — log in instead. Network failure
    // falls through to the local setup below.
    if (apiConfigured()) {
      try {
        const res = await adminSetup({ admin_id: username, password: adminPass })
        const token = res.access_token ?? res.token ?? ''
        if (token) setAdminToken(token)
        const salt = randomSalt()
        const passwordHash = await hashSecret(adminPass, salt)
        const acc = { id: uid(), username, salt, passwordHash, createdAt: new Date().toISOString() }
        props.update((d) => { d.adminAccount = acc; d.adminSession = { adminId: acc.id, expiresAt: Date.now() + 30 * 86400000 }; return d })
        props.setUnlocked(true)
        setAdminPass(''); setAdminPass2('')
        props.showToast(`Super Admin account ban gaya — ID: ${username}. Ise kisi ko mat batana.`)
        return
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          props.showToast('Super Admin account pehle se set hai — login karo')
          return
        }
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          props.showToast(err.message)
          return
        }
        // Network / 5xx — fall through to local setup below.
      }
    }
    const salt = randomSalt()
    const passwordHash = await hashSecret(adminPass, salt)
    const acc = { id: uid(), username, salt, passwordHash, createdAt: new Date().toISOString() }
    props.update((d) => { d.adminAccount = acc; d.adminSession = { adminId: acc.id, expiresAt: Date.now() + 30 * 86400000 }; return d })
    props.setUnlocked(true)
    setAdminPass(''); setAdminPass2('')
    props.showToast(`Super Admin account ban gaya — ID: ${username}. Ise kisi ko mat batana.`)
  }

  async function setPasscode() {
    if (newPass.length < 4) return props.showToast('Passcode kam se kam 4 character ka ho')
    const salt = randomSalt()
    const hash = await hashSecret(newPass, salt)
    props.update((d) => { d.settings.adminPasscodeHash = hash; d.settings.adminSalt = salt; return d })
    setNewPass('')
    props.showToast('Super Admin passcode set ho gaya. Ise kisi ko mat batana.')
  }
  async function unlock() {
    if (!db.settings.adminPasscodeHash || !db.settings.adminSalt) return
    const h = await hashSecret(pass, db.settings.adminSalt)
    if (h === db.settings.adminPasscodeHash) { props.setUnlocked(true); setPass(''); props.showToast('Super Admin khul gaya.') }
    else props.showToast('Galat passcode')
  }
  async function setOwnerPin() {
    const ph = pinOwnerPhone.replace(/\D/g, '').slice(-10)
    if (ph.length !== 10 || newOwnerPin.length !== 4) return props.showToast('Sahi owner number aur 4-digit PIN daalein')
    const owner = db.users.find((u) => u.phone === ph && u.role === 'owner')
    if (!owner) return props.showToast('Is number ka owner account nahi mila')
    const h = await hashSecret(newOwnerPin, owner.salt)
    props.update((d) => { const u = d.users.find((x) => x.id === owner.id); if (u) u.pinHash = h; return d })
    setNewOwnerPin(''); setPinOwnerPhone('')
    props.showToast(`Owner PIN set/reset ho gaya (${ph})`)
  }

  // Step 1 — no admin account yet: owner creates the Super Admin ID + password ONCE here.
  if (!db.adminAccount && !db.settings.adminPasscodeHash) {
    return (
      <section className="section container">
        <h2>Super Admin Panel</h2>
        <div className="empty">
          <ShieldCheck size={40} color="#0f4c4c" />
          <h3>Pehli baar? Apni Super Admin ID + password banao</h3>
          <p className="muted">Ye account sirf aap (site owner) ke liye hai — ek baar ban gaya to koi aur ise claim nahi kar sakta. Iske baad kisi bhi browser se isi ID + password se login hoga. Password sirf salted hash ke roop me save hota hai — koi preset ID/password nahi hai.</p>
          <div style={{ maxWidth: 420, margin: '0 auto', textAlign: 'left' }}>
            <label>Super Admin ID</label>
            <input value={adminId} onChange={(e) => setAdminId(e.target.value)} placeholder="Jaise — gautam-admin" autoCapitalize="none" autoCorrect="off" />
            <label>Password</label>
            <input type="password" value={adminPass} onChange={(e) => setAdminPass(e.target.value)} placeholder="Kam se kam 6 character" />
            <label>Password dobara</label>
            <input type="password" value={adminPass2} onChange={(e) => setAdminPass2(e.target.value)} placeholder="Password dobara daalein" />
            <button className="btn btn-orange" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={setupAdminAccount}><KeyRound size={17} /> Super Admin Account Banao</button>
          </div>
          <p className="small muted" style={{ marginTop: 18 }}>Ya purana tareeka — staff passcode set karo:</p>
          <div style={{ display: 'flex', gap: 10, maxWidth: 420, margin: '0 auto' }}>
            <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Staff passcode — kam se kam 4 character" />
            <button className="btn btn-ghost" onClick={setPasscode}>Set Karo</button>
          </div>
        </div>
      </section>
    )
  }

  // Step 2 — account exists but not logged in: ID + password login (passcode fallback below).
  if (!isAdminIn) {
    return (
      <section className="section container">
        <h2>Super Admin Panel</h2>
        <div className="empty">
          <ShieldCheck size={40} color="#0f4c4c" />
          <h3>Super Admin Login</h3>
          <p className="muted">Apni Super Admin ID + password se login karo — kisi bhi browser se. Session 30 din tak rahega. Login hub me Super Admin chuno, phir apni ID + password daalo.</p>
          <button className="btn btn-orange" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
            onClick={() => props.onOpenAuth('admin')}>Super Admin Login Kholo</button>
          {db.settings.adminPasscodeHash && (
            <>
              <p className="small muted" style={{ marginTop: 18 }}>Ya staff passcode se kholo (fallback):</p>
              <div style={{ display: 'flex', gap: 10, maxWidth: 420, margin: '0 auto' }}>
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Staff passcode" />
                <button className="btn btn-orange" onClick={unlock}>Kholo</button>
              </div>
            </>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="section container">
      <div className="admin-dark">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ marginTop: 0, color: '#fff' }}>Super Admin — Control Room</h2>
          {props.adminSessionUser && (
            <span className="account-chip admin-chip" style={{ background: '#123232', borderColor: '#1e4a4a', color: '#e6f4f0' }}>
              <span className="avatar" style={{ background: '#b45309' }}><Crown size={15} /></span>
              <span className="account-name">Admin: {props.adminSessionUser.username}</span>
              <button className="btn btn-danger btn-sm logout-pill" onClick={props.onAdminLogout} aria-label="Super Admin log out"><LogOut size={15} /> Logout</button>
            </span>
          )}
        </div>
        <p className="muted" style={{ color: '#9fc4bb' }}>Platform ki poori jaankari ek jagah. Listing verify/delete, owners aur PIN — sab yahin se.</p>

        {props.section === 'dashboard' && (
          <>
            <div className="stat-tiles">
              <div className="tile" style={{ background: '#123232', borderColor: '#1e4a4a', color: '#e6f4f0' }}><b>{db.properties.length}</b><span>Total PGs</span></div>
              <div className="tile" style={{ background: '#123232', borderColor: '#1e4a4a', color: '#e6f4f0' }}><b>{db.properties.filter((p) => p.verified).length}</b><span>Verified</span></div>
              <div className="tile" style={{ background: '#123232', borderColor: '#1e4a4a', color: '#e6f4f0' }}><b>{db.users.length}</b><span>Users ({owners.length} owners)</span></div>
              <div className="tile" style={{ background: '#123232', borderColor: '#1e4a4a', color: '#e6f4f0' }}><b>{db.enquiries.length}</b><span>Enquiries</span></div>
            </div>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Hazaribagh vs Ranchi</h3>
              <p>Hazaribagh: <b>{hzb.length}</b> PGs • Ranchi: <b>{rnc.length}</b> PGs</p>
              <div className="occ"><i style={{ width: `${db.properties.length ? (hzb.length / db.properties.length) * 100 : 0}%` }} /></div>
              <p className="small muted">Hazaribagh share — {db.properties.length ? Math.round((hzb.length / db.properties.length) * 100) : 0}%</p>
            </div>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Aaj kya karein?</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-orange" onClick={() => props.setSection('unverified')}><ShieldAlert size={16} /> Verify Queue — {unverifiedList.length} pending</button>
                <button className="btn btn-ghost" onClick={() => props.setSection('owners')}><Users size={16} /> Owners ({owners.length})</button>
                <button className="btn btn-ghost" onClick={() => props.setSection('enquiries')}><MessageSquare size={16} /> Enquiries ({db.enquiries.length})</button>
                <button className="btn btn-ghost" onClick={() => props.setSection('complaints')}><ClipboardList size={16} /> Complaints ({db.complaints.filter((c) => c.status === 'Open').length} open)</button>
              </div>
            </div>
          </>
        )}

        {(props.section === 'all' || props.section === 'verified' || props.section === 'unverified') && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>
              {props.section === 'all' ? 'All PGs — Verify / Delete'
                : props.section === 'verified' ? `Verified PGs (${verifiedList.length})`
                : `Unverified PGs — Verify Queue (${unverifiedList.length})`}
            </h3>
            {props.section === 'unverified' && <p className="muted small">Ye listings public Google Maps / OLX se aayi hain ya owner ne list ki hain — jaanch karke Verify Karo dabao, tabhi Verified badge lagega.</p>}
            {props.section === 'all' && db.properties.length === 0 && <p className="muted">Abhi koi listing nahi hai. Pehla owner List PG karega, tab yahan aayega.</p>}
            {props.section === 'verified' && verifiedList.length === 0 && <p className="muted">Abhi koi Verified PG nahi hai — Unverified tab se verify karo.</p>}
            {props.section === 'unverified' && unverifiedList.length === 0 && <p className="muted">Saare PG verified hain — koi pending nahi hai. 🎉</p>}
            {(props.section === 'all' ? db.properties : props.section === 'verified' ? verifiedList : unverifiedList).map((p) => listingRow(p))}
          </div>
        )}

        {props.section === 'owners' && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Owners Directory</h3>
            {owners.length === 0 && <p className="muted">Abhi koi owner account nahi hai.</p>}
            <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Owner</th><th>Phone</th><th>PGs</th><th>PIN</th></tr></thead>
              <tbody>{owners.map((o) => (
                <tr key={o.id}><td>{o.name}</td><td>{o.phone}</td><td>{db.properties.filter((p) => p.ownerPhone === o.phone).length}</td><td>{o.pinHash ? 'Set hai' : 'Nahi set'}</td></tr>
              ))}</tbody>
            </table>
            </div>
            <h4>Owner PIN set / reset karo</h4>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input value={pinOwnerPhone} onChange={(e) => setPinOwnerPhone(e.target.value)} placeholder="Owner WhatsApp number" style={{ maxWidth: 220 }} inputMode="tel" />
              <input value={newOwnerPin} onChange={(e) => setNewOwnerPin(e.target.value)} placeholder="Naya 4-digit PIN" maxLength={4} style={{ maxWidth: 160 }} inputMode="numeric" />
              <button className="btn" onClick={setOwnerPin}>PIN Set / Reset</button>
            </div>
          </div>
        )}

        {props.section === 'users' && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Users / Tenants ({db.users.length})</h3>
            {db.users.length === 0 && <p className="muted">Abhi koi user account nahi hai.</p>}
            <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>PGs / Enquiries</th></tr></thead>
              <tbody>{db.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td><td>{u.phone}</td><td>{u.role === 'owner' ? 'Makan Malik' : 'Tenant'}</td>
                  <td>{u.role === 'owner'
                    ? `${db.properties.filter((p) => p.ownerPhone === u.phone).length} PGs`
                    : `${db.enquiries.filter((e) => e.tenantPhone === u.phone).length} enquiries`}</td>
                </tr>
              ))}</tbody>
            </table>
            </div>
            <p className="small muted">Tenants: {tenants.length} • Owners: {owners.length}</p>
          </div>
        )}

        {props.section === 'enquiries' && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Saari Enquiries ({db.enquiries.length})</h3>
            {db.enquiries.length === 0 && <p className="muted">Abhi koi enquiry nahi aayi.</p>}
            {db.enquiries.map((e) => (
              <div className="review" key={e.id}>
                <b>{e.tenantName}</b> <span className="muted">({e.tenantPhone})</span> — {e.propertyName}
                <p style={{ margin: '6px 0' }}>{e.message}</p>
                <span className="badge badge-verified">{e.status}</span> <span className="small muted">Code: {e.code} • {timeAgo(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        {props.section === 'reviews' && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Saare Reviews ({db.reviews.length})</h3>
            {db.reviews.length === 0 && <p className="muted">Abhi koi review nahi likha gaya.</p>}
            {db.reviews.map((r) => {
              const p = db.properties.find((x) => x.id === r.propertyId)
              return (
                <div className="review" key={r.id}>
                  <b>{r.author}</b> — {p?.name ?? 'PG'} — <Star size={13} color="#f59e0b" fill="#f59e0b" /> {r.stars}
                  <p style={{ margin: '6px 0 0' }}>{r.comment}</p>
                  <span className="small muted">{timeAgo(r.createdAt)}</span>
                </div>
              )
            })}
          </div>
        )}

        {props.section === 'complaints' && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Saari Complaints ({db.complaints.length})</h3>
            {db.complaints.length === 0 && <p className="muted">Koi complaint nahi hai.</p>}
            {db.complaints.map((c) => (
              <div className="review" key={c.id}>
                <b>{c.tenantName}</b> <span className="muted">({c.tenantPhone})</span> — {c.propertyName}
                <p style={{ margin: '6px 0' }}>{c.text}</p>
                <span className="badge badge-verified">{c.status}</span> <span className="small muted">{timeAgo(c.createdAt)}</span>
              </div>
            ))}
          </div>
        )}

        {props.section === 'settings' && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Settings</h3>
            <table className="table">
              <tbody>
                <tr><td><b>Super Admin ID</b></td><td>{db.adminAccount?.username ?? 'Set nahi hai'}</td></tr>
                <tr><td><b>Account bana</b></td><td>{db.adminAccount ? timeAgo(db.adminAccount.createdAt) : '—'}</td></tr>
                <tr><td><b>Staff passcode</b></td><td>{db.settings.adminPasscodeHash ? 'Set hai' : 'Set nahi hai'}</td></tr>
                <tr><td><b>Session</b></td><td>{props.adminSessionUser ? `Logged in — ${props.adminSessionUser.username}` : 'Passcode se unlocked'}</td></tr>
              </tbody>
            </table>
            <h4>Staff passcode set / badlo</h4>
            <p className="small muted">Staff passcode Super Admin login ka fallback hai — kam se kam 4 character.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Naya staff passcode" style={{ maxWidth: 240 }} />
              <button className="btn" onClick={setPasscode}>Set Karo</button>
            </div>
            {props.adminSessionUser && (
              <button className="btn btn-danger logout-pill" style={{ marginTop: 16 }} onClick={props.onAdminLogout}><LogOut size={15} /> Logout</button>
            )}
            <p className="small muted" style={{ marginTop: 14 }}>Super Admin ID + password sirf ek baar banaya jata hai (pehli baar setup karte time) — use badalne ke liye database se account reset karna padega. Password kabhi plain text me save nahi hota.</p>
          </div>
        )}
        <p className="small muted">Note: Ye demo localStorage par chalta hai — data isi browser/device me save hota hai. Production me iski jagah server database hoga.</p>
      </div>
    </section>
  )
}

/* ---------------- Footer (SEO) ---------------- */
function SiteFooter({ onGo, onGoCity }: { onGo: (v: View) => void; onGoCity: (c: CityFilter) => void }) {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-col footer-brand">
            <img src="/logo.png" alt="StayHazaribagh logo" width={52} height={52} />
            <b>StayHazaribagh<em>.</em></b>
            <p>PG &amp; Hostel Finder — Hazaribagh • Ranchi, Jharkhand</p>
            <p>Free listing • Free search • Bina brokerage ke.</p>
          </div>
          <div className="footer-col">
            <h4>Quick Links</h4>
            <button type="button" onClick={() => onGo('home')}><Home size={15} /> Home</button>
            <button type="button" onClick={() => onGo('bookings')}><BookOpen size={15} /> My Bookings</button>
            <button type="button" onClick={() => onGo('owner')}><Building2 size={15} /> Owner Portal</button>
            <button type="button" className="footer-admin-link" onClick={() => onGo('admin')}><Crown size={15} /> Super Admin</button>
          </div>
          <div className="footer-col">
            <h4>Cities</h4>
            <button type="button" onClick={() => onGoCity('Hazaribagh')}><MapPin size={15} /> Hazaribagh</button>
            <p className="small">Matwari • Korrah • Babugaon • Near VBU • Jhanda Chowk • Hirabag</p>
            <button type="button" onClick={() => onGoCity('Ranchi')}><MapPin size={15} /> Ranchi</button>
            <p className="small">Lalpur • Bariatu • Kanke Road • Harmu • Doranda • Ashok Nagar</p>
          </div>
          <div className="footer-col">
            <h4>Popular Searches</h4>
            <div className="popular">
              {['PG in Hazaribagh', 'Hostel in Hazaribagh', 'Girls hostel Hazaribagh', 'Boys PG Hazaribagh', 'PG near VBU', 'Matwari PG', 'Korrah hostel', 'PG in Ranchi', 'Lalpur PG Ranchi', 'Bariatu hostel', 'Hostel in Ranchi', 'PG with food Hazaribagh'].map((s) => (
                <a key={s} href="#listings" onClick={(e) => { e.preventDefault(); onGo('home') }}>{s}</a>
              ))}
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 StayHazaribagh — Hazaribagh • Ranchi, Jharkhand, India</span>
          <span>Listings by default Not Verified hoti hain; Super Admin verify karta hai. Reviews sirf is site par likhe gaye hain.</span>
        </div>
      </div>
    </footer>
  )
}
