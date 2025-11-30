import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus'
import './Dashboard.css'

type SaleSummary = {
  id: string
  total: number
  createdAt: Date
}

export default function Dashboard() {
  const { storeId } = useActiveStore()
  const { isInactive: isSubscriptionInactive } = useSubscriptionStatus()

  // ─────────────────────────────────────────────────────────────
  // Month filter state
  // ─────────────────────────────────────────────────────────────

  // Format: YYYY-MM (what <input type="month" /> expects)
  const [selectedGoalMonth, setSelectedGoalMonth] = useState<string>(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  })

  const handleGoalMonthChange = (value: string) => {
    setSelectedGoalMonth(value)
  }

  // Derive month start/end from selectedGoalMonth
  const { monthStart, monthEnd } = useMemo(() => {
    if (!selectedGoalMonth) {
      return { monthStart: null as Date | null, monthEnd: null as Date | null }
    }
    const [yearStr, monthStr] = selectedGoalMonth.split('-')
    const year = Number(yearStr)
    const monthIndex = Number(monthStr) - 1
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
      return { monthStart: null, monthEnd: null }
    }
    const start = new Date(year, monthIndex, 1, 0, 0, 0, 0)
    const end = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0)
    return { monthStart: start, monthEnd: end }
  }, [selectedGoalMonth])

  // ─────────────────────────────────────────────────────────────
  // Data loading (simple monthly sales summary example)
  // ─────────────────────────────────────────────────────────────

  const [sales, setSales] = useState<SaleSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId || !monthStart || !monthEnd) {
      setSales([])
      return
    }

    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const q = query(
          collection(db, 'sales'),
          where('storeId', '==', storeId),
          where('createdAt', '>=', monthStart),
          where('createdAt', '<', monthEnd),
          orderBy('createdAt', 'desc'),
        )

        const snap = await getDocs(q)
        if (cancelled) return

        const rows: SaleSummary[] = snap.docs.map(docSnap => {
          const data = docSnap.data() as any
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === 'function'
              ? data.createdAt.toDate()
              : new Date()
          const total = typeof data.total === 'number' ? data.total : 0
          return { id: docSnap.id, total, createdAt }
        })

        setSales(rows)
      } catch (err) {
        console.error('[dashboard] Failed to load sales', err)
        if (!cancelled) {
          setError('Unable to load dashboard data right now.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [storeId, monthStart, monthEnd])

  const monthTotal = useMemo(
    () => sales.reduce((sum, s) => sum + s.total, 0),
    [sales],
  )

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="page dashboard-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Dashboard</h2>
          <p className="page__subtitle">
            Track your sales performance and monthly goals at a glance.
          </p>
        </div>

        {/* ─────────────────────────────────────────────
            FIXED MONTH FILTER (the bit that was erroring)
            ───────────────────────────────────────────── */}
        <div className="dashboard-page__filters">
          <label className="dashboard-page__month-filter">
            <span style={{ fontWeight: 600 }}>Month</span>
            <input
              // 🔧 FIX: cast to React.HTMLInputTypeAttribute so TS is happy
              type={'month' as React.HTMLInputTypeAttribute}
              value={selectedGoalMonth}
              onChange={event => handleGoalMonthChange(event.target.value)}
            />
          </label>
        </div>
      </header>

      {isSubscriptionInactive && (
        <p className="dashboard-page__message dashboard-page__message--warning">
          Your subscription is inactive. Reactivate to see live data.
        </p>
      )}

      <main className="dashboard-page__grid">
        <section className="card">
          <h3 className="card__title">Monthly sales</h3>
          {loading && <p>Loading sales…</p>}
          {error && (
            <p className="dashboard-page__message dashboard-page__message--error">
              {error}
            </p>
          )}
          {!loading && !error && (
            <>
              <p className="dashboard-page__metric">
                <span className="dashboard-page__metric-label">Total for {selectedGoalMonth}</span>
                <span className="dashboard-page__metric-value">
                  GHS {monthTotal.toFixed(2)}
                </span>
              </p>
              {sales.length === 0 ? (
                <p className="dashboard-page__empty">
                  No sales recorded for this month yet.
                </p>
              ) : (
                <ul className="dashboard-page__list">
                  {sales.map(sale => (
                    <li key={sale.id} className="dashboard-page__list-item">
                      <span>{sale.createdAt.toLocaleString()}</span>
                      <span>GHS {sale.total.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
