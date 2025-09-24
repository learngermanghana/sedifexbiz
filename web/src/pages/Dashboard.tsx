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

type Trend = 'up' | 'down' | 'flat'
type InventorySeverity = 'warning' | 'info' | 'critical'

const METRICS: Array<{
  title: string
  value: string
  change: string
  changeDescription: string
  trend: Trend
}> = [
  {
    title: "Today's Sales",
    value: '$4,820',
    change: '+12.4%',
    changeDescription: 'vs yesterday',
    trend: 'up'
  },
  {
    title: 'Avg. Basket Size',
    value: '$37.80',
    change: '+3.1%',
    changeDescription: 'per transaction today',
    trend: 'up'
  },
  {
    title: 'Open Orders',
    value: '18',
    change: '6 awaiting pickup',
    changeDescription: 'cleared before close',
    trend: 'flat'
  },
  {
    title: 'Inventory Value',
    value: '$212K',
    change: '-4.7%',
    changeDescription: 'since last stock take',
    trend: 'down'
  }
]

const GOALS: Array<{
  title: string
  value: string
  target: string
  progress: number
}> = [
  {
    title: 'Month-to-date revenue',
    value: '$68,240',
    target: '$90K goal',
    progress: 0.76
  },
  {
    title: 'Repeat customers',
    value: '32%',
    target: '40% target',
    progress: 0.64
  }
]

const INVENTORY_ALERTS: Array<{
  sku: string
  name: string
  status: string
  severity: InventorySeverity
}> = [
  {
    sku: 'SKU-1128',
    name: 'Signature tote bag',
    status: 'Low (8 remaining)',
    severity: 'warning' as const
  },
  {
    sku: 'SKU-3094',
    name: 'Ceramic planters – forest',
    status: 'Reorder suggested',
    severity: 'info' as const
  },
  {
    sku: 'SKU-2045',
    name: 'Espresso beans 1kg',
    status: 'Backordered',
    severity: 'critical' as const
  }
]

const TEAM_CALLOUTS: Array<{
  label: string
  value: string
  description: string
}> = [
  {
    label: 'Peak sales hour',
    value: '1:00 – 2:00 PM',
    description: '42% above the daily average volume.'
  },
  {
    label: 'Top performer',
    value: 'Ava (12 sales)',
    description: 'Average ticket $41.20 and 3 new loyalty sign-ups.'
  },
  {
    label: 'Pending tasks',
    value: '3 store checklists',
    description: 'Verify cash float, restock impulse counter, and upload invoices.'
  }
]

function trendStyles(trend: Trend): { color: string; icon: string } {
  switch (trend) {
    case 'up':
      return { color: '#16A34A', icon: '▲' }
    case 'down':
      return { color: '#DC2626', icon: '▼' }
    default:
      return { color: '#475569', icon: '▬' }
  }
}

export default function Dashboard() {
  return (
    <div>
      <h2 style={{ color: '#4338CA', marginBottom: 8 }}>Dashboard</h2>
      <p style={{ color: '#475569', marginBottom: 24 }}>
        Welcome back! Choose what you’d like to work on — the most important Sedifex pages are just one tap away.
      </p>

      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          marginBottom: 32
        }}
        aria-label="Business metrics overview"
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16
          }}
        >
          {METRICS.map(metric => {
            const { color, icon } = trendStyles(metric.trend)
            return (
              <article
                key={metric.title}
                style={{
                  background: '#FFFFFF',
                  borderRadius: 16,
                  padding: '18px 20px',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {metric.title}
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>
                  {metric.value}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 14,
                      fontWeight: 600,
                      color
                    }}
                  >
                    <span aria-hidden="true">{icon}</span>
                    {metric.change}
                  </span>
                  <span style={{ fontSize: 13, color: '#475569' }}>{metric.changeDescription}</span>
                </div>
              </article>
            )
          })}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16
          }}
        >
          {GOALS.map(goal => (
            <article
              key={goal.title}
              style={{
                background: 'linear-gradient(145deg, #EEF2FF 0%, #E0E7FF 100%)',
                borderRadius: 16,
                padding: '20px 22px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 10px 28px rgba(67, 56, 202, 0.12)',
                display: 'flex',
                flexDirection: 'column',
                gap: 14
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#4338CA', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {goal.title}
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#1E1B4B' }}>{goal.value}</div>
                <div style={{ fontSize: 14, color: '#3730A3', fontWeight: 500 }}>{goal.target}</div>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: 'rgba(67, 56, 202, 0.12)',
                  overflow: 'hidden'
                }}
                role="presentation"
              >
                <div
                  style={{
                    width: `${Math.round(goal.progress * 100)}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: '#4338CA'
                  }}
                />
              </div>
            </article>
          ))}

          <article
            style={{
              background: '#FFFFFF',
              borderRadius: 16,
              padding: '20px 22px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14
            }}
            aria-labelledby="inventory-alerts-heading"
          >
            <div>
              <div id="inventory-alerts-heading" style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                Inventory alerts
              </div>
              <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0 0' }}>
                Keep an eye on these items so your shelves stay full.
              </p>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {INVENTORY_ALERTS.map(alert => {
                const severityStyles = {
                  warning: { background: 'rgba(234, 179, 8, 0.16)', color: '#B45309' },
                  info: { background: 'rgba(37, 99, 235, 0.14)', color: '#1D4ED8' },
                  critical: { background: 'rgba(220, 38, 38, 0.12)', color: '#B91C1C' }
                } as const

                return (
                  <li key={alert.sku} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 600, color: '#1E293B', fontSize: 14 }}>{alert.name}</div>
                      <span
                        style={{
                          ...severityStyles[alert.severity],
                          padding: '4px 10px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 600
                        }}
                      >
                        {alert.status}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>{alert.sku}</span>
                  </li>
                )
              })}
            </ul>
          </article>

          <article
            style={{
              background: '#FFFFFF',
              borderRadius: 16,
              padding: '20px 22px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14
            }}
            aria-labelledby="team-highlights-heading"
          >
            <div>
              <div id="team-highlights-heading" style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                Today’s highlights
              </div>
              <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0 0' }}>
                Quick insights your team can act on before the next rush.
              </p>
            </div>
            <dl style={{ margin: 0, display: 'grid', gap: 12 }}>
              {TEAM_CALLOUTS.map(callout => (
                <div key={callout.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <dt style={{ fontSize: 13, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
                    {callout.label}
                  </dt>
                  <dd style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1E293B' }}>{callout.value}</dd>
                  <span style={{ fontSize: 13, color: '#475569' }}>{callout.description}</span>
                </div>
              ))}
            </dl>
          </article>
        </div>
      </section>

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
