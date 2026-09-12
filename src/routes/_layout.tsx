import { Link, Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuthActions, useConvexAuth } from '@convex-dev/auth/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useEffect } from 'react'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/_layout')({
  component: Layout,
})

function Layout() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const { signOut } = useAuthActions()
  const navigate = useNavigate()

  const currentUser = useSuspenseQuery(convexQuery(api.organizations.currentUser, {}))
    .data
  const initials =
    currentUser?.name
      ?.split(' ')
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ?? '??'

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate({ to: '/login' })
    }
  }, [isLoading, isAuthenticated, navigate])

  if (isLoading || !isAuthenticated) {
    return (
      <div className="loading-shell">
        <div className="dot-live" />
        Chargement de la session…
      </div>
    )
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="logo">
          Logistix<span>.</span>
        </div>
        <div className="topbar-right">
          {currentUser?.org && (
            <div className="topbar-org">{currentUser.org.name}</div>
          )}
          <div className="badge-live">
            <div className="dot-live" />
            Live sync
          </div>
          <div style={{ fontSize: '12px', fontFamily: "'DM Mono', monospace", color: '#3d4a5c' }}>
            Mar 12, 2026
          </div>
          <div className="avatar" title={currentUser?.name}>
            {initials}
          </div>
          <button
            type="button"
            className="logout-btn"
            onClick={() => signOut()}
          >
            Déconnexion
          </button>
        </div>
      </div>

      <div className="sidebar">
        <div className="nav-section">Navigation</div>
        <Link to="/" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".9"/>
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/>
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/>
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".5"/>
          </svg>
          Vue d'ensemble
        </Link>
        <Link to="/expeditions" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M5 4V3a3 3 0 016 0v1" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          Expéditions
        </Link>
        <Link to="/hubs" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L1 5v6l7 4 7-4V5L8 1z" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M1 5l7 4 7-4M8 9v6" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          Entrepôts
        </Link>
        <Link to="/routes" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Itinéraires
        </Link>
        <Link to="/incidents" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5L14 14H2L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M8 6v3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="8" cy="11.6" r=".8" fill="currentColor"/>
          </svg>
          Incidents
        </Link>
        <Link to="/sla" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M8 5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Délais &amp; SLA
        </Link>
        <div className="nav-section">Analyse</div>
        <Link to="/performance" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <path d="M2 12L6 7l3 3 3-4 2 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Performance
        </Link>
        <Link to="/tracabilite" className="nav-item" activeProps={{ className: 'nav-item active' }}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Traçabilité
        </Link>
        <div className="nav-section">Config</div>
        <div className="nav-item">
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.41 1.41M11.36 11.36l1.42 1.42M3.22 12.78l1.41-1.41M11.36 4.64l1.42-1.42" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Paramètres
        </div>
      </div>

      <div className="main">
        <Outlet />
      </div>
    </div>
  )
}