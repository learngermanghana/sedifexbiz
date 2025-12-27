import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import './CustomerDisplay.css'

type DisplayItem = {
  name: string
  qty: number
  price: number
  lineTotal: number
}

type DisplayTotals = {
  subTotal: number
  taxTotal: number
  discount: number
  total: number
}

type DisplaySession = {
  items: DisplayItem[]
  totals: DisplayTotals
  updatedAt?: any
  cashierName?: string | null
  storeName?: string | null
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'GHS 0.00'
  return `GHS ${amount.toFixed(2)}`
}

function formatUpdatedAt(value: any): string | null {
  if (!value) return null
  try {
    if (typeof value.toDate === 'function') {
      const date = value.toDate()
      return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString()
    }
    if (value instanceof Date) return value.toLocaleTimeString()
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleTimeString()
  } catch {
    return null
  }
}

export default function CustomerDisplay() {
  const [searchParams] = useSearchParams()
  const storeId = searchParams.get('storeId')?.trim() || ''
  const sessionId = searchParams.get('sessionId')?.trim() || ''

  const [session, setSession] = useState<DisplaySession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updatedAtLabel = useMemo(() => formatUpdatedAt(session?.updatedAt), [session?.updatedAt])

  useEffect(() => {
    if (!storeId || !sessionId) {
      setError('Missing store or session ID. Scan the QR again or enter a code.')
      setSession(null)
      return
    }

    setError(null)
    const ref = doc(db, 'stores', storeId, 'displaySessions', sessionId)
    return onSnapshot(
      ref,
      snap => {
        if (!snap.exists()) {
          setSession(null)
          setError('Session not found. Ask the cashier to start a new customer display.')
          return
        }
        setError(null)
        setSession(snap.data() as DisplaySession)
      },
      () => {
        setError('Unable to connect to the session. Check your connection and try again.')
      },
    )
  }, [sessionId, storeId])

  if (error) {
    return (
      <main className="customer-display">
        <div className="customer-display__card">
          <p className="customer-display__status">{error}</p>
          <p className="customer-display__hint">Open <strong>sedifex.app/display</strong> on your phone and scan the cashier’s QR code.</p>
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="customer-display">
        <div className="customer-display__card">
          <p className="customer-display__status">Waiting for cart updates…</p>
          <p className="customer-display__hint">Keep this screen open while the cashier adds items.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="customer-display">
      <div className="customer-display__card">
        <div className="customer-display__header">
          <div>
            <p className="customer-display__eyebrow">Customer display</p>
            <h1 className="customer-display__title">{session.storeName ?? 'Sedifex'}</h1>
          </div>
          <div className="customer-display__meta">
            {session.cashierName ? <p>Cashier: {session.cashierName}</p> : null}
            {updatedAtLabel ? <p>Updated: {updatedAtLabel}</p> : null}
          </div>
        </div>

        {session.items.length ? (
          <div className="customer-display__table">
            <div className="customer-display__row customer-display__row--head">
              <span>Item</span>
              <span>Qty</span>
              <span>Amount</span>
            </div>
            {session.items.map((item, index) => (
              <div className="customer-display__row" key={`${item.name}-${index}`}>
                <div className="customer-display__item">
                  <span className="customer-display__item-name">{item.name}</span>
                  <span className="customer-display__item-price">{formatCurrency(item.price)} each</span>
                </div>
                <span className="customer-display__qty">{item.qty}</span>
                <span className="customer-display__amount">{formatCurrency(item.lineTotal)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="customer-display__status">No items yet. The cart will appear here.</p>
        )}

        <div className="customer-display__totals">
          <div className="customer-display__total-row">
            <span>Subtotal</span>
            <span>{formatCurrency(session.totals.subTotal)}</span>
          </div>
          <div className="customer-display__total-row">
            <span>VAT / Tax</span>
            <span>{formatCurrency(session.totals.taxTotal)}</span>
          </div>
          <div className="customer-display__total-row">
            <span>Discount</span>
            <span>{formatCurrency(session.totals.discount)}</span>
          </div>
          <div className="customer-display__total-row customer-display__total-row--grand">
            <strong>Total</strong>
            <strong>{formatCurrency(session.totals.total)}</strong>
          </div>
        </div>
      </div>
    </main>
  )
}
