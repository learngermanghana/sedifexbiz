// web/src/pages/Finance.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'

type RangeKey = 'month' | '30d' | '7d' | 'all'

type SaleRow = {
  id: string
  total: number
  taxTotal: number
  createdAt: Date | null
}

type ExpenseRow = {
  id: string
  amount: number
  date: string // yyyy-mm-dd
  createdAt: Date | null
}

function toDate(value: any): Date | null {
  if (!value) return null
  if (value.toDate && typeof value.toDate === 'function') {
    // Firestore Timestamp
    return value.toDate()
  }
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export default function Finance() {
  const { storeId } = useActiveStore()

  const [sales, setSales] = useState<SaleRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [range, setRange] = useState<RangeKey>('month')

  // --- Load sales for this workspace ---
  useEffect(() => {
    if (!storeId) {
      setSales([])
      return
    }

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', storeId), // 👈 match Dashboard query
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: SaleRow[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any
        const createdAt = toDate(data.createdAt)

        const total =
          typeof data.totals?.total === 'number'
            ? data.totals.total
            : typeof data.total === 'number'
              ? data.total
              : 0

        const taxTotal =
          typeof data.totals?.taxTotal === 'number'
            ? data.totals.taxTotal
            : typeof data.taxTotal === 'number'
              ? data.taxTotal
              : 0

        return {
          id: docSnap.id,
          total: Number(total) || 0,
          taxTotal: Number(taxTotal) || 0,
          createdAt,
        }
      })
      setSales(rows)
    })

    return unsubscribe
  }, [storeId])

  // --- Load expenses for this workspace ---
  useEffect(() => {
    if (!storeId) {
      setExpenses([])
      return
    }

    const q = query(
      collection(db, 'expenses'),
      where('storeId', '==', storeId),
      orderBy('date', 'desc'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: ExpenseRow[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any
        const createdAt = toDate(data.createdAt)
        const amount = Number(data.amount) || 0
        const date = typeof data.date === 'string' ? data.date : ''
        return {
          id: docSnap.id,
          amount,
          date,
          createdAt,
        }
      })
      setExpenses(rows)
    })

    return unsubscribe
  }, [storeId])

  // --- Date range filtering ---
  const now = useMemo(() => new Date(), [])

  function isInRange(d: Date | null, key: RangeKey): boolean {
    if (!d) return false
    if (key === 'all') return true

    const msInDay = 1000 * 60 * 60 * 24
    const diffDays = (now.getTime() - d.getTime()) / msInDay

    if (key === '7d') return diffDays <= 7 && diffDays >= 0
    if (key === '30d') return diffDays <= 30 && diffDays >= 0

    // 'month' – same year + month as now
    const sameYear = d.getFullYear() === now.getFullYear()
    const sameMonth = d.getMonth() === now.getMonth()
    return sameYear && sameMonth
  }

  const filteredSales = useMemo(
    () => sales.filter(row => isInRange(row.createdAt, range)),
    [sales, range],
  )

  const filteredExpenses = useMemo(
    () =>
      expenses.filter(row =>
        isInRange(
          // convert yyyy-mm-dd to Date
          row.date ? new Date(`${row.date}T00:00:00`) : row.createdAt,
          range,
        ),
      ),
    [expenses, range],
  )

  const grossSales = filteredSales.reduce((sum, row) => sum + row.total, 0)
  const totalVat = filteredSales.reduce((sum, row) => sum + row.taxTotal, 0)
  const totalExpenses = filteredExpenses.reduce(
    (sum, row) => sum + row.amount,
    0,
  )
  const netProfit = grossSales - totalExpenses

  const hasAnyData = sales.length > 0 || expenses.length > 0

  function rangeLabel(key: RangeKey): string {
    switch (key) {
      case 'month':
        return 'This month'
      case '30d':
        return 'Last 30 days'
      case '7d':
        return 'Last 7 days'
      case 'all':
        return 'All time'
    }
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Finance</h2>
          <p className="page__subtitle">
            Track cash and expenses for your Sedifex workspace.
          </p>
        </div>
      </header>

      {/* Overview card */}
      <section className="card" aria-label="Finance summary">
        <div className="page__header" style={{ padding: 0, marginBottom: 12 }}>
          <div>
            <h3 className="card__title">Overview</h3>
            <p className="card__subtitle">
              See gross sales, VAT, expenses, and net profit for this workspace.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {(['month', '30d', '7d', 'all'] as RangeKey[]).map(key => (
              <button
                key={key}
                type="button"
                className={
                  range === key
                    ? 'button button--primary button--small'
                    : 'button button--ghost button--small'
                }
                onClick={() => setRange(key)}
              >
                {rangeLabel(key)}
              </button>
            ))}
          </div>
        </div>

        {storeId ? null : (
          <p className="status status--error" role="alert">
            Select or create a workspace first. Finance is calculated per
            workspace.
          </p>
        )}

        {hasAnyData ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
              marginTop: 8,
            }}
          >
            <div className="info-card">
              <h4>Gross sales</h4>
              <p style={{ fontSize: 24, fontWeight: 600 }}>
                GHS {grossSales.toFixed(2)}
              </p>
              <p className="card__subtitle">
                Sum of recorded sales (including VAT) in the selected range.
              </p>
            </div>

            <div className="info-card">
              <h4>VAT collected</h4>
              <p style={{ fontSize: 24, fontWeight: 600 }}>
                GHS {totalVat.toFixed(2)}
              </p>
              <p className="card__subtitle">
                Total VAT portion from all recorded sales in this period.
              </p>
            </div>

            <div className="info-card">
              <h4>Expenses</h4>
              <p style={{ fontSize: 24, fontWeight: 600 }}>
                GHS {totalExpenses.toFixed(2)}
              </p>
              <p className="card__subtitle">
                All expenses from your Expenses page in this period.
              </p>
            </div>

            <div className="info-card">
              <h4>Net profit</h4>
              <p
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: netProfit >= 0 ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)',
                }}
              >
                GHS {netProfit.toFixed(2)}
              </p>
              <p className="card__subtitle">
                Gross sales minus expenses. (VAT is shown separately above.)
              </p>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 8 }}>
            <h4 className="empty-state__title">No finance data yet</h4>
            <p>
              Record sales from the <Link to="/sell">Sell</Link> page and track
              store costs on the <Link to="/expenses">Expenses</Link> page to see
              profit here.
            </p>
          </div>
        )}
      </section>

      {/* Quick links (same idea as before) */}
      <section className="card" style={{ marginTop: 24 }}>
        <h3 className="card__title">Quick links</h3>
        <p className="card__subtitle">
          Jump straight to the main money pages for your business.
        </p>
        <ul className="link-list">
          <li>
            <Link to="/close-day">Close Day &amp; cash counts</Link>
          </li>
          <li>
            <Link to="/expenses">Expenses &amp; payouts</Link>
          </li>
        </ul>
      </section>
    </div>
  )
}
