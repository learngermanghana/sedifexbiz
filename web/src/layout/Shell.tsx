import React from 'react'
import { NavLink } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import './Shell.css'
import './Workspace.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/products', label: 'Products' },
  { to: '/sell', label: 'Sell' },
  { to: '/receive', label: 'Receive' },
  { to: '/close-day', label: 'Close Day' },
  { to: '/settings', label: 'Settings' }
]

function navLinkClass(isActive: boolean) {
  return `shell__nav-link${isActive ? ' is-active' : ''}`
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const userEmail = auth.currentUser?.email ?? 'Account'

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

      <main className="shell__main">{children}</main>
    </div>
  )
}
