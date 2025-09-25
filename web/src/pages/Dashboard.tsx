import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'

type InventorySeverity = 'warning' | 'info' | 'critical'

type SaleRecord = {
  id: string
  total?: number
  createdAt?: Timestamp | Date | null
  items?: Array<{ productId: string; name?: string; price?: number; qty?: number }>
  payment?: {
    method?: string
    amountPaid?: number
    changeDue?: number
  }
}

type ProductRecord = {
  id: string
  name: string
  price?: number
  stockCount?: number
  minStock?: number
}

type CustomerRecord = {
  id: string
  name: string
}

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

function asDate(value?: Timestamp | Date | null) {
  if (!value) return null
  if (value instanceof Date) return value
  try {
    return value.toDate()
  } catch (error) {
    return null
  }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function addDays(base: Date, days: number) {
  const copy = new Date(base)
  copy.setDate(copy.getDate() + days)
  return copy
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function formatAmount(value: number) {
  return `GHS ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatPercent(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function formatHourRange(hour: number) {
  const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  const start = new Date()
  start.setHours(hour, 0, 0, 0)
  const end = new Date(start)
  end.setHours(hour + 1)
  return `${formatter.format(start)} – ${formatter.format(end)}`
}

export default function Dashboard() {
  const { storeId: STORE_ID, isLoading: storeLoading, error: storeError } = useActiveStore()

  const [sales, setSales] = useState<SaleRecord[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(collection(db, 'sales'), where('storeId', '==', STORE_ID))
    return onSnapshot(q, snapshot => {
      const rows: SaleRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<SaleRecord, 'id'>),
      }))
      setSales(rows)
    })
  }, [STORE_ID])

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(collection(db, 'products'), where('storeId', '==', STORE_ID))
    return onSnapshot(q, snapshot => {
      const rows: ProductRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ProductRecord, 'id'>),
      }))
      setProducts(rows)
    })
  }, [STORE_ID])

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(collection(db, 'customers'), where('storeId', '==', STORE_ID))
    return onSnapshot(q, snapshot => {
      const rows: CustomerRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<CustomerRecord, 'id'>),
      }))
      setCustomers(rows)
    })
  }, [STORE_ID])

  const today = useMemo(() => new Date(), [sales])
  const yesterday = useMemo(() => addDays(today, -1), [today])
  const monthStart = useMemo(() => startOfMonth(today), [today])

  const todaySales = sales.filter(record => {
    const created = asDate(record.createdAt)
    return created ? isSameDay(created, today) : false
  })

  const yesterdaySales = sales.filter(record => {
    const created = asDate(record.createdAt)
    return created ? isSameDay(created, yesterday) : false
  })

  const todayRevenue = todaySales.reduce((sum, sale) => sum + (sale.total ?? 0), 0)
  const yesterdayRevenue = yesterdaySales.reduce((sum, sale) => sum + (sale.total ?? 0), 0)

  const todayTicket = todaySales.length ? todayRevenue / todaySales.length : 0
  const yesterdayTicket = yesterdaySales.length ? yesterdayRevenue / yesterdaySales.length : 0

  const salesChange = yesterdayRevenue > 0 ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100 : null
  const ticketChange = yesterdayTicket > 0 ? ((todayTicket - yesterdayTicket) / yesterdayTicket) * 100 : null
  const salesCountChange = yesterdaySales.length > 0
    ? ((todaySales.length - yesterdaySales.length) / yesterdaySales.length) * 100
    : null

  const inventoryValue = products.reduce((sum, product) => {
    const stock = product.stockCount ?? 0
    const price = product.price ?? 0
    return sum + stock * price
  }, 0)

  const lowStock = products
    .map(product => {
      const stock = product.stockCount ?? 0
      const minStock = product.minStock ?? 5
      if (stock > minStock) return null
      const severity: InventorySeverity = stock <= 0 ? 'critical' : stock <= minStock ? 'warning' : 'info'
      const status = stock <= 0 ? 'Out of stock' : `Low (${stock} remaining)`
      return {
        sku: product.id,
        name: product.name,
        status,
        severity,
      }
    })
    .filter(Boolean) as Array<{ sku: string; name: string; status: string; severity: InventorySeverity }>

  const outOfStockCount = products.filter(product => (product.stockCount ?? 0) <= 0).length

  const monthRevenue = sales.reduce((sum, sale) => {
    const created = asDate(sale.createdAt)
    if (!created || created < monthStart) return sum
    return sum + (sale.total ?? 0)
  }, 0)
  const revenueTarget = 5000
  const customerTarget = 50

  const hourBuckets = todaySales.reduce((acc, sale) => {
    const created = asDate(sale.createdAt)
    if (!created) return acc
    const hour = created.getHours()
    const current = acc.get(hour) ?? 0
    acc.set(hour, current + (sale.total ?? 0))
    return acc
  }, new Map<number, number>())

  let peakHour: { hour: number; total: number } | null = null
  hourBuckets.forEach((total, hour) => {
    if (!peakHour || total > peakHour.total) {
      peakHour = { hour, total }
    }
  })

  const itemTotals = todaySales.reduce((acc, sale) => {
    const items = sale.items ?? []
    items.forEach(item => {
      const qty = item.qty ?? 0
      if (!qty) return
      const key = item.productId
      if (!key) return
      const existing = acc.get(key) ?? { name: item.name ?? 'Unnamed product', qty: 0 }
      existing.qty += qty
      if (item.name && !existing.name) {
        existing.name = item.name
      }
      acc.set(key, existing)
    })
    return acc
  }, new Map<string, { name: string; qty: number }>())

  let topItem: { name: string; qty: number } | null = null
  itemTotals.forEach(value => {
    if (!topItem || value.qty > topItem.qty) {
      topItem = value
    }
  })

  const metrics = [
    {
      title: "Today's Sales",
      value: formatAmount(todayRevenue),
      change: salesChange !== null ? formatPercent(salesChange) : '—',
      changeDescription: 'vs yesterday',
      color: salesChange === null ? '#475569' : salesChange < 0 ? '#DC2626' : '#16A34A',
      icon: salesChange === null ? '▬' : salesChange < 0 ? '▼' : '▲',
    },
    {
      title: 'Avg. Basket Size',
      value: formatAmount(todayTicket),
      change: ticketChange !== null ? formatPercent(ticketChange) : '—',
      changeDescription: 'per transaction today',
      color: ticketChange === null ? '#475569' : ticketChange < 0 ? '#DC2626' : '#16A34A',
      icon: ticketChange === null ? '▬' : ticketChange < 0 ? '▼' : '▲',
    },
    {
      title: 'Sales count',
      value: `${todaySales.length}`,
      change: salesCountChange !== null ? formatPercent(salesCountChange) : '—',
      changeDescription: 'transactions recorded today',
      color: salesCountChange === null ? '#475569' : salesCountChange < 0 ? '#DC2626' : '#16A34A',
      icon: salesCountChange === null ? '▬' : salesCountChange < 0 ? '▼' : '▲',
    },
    {
      title: 'Inventory value',
      value: formatAmount(inventoryValue),
      change: `${outOfStockCount} out-of-stock`,
      changeDescription: 'based on product price × stock',
      color: '#475569',
      icon: '▬',
    },
  ]

  const goals = [
    {
      title: 'Month-to-date revenue',
      value: formatAmount(monthRevenue),
      target: `Target ${formatAmount(revenueTarget)}`,
      progress: Math.min(1, revenueTarget ? monthRevenue / revenueTarget : 0),
    },
    {
      title: 'Active customers',
      value: `${customers.length}`,
      target: `Goal ${customerTarget}`,
      progress: Math.min(1, customers.length / customerTarget),
    },
  ]

  const inventoryAlerts = lowStock.slice(0, 5)

  const teamCallouts = [
    {
      label: 'Peak sales hour',
      value: peakHour ? formatHourRange(peakHour.hour) : '—',
      description: peakHour
        ? `${formatAmount(peakHour.total)} sold during this hour.`
        : 'No sales recorded yet today.',
    },
    {
      label: 'Top product today',
      value: topItem ? topItem.name : '—',
      description: topItem
        ? `${topItem.qty} sold across all transactions.`
        : 'Record a sale to surface bestsellers.',
    },
    {
      label: 'Inventory alerts',
      value: `${lowStock.length} low / ${outOfStockCount} out`,
      description: lowStock.length || outOfStockCount
        ? 'Review products that need restocking.'
        : 'All products are above minimum stock.',
    },
  ]

  if (storeLoading) {
    return <div>Loading…</div>
  }

  if (!STORE_ID) {
    return <div>We were unable to determine your store access. Please sign out and back in.</div>
  }

  return (
    <div>
      <h2 style={{ color: '#4338CA', marginBottom: 8 }}>Dashboard</h2>
      {storeError && <p style={{ color: '#b91c1c', marginBottom: 12 }}>{storeError}</p>}
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
          {metrics.map(metric => (
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
                    justifyContent: 'center',
                    width: 26,
                    height: 26,
                    borderRadius: '999px',
                    background: '#EEF2FF',
                    color: metric.color,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                  aria-hidden="true"
                >
                  {metric.icon}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: metric.color }}>
                  {metric.change}
                </span>
                <span style={{ fontSize: 13, color: '#64748B' }}>{metric.changeDescription}</span>
              </div>
            </article>
          ))}
        </div>

        <div
          style={{
            background: '#F1F5F9',
            borderRadius: 18,
            border: '1px solid #E2E8F0',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            padding: 16
          }}
        >
          {goals.map(goal => (
            <article
              key={goal.title}
              style={{
                background: '#FFFFFF',
                borderRadius: 14,
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                border: '1px solid #E2E8F0'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {goal.title}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>
                {goal.value}
              </div>
              <div style={{ fontSize: 13, color: '#475569' }}>{goal.target}</div>
              <div
                role="progressbar"
                aria-valuenow={Math.round(goal.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  position: 'relative',
                  height: 8,
                  borderRadius: 999,
                  background: '#E2E8F0',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: `${Math.round(goal.progress * 100)}%`,
                    background: '#4338CA'
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
          marginBottom: 32
        }}
      >
        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Quick links</h3>
              <p style={{ fontSize: 13, color: '#64748B' }}>Hop straight into the workspace you need.</p>
            </div>
          </div>
          <ul style={{ display: 'grid', gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
            {QUICK_LINKS.map(link => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#F8FAFC',
                    borderRadius: 12,
                    padding: '14px 16px',
                    textDecoration: 'none',
                    color: '#1E3A8A',
                    border: '1px solid transparent'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{link.title}</div>
                    <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>{link.description}</p>
                  </div>
                  <span aria-hidden="true" style={{ fontWeight: 700, color: '#4338CA' }}>
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </article>

        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Inventory alerts</h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>
              Watch products that are running low so the floor team can replenish quickly.
            </p>
          </div>

          {inventoryAlerts.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {inventoryAlerts.map(item => (
                <li
                  key={item.sku}
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    background: '#F8FAFC'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: '#0F172A' }}>{item.name}</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: item.severity === 'critical' ? '#DC2626' : item.severity === 'warning' ? '#C2410C' : '#2563EB'
                      }}
                    >
                      {item.status}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: '#64748B' }}>SKU: {item.sku}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: '#475569' }}>All inventory levels are healthy.</p>
          )}
        </article>

        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Team callouts</h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>
              Share insights with staff so everyone knows what needs attention today.
            </p>
          </div>

          <dl style={{ margin: 0, display: 'grid', gap: 12 }}>
            {teamCallouts.map(item => (
              <div
                key={item.label}
                style={{
                  display: 'grid',
                  gap: 4,
                  background: '#F8FAFC',
                  borderRadius: 12,
                  border: '1px solid #E2E8F0',
                  padding: '12px 14px'
                }}
              >
                <dt style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {item.label}
                </dt>
                <dd style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{item.value}</dd>
                <dd style={{ margin: 0, fontSize: 13, color: '#475569' }}>{item.description}</dd>
              </div>
            ))}
          </dl>
        </article>
      </section>
    </div>
  )
}
