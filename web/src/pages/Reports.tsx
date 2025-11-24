import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './Reports.css'

type DaySummary = {
  dateKey: string            // 'YYYY-MM-DD'
  date: Date
  totalSales: number
  totalTax: number
  receiptCount: number
  firstSaleAt: Date | null
  lastSaleAt: Date | null
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value) : null
  }
  if (typeof value === 'object') {
    const anyValue = value as {
      toDate?: () => Date
      toMillis?: () => number
      seconds?: number
      nanoseconds?: number
    }
    if (typeof anyValue.toDate === 'function') {
      try {
        return anyValue.toDate() ?? null
      } catch {
        // ignore
      }
    }
    if (typeof anyValue.toMillis === 'function') {
      try {
        const ms = anyValue.toMillis()
        return Number.isFinite(ms) ? new Date(ms) : null
      } catch {
        // ignore
      }
    }
    if (typeof anyValue.seconds === 'number') {
      const ms =
        anyValue.seconds * 1000 +
        Math.round((anyValue.nanoseconds ?? 0) / 1_000_000)
      return Number.isFinite(ms) ? new Date(ms) : null
    }
  }
  return null
}

function formatDate(date: Date | null) {
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTime(date: Date | null) {
  if (!date) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatCurrency(amount: number) {
  if (!Number.isFinite(amount)) return '—'
  return `GHS ${amount.toFixed(2)}`
}

export default function Today() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const [summaries, setSummaries] = useState<DaySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!storeId) {
      setSummaries([])
      setLoadError(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    setLoadError(null)

    const salesRef = collection(db, 'sales')
    const q = query(
      salesRef,
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot: QuerySnapshot<DocumentData>) => {
        if (cancelled) return

        const byDate = new Map<string, DaySummary>()

        snapshot.forEach(docSnap => {
          const data = docSnap.data() || {}
          const createdAt = toDate(data.createdAt)
          if (!createdAt) return

          const total =
            typeof data.total === 'number' && Number.isFinite(data.total)
              ? data.total
              : 0
          const taxTotal =
            typeof data.taxTotal === 'number' && Number.isFinite(data.taxTotal)
              ? data.taxTotal
              : 0

          const dateOnly = new Date(
            createdAt.getFullYear(),
            createdAt.getMonth(),
            createdAt.getDate(),
          )
          const dateKey = dateOnly.toISOString().slice(0, 10)

          let existing = byDate.get(dateKey)
          if (!existing) {
            existing = {
              dateKey,
              date: dateOnly,
              totalSales: 0,
              totalTax: 0,
              receiptCount: 0,
              firstSaleAt: createdAt,
              lastSaleAt: createdAt,
            }
            byDate.set(dateKey, existing)
          }

          existing.totalSales += total
          existing.totalTax += taxTotal
          existing.receiptCount += 1

          if (
            !existing.firstSaleAt ||
            createdAt < existing.firstSaleAt
          ) {
            existing.firstSaleAt = createdAt
          }
          if (!existing.lastSaleAt || createdAt > existing.lastSaleAt) {
            existing.lastSaleAt = createdAt
          }
        })

        const rows = Array.from(byDate.values()).sort(
          (a, b) => b.date.getTime() - a.date.getTime(),
        )

        setSummaries(rows)
        setLoading(false)
        setLoadError(null)
      },
      error => {
        console.error('[reports] Failed to subscribe to sales', error)
        if (cancelled) return
        setLoading(false)
        setSummaries([])
        setLoadError(
          'We could not load today’s summary. Please try again.',
        )
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [storeId])

  const todaySummary = useMemo(
    () => summaries.find(s => s.dateKey === new Date().toISOString().slice(0, 10)) ?? null,
    [summaries],
  )

  if (storeError) {
    return (
      <div className="reports-page" role="alert">
        {storeError}
      </div>
    )
  }

  if (!storeId && !storeLoading) {
    return (
      <div className="reports-page" role="status">
        <h2>Daily summary</h2>
        <p>Select a workspace to see sales performance.</p>
      </div>
    )
  }

  return (
    <div className="page reports-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Daily summary</h2>
          <p className="page__subtitle">
            See how today is performing at a glance.
          </p>
        </div>
      </header>

      {loadError && (
        <div className="reports-page__error" role="alert">
          {loadError}
        </div>
      )}

      {loading && (
        <p className="reports-page__loading" role="status">
          Loading summary…
        </p>
      )}

      {/* Today’s headline numbers */}
      <section className="card reports-page__headline">
        <h3 className="card__title">
          Today • {formatDate(new Date())}
        </h3>

        <div className="reports-page__headline-grid">
          <div>
            <p className="reports-page__headline-label">Total sales</p>
            <p className="reports-page__headline-value">
              {formatCurrency(todaySummary?.totalSales ?? 0)}
            </p>
          </div>
          <div>
            <p className="reports-page__headline-label">Total tax</p>
            <p className="reports-page__headline-value">
              {formatCurrency(todaySummary?.totalTax ?? 0)}
            </p>
          </div>
          <div>
            <p className="reports-page__headline-label">Number of receipts</p>
            <p className="reports-page__headline-value">
              {todaySummary?.receiptCount ?? 0}
            </p>
          </div>
        </div>
      </section>

      {/* Table of recent days */}
      <section className="card reports-page__card">
        <h3 className="card__title">Recent days</h3>

        {summaries.length === 0 && !loading ? (
          <p className="reports-page__empty" role="status">
            No sales recorded yet for this workspace.
          </p>
        ) : (
          <div className="reports-page__table-wrapper">
            <table className="reports-page__table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Total sales</th>
                  <th scope="col">Total tax</th>
                  <th scope="col">Receipts</th>
                  <th scope="col">First sale</th>
                  <th scope="col">Last sale</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map(day => (
                  <tr key={day.dateKey}>
                    <th scope="row">{formatDate(day.date)}</th>
                    <td>{formatCurrency(day.totalSales)}</td>
                    <td>{formatCurrency(day.totalTax)}</td>
                    <td>{day.receiptCount}</td>
                    <td>{formatTime(day.firstSaleAt)}</td>
                    <td>{formatTime(day.lastSaleAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
