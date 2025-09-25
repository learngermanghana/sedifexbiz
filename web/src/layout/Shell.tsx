import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import './Shell.css'
import './Workspace.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/products', label: 'Products' },
  { to: '/sell', label: 'Sell' },
  { to: '/receive', label: 'Receive' },
  { to: '/customers', label: 'Customers' },
  { to: '/close-day', label: 'Close Day' },
  { to: '/settings', label: 'Settings' }
]

function navLinkClass(isActive: boolean) {
  return `shell__nav-link${isActive ? ' is-active' : ''}`
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const user = useAuthUser()
  const userEmail = user?.email ?? 'Account'
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    function handleNetworkChange() {
      setIsOffline(!navigator.onLine)
    }

    window.addEventListener('online', handleNetworkChange)
    window.addEventListener('offline', handleNetworkChange)

    return () => {
      window.removeEventListener('online', handleNetworkChange)
      window.removeEventListener('offline', handleNetworkChange)
    }
  }, [])

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__header-inner">
          <div className="shell__brand">
            <div className="shell__logo">Sedifex</div>
            <span className="shell__tagline">Sell faster. Count smarter.</span>
          </div>

          <nav className="shell__nav" aria-label="Primary">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => navLinkClass(isActive)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="shell__account">
            <span className="shell__account-email">{userEmail}</span>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => signOut(auth)}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {isOffline && (
        <div className="shell__offline-banner" role="status" aria-live="polite">
          <span className="shell__offline-dot" aria-hidden="true" />
          <span className="shell__offline-text">You’re offline. We’ll sync pending work when the connection returns.</span>
        </div>
      )}

      <main className="shell__main">{children}</main>
    </div>
  )
}
