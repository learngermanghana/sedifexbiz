import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { BrowserQRCodeSvgWriter } from '@zxing/browser'
import { EncodeHintType, QRCodeDecoderErrorCorrectionLevel } from '@zxing/library'
import { displayDb, ensureDisplayAuth } from '../firebaseDisplay'
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
  items?: DisplayItem[]
  totals?: DisplayTotals
  updatedAt?: any
  cashierName?: string | null
  storeName?: string | null
  pairCode?: string | null
  saleId?: string | null
  receiptUrl?: string | null
  status?: 'active' | 'inactive'
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
  const pairCode = searchParams.get('code')?.trim() || ''

  const [session, setSession] = useState<DisplaySession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receiptQrSvg, setReceiptQrSvg] = useState<string | null>(null)

  const updatedAtLabel = useMemo(() => formatUpdatedAt(session?.updatedAt), [session?.updatedAt])
  const receiptUrl = useMemo(() => {
    if (session?.receiptUrl) return session.receiptUrl
    if (session?.saleId) return `${window.location.origin}/receipt/${encodeURIComponent(session.saleId)}`
    return null
  }, [session?.receiptUrl, session?.saleId])

  useEffect(() => {
    if (!storeId || !sessionId) {
      setError('Missing store or session ID. Scan the QR again or enter a code.')
      setSession(null)
      return
    }

    let isMounted = true
    let unsubscribe: (() => void) | null = null

    const subscribe = async () => {
      try {
        await ensureDisplayAuth()
      } catch (error) {
        if (!isMounted) return
        console.warn('[customer-display] Unable to authenticate display session', error)
        setSession(null)
        setError('Unable to connect to the session. Check your connection and try again.')
        return
      }

      if (!isMounted) return

      setError(null)
      const ref = doc(displayDb, 'stores', storeId, 'displaySessions', sessionId)
      unsubscribe = onSnapshot(
        ref,
        snap => {
          if (!snap.exists()) {
            setSession(null)
            setError('Session not found. Ask the cashier to start a new customer display.')
            return
          }
          const data = snap.data() as DisplaySession
          if (data.pairCode) {
            if (!pairCode) {
              setSession(null)
              setError('Missing pairing code. Scan the cashier’s QR code again.')
              return
            }
            if (pairCode !== data.pairCode) {
              setSession(null)
              setError('Pairing code does not match. Ask the cashier to restart the display.')
              return
            }
          }
          setError(null)
          setSession(data)
        },
        () => {
          setError('Unable to connect to the session. Check your connection and try again.')
        },
      )
    }

    void subscribe()

    return () => {
      isMounted = false
      if (unsubscribe) unsubscribe()
    }
  }, [pairCode, sessionId, storeId])

  useEffect(() => {
    if (!receiptUrl) {
      setReceiptQrSvg(null)
      return
    }

    try {
      const writer = new BrowserQRCodeSvgWriter()
      const encodeHints = new Map<EncodeHintType, unknown>()
      encodeHints.set(EncodeHintType.MARGIN, 2)
      encodeHints.set(EncodeHintType.ERROR_CORRECTION, QRCodeDecoderErrorCorrectionLevel.H)

      const svg = writer.write(receiptUrl, 200, 200, encodeHints)
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', 'Receipt QR code')
      svg.setAttribute('width', '200')
      svg.setAttribute('height', '200')
      svg.setAttribute('viewBox', '0 0 200 200')
      setReceiptQrSvg(svg.outerHTML)
    } catch (error) {
      console.warn('[customer-display] Failed to build receipt QR code', error)
      setReceiptQrSvg(null)
    }
  }, [receiptUrl])

  if (error) {
    return (
      <main className="customer-display">
        <div className="customer-display__card">
          <p className="customer-display__status">{error}</p>
          <p className="customer-display__hint">Open <strong>sedifex.com/display</strong> on your phone and scan the cashier’s QR code.</p>
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

  const items = session.items ?? []
  const totals = session.totals ?? { subTotal: 0, taxTotal: 0, discount: 0, total: 0 }
  const isInactive = session.status === 'inactive'
  const shouldShowCart = !isInactive
  const shouldShowReceipt = isInactive && !!receiptUrl

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
            {session.pairCode ? <p>Pairing code: {session.pairCode}</p> : null}
            {updatedAtLabel ? <p>Updated: {updatedAtLabel}</p> : null}
          </div>
        </div>

        {shouldShowCart ? (
          <>
            {items.length ? (
              <div className="customer-display__table">
                <div className="customer-display__row customer-display__row--head">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Amount</span>
                </div>
                {items.map((item, index) => (
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
                <span>{formatCurrency(totals.subTotal)}</span>
              </div>
              <div className="customer-display__total-row">
                <span>VAT / Tax</span>
                <span>{formatCurrency(totals.taxTotal)}</span>
              </div>
              <div className="customer-display__total-row">
                <span>Discount</span>
                <span>{formatCurrency(totals.discount)}</span>
              </div>
              <div className="customer-display__total-row customer-display__total-row--grand">
                <strong>Total</strong>
                <strong>{formatCurrency(totals.total)}</strong>
              </div>
            </div>
          </>
        ) : (
          <p className="customer-display__status">Sale complete — scan receipt.</p>
        )}

        {shouldShowReceipt ? (
          <div className="customer-display__receipt">
            <div>
              <p className="customer-display__receipt-title">Scan to get your receipt</p>
              <p className="customer-display__receipt-subtitle">Open the receipt on your phone and download a PDF copy.</p>
            </div>
            {receiptQrSvg ? (
              <div className="customer-display__receipt-qr" dangerouslySetInnerHTML={{ __html: receiptQrSvg }} aria-hidden={!receiptQrSvg} />
            ) : (
              <div className="customer-display__receipt-qr customer-display__receipt-qr--empty">QR unavailable</div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  )
}
