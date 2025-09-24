import React from 'react'
import { Link } from 'react-router-dom'

const QUICK_LINKS = [
  {
    to: '/products',
    title: 'Products',
    description: 'Manage your catalogue, update prices, and keep stock levels accurate.'
  },
  {
    to: '/sell',
    title: 'Sell',
    description: 'Ring up a customer, track the cart, and record a sale in seconds.'
  },
  {
    to: '/receive',
    title: 'Receive',
    description: 'Log new inventory as it arrives so every aisle stays replenished.'
  },
  {
    to: '/close-day',
    title: 'Close Day',
    description: 'Balance the till, review totals, and lock in a clean daily report.'
  },
  {
    to: '/settings',
    title: 'Settings',
    description: 'Configure staff, taxes, and other controls that keep your shop running.'
  }
]

export default function Dashboard() {
  return (
    <div>
      <h2 style={{ color: '#4338CA', marginBottom: 8 }}>Dashboard</h2>
      <p style={{ color: '#475569', marginBottom: 24 }}>
        Welcome back! Choose what you’d like to work on — the most important Sedifex pages are just one tap away.
      </p>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16
        }}
        aria-label="Important pages"
      >
        {QUICK_LINKS.map(link => (
          <Link
            key={link.to}
            to={link.to}
            style={{
              display: 'block',
              background: '#fff',
              borderRadius: 16,
              padding: '20px 18px',
              border: '1px solid #E2E8F0',
              textDecoration: 'none',
              color: '#0F172A',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>
              {link.title}
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: '#475569', margin: 0 }}>
              {link.description}
            </p>
            <span style={{ display: 'inline-flex', alignItems: 'center', marginTop: 16, fontSize: 14, fontWeight: 600, color: '#4338CA' }}>
              Open {link.title}
              <span aria-hidden="true" style={{ marginLeft: 6 }}>→</span>
            </span>
          </Link>
        ))}
      </section>
    </div>
  )
}
