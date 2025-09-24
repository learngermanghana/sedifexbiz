import React from 'react'
import { NavLink } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/products', label: 'Products' },
  { to: '/sell', label: 'Sell' },
  { to: '/receive', label: 'Receive' },
  { to: '/close-day', label: 'Close Day' },
  { to: '/settings', label: 'Settings' }
]

function linkStyle(isActive: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 999,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: isActive ? 600 : 500,
    color: isActive ? '#fff' : '#4338CA',
    backgroundColor: isActive ? '#4338CA' : '#EEF2FF',
    border: `1px solid ${isActive ? '#4338CA' : 'transparent'}`,
    boxShadow: isActive ? '0 6px 18px rgba(67, 56, 202, 0.18)' : 'none',
    transition: 'all 0.2s ease',
    lineHeight: 1.4
  }
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const userEmail = auth.currentUser?.email ?? 'Account'

  return (
    <div style={{ fontFamily: 'Inter, system-ui, Arial', background: '#F8FAFC', minHeight: '100vh' }}>
      <header style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #E2E8F0', zIndex: 10 }}>
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#4338CA' }}>Sedifex</div>
            <span style={{ fontSize: 13, color: '#64748B' }}>Sell faster. Count smarter.</span>
          </div>

          <nav
            aria-label="Primary"
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              flexGrow: 1
            }}
          >
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={({ isActive }) => linkStyle(isActive)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#EEF2FF',
              borderRadius: 999,
              padding: '6px 10px'
            }}
          >
            <span style={{ fontSize: 13, color: '#4338CA', fontWeight: 600 }}>{userEmail}</span>
            <button
              type="button"
              onClick={() => signOut(auth)}
              style={{
                border: 'none',
                background: '#4338CA',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 10px',
                borderRadius: 999,
                cursor: 'pointer'
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>{children}</main>
    </div>
  )
}
