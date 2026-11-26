import { ChevronsLeft, ChevronsRight, LogOut, X, type LucideIcon } from 'lucide-react'

export interface SidebarItem {
  id: string
  label: string
  icon: LucideIcon
  /** Small count badge, e.g. new enquiries / unverified PGs. */
  badge?: number
  onClick: () => void
}

export interface SidebarSection {
  heading: string
  items: SidebarItem[]
}

interface DashboardSidebarProps {
  /** Panel title, e.g. "Makan Malik Portal". */
  title: string
  subtitle: string
  userInitial: string
  userName: string
  userRole: string
  sections: SidebarSection[]
  activeId: string
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Mobile drawer: open state + close handler. Ignored on desktop. */
  drawerOpen: boolean
  onCloseDrawer: () => void
  /** Teal "Verified Owner" badge in the user chip (owner portal). */
  verifiedBadge?: boolean
  onLogout?: () => void
  logoutLabel?: string
}

/**
 * Attractive left sidebar menu, shared by all three dashboards
 * (Tenant, Makan Malik, Super Admin). Deep-teal to match the site theme,
 * icons via lucide-react, active-item highlight, count badges, and a
 * user chip on top. On desktop it is fixed on the left (collapsible to
 * icons-only); on phones it slides in as a drawer from the hamburger.
 */
export default function DashboardSidebar(props: DashboardSidebarProps) {
  return (
    <>
      {props.drawerOpen && (
        <div className="sidebar-backdrop" aria-hidden="true" onClick={props.onCloseDrawer} />
      )}
      <aside
        className={`dash-sidebar ${props.collapsed ? 'collapsed' : ''} ${props.drawerOpen ? 'open' : ''}`}
        aria-label={props.title}
      >
        <div className="dash-sidebar-brand">
          <img src="/logo.png" alt="StayHazaribagh logo" width={40} height={40} />
          <span>StayHazaribagh<em>.</em></span>
        </div>
        <div className="dash-sidebar-head">
          <div className="dash-sidebar-user">
            <span className="dash-avatar">{props.userInitial}</span>
            <span className="dash-user-text">
              <b>{props.userName}</b>
              <span>{props.userRole}</span>
              {props.verifiedBadge && (
                <span className="badge badge-verified" style={{ marginTop: 4, alignSelf: 'flex-start' }}>✓ Verified Owner</span>
              )}
            </span>
          </div>
          <button className="dash-close" onClick={props.onCloseDrawer} aria-label="Menu band karo">
            <X size={18} />
          </button>
        </div>
        <p className="dash-sidebar-title">{props.title}</p>
        <p className="dash-sidebar-sub">{props.subtitle}</p>

        <nav className="dash-nav">
          {props.sections.map((sec) => (
            <div key={sec.heading} className="dash-nav-section">
              <p className="dash-nav-heading">{sec.heading}</p>
              {sec.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`dash-nav-item ${props.activeId === item.id ? 'active' : ''}`}
                    aria-current={props.activeId === item.id ? 'page' : undefined}
                    title={item.label}
                    onClick={() => { item.onClick(); props.onCloseDrawer() }}
                  >
                    <Icon size={19} className="dash-nav-icon" />
                    <span className="dash-nav-label">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="dash-nav-badge">{item.badge > 99 ? '99+' : item.badge}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-foot">
          <button
            type="button"
            className="dash-collapse"
            onClick={props.onToggleCollapsed}
            aria-label={props.collapsed ? 'Sidebar kholo' : 'Sidebar chhota karo'}
          >
            {props.collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            <span>Chhota karo</span>
          </button>
          {props.onLogout && (
            <button type="button" className="dash-logout" onClick={props.onLogout}>
              <LogOut size={18} />
              <span>{props.logoutLabel ?? 'Logout'}</span>
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
