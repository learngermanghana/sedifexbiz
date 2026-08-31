import React, { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { useParams } from 'react-router-dom'
import { functions } from '../firebase'
import './PublicCustomerPortal.css'

type BookingRow = {
  id: string
  reference: string
  serviceName: string
  bookingDate: string
  bookingTime: string
  location: string
  status: string
  paymentStatus: string
  currency: string
  total: number | null
  amountReceived: number | null
  amountOutstanding: number | null
  updatedAt: string | null
}

type InvoiceRow = {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  total: number | null
  amountPaid: number | null
  balance: number | null
  dueDate: string | null
  createdAt: string | null
  updatedAt: string | null
  publicUrl: string
}

type ReceiptRow = {
  id: string
  receiptNumber: string
  reference: string
  currency: string
  amountPaid: number | null
  paymentMethod: string
  status: string
  createdAt: string | null
  publicUrl: string
}

type PaymentRow = {
  id: string
  kind: 'receipt' | 'payment_confirmation'
  title: string
  reference: string
  currency: string
  amountPaid: number | null
  paymentMethod: string
  status: string
  createdAt: string | null
  publicUrl: string
}

type PortalData = {
  ok: boolean
  expiresAt: string
  customer: { name: string; email: string; phone: string }
  brand: { storeName: string; email: string; phone: string; logoUrl: string; brandColor: string; address: string; town: string; country: string }
  summary: { upcomingBookings: number; invoices: number; payments?: number; receipts: number; outstanding: number; currency: string }
  bookings: BookingRow[]
  invoices: InvoiceRow[]
  payments?: PaymentRow[]
  receipts: ReceiptRow[]
}

function formatMoney(value: number | null | undefined, currency = 'GHS') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function statusLabel(value: string) {
  return (value || 'pending').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function safeBrandColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#4f46e5'
}

export default function PublicCustomerPortal() {
  const { token = '' } = useParams<{ token?: string }>()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<'bookings' | 'invoices' | 'payments'>('bookings')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const getPortal = httpsCallable<{ token: string }, PortalData>(functions, 'getCustomerPortal')
        const response = await getPortal({ token })
        if (!active) return
        setData(response.data)
        document.title = `${response.data.brand.storeName} — Customer portal`
      } catch (loadError) {
        if (!active) return
        const raw = loadError && typeof loadError === 'object' && 'message' in loadError
          ? String((loadError as { message?: unknown }).message || '')
          : ''
        setError(raw.replace(/^FirebaseError:\s*/i, '') || 'This customer portal is unavailable.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [token])

  const storeAddress = useMemo(() => {
    if (!data) return ''
    return [data.brand.address, data.brand.town, data.brand.country].filter(Boolean).join(', ')
  }, [data])

  if (loading) {
    return <main className="customer-portal customer-portal--state"><div className="customer-portal__state-card"><strong>Loading your portal…</strong><p>Connecting securely to the business.</p></div></main>
  }

  if (error || !data) {
    return <main className="customer-portal customer-portal--state"><div className="customer-portal__state-card"><strong>Portal unavailable</strong><p>{error || 'This customer portal link is invalid or has expired.'}</p></div></main>
  }

  const brandColor = safeBrandColor(data.brand.brandColor)
  const contactHref = data.brand.phone ? `tel:${data.brand.phone}` : data.brand.email ? `mailto:${data.brand.email}` : ''
  const paymentRows: PaymentRow[] = data.payments ?? data.receipts.map(receipt => ({
    id: receipt.id,
    kind: 'receipt' as const,
    title: receipt.receiptNumber,
    reference: receipt.reference,
    currency: receipt.currency,
    amountPaid: receipt.amountPaid,
    paymentMethod: receipt.paymentMethod,
    status: receipt.status,
    createdAt: receipt.createdAt,
    publicUrl: receipt.publicUrl,
  }))

  return (
    <main className="customer-portal" style={{ '--customer-portal-accent': brandColor } as React.CSSProperties}>
      <header className="customer-portal__header">
        <div className="customer-portal__brand">
          {data.brand.logoUrl ? <img src={data.brand.logoUrl} alt="" /> : <span>{data.brand.storeName.slice(0, 2).toUpperCase()}</span>}
          <div><small>Customer portal</small><h1>{data.brand.storeName}</h1></div>
        </div>
        {contactHref ? <a className="customer-portal__contact" href={contactHref}>Contact business</a> : null}
      </header>

      <section className="customer-portal__welcome">
        <div><span>Welcome</span><h2>{data.customer.name}</h2><p>Review your bookings, invoices, payments and receipts in one place.</p></div>
        <small>Private link · expires {formatDate(data.expiresAt)}</small>
      </section>

      <section className="customer-portal__summary" aria-label="Account summary">
        <article><span>Upcoming bookings</span><strong>{data.summary.upcomingBookings}</strong></article>
        <article><span>Invoices</span><strong>{data.summary.invoices}</strong></article>
        <article><span>Payments</span><strong>{data.summary.payments ?? paymentRows.length}</strong></article>
        <article><span>Outstanding</span><strong>{formatMoney(data.summary.outstanding, data.summary.currency)}</strong></article>
      </section>

      <nav className="customer-portal__tabs" aria-label="Portal sections">
        <button type="button" className={activeSection === 'bookings' ? 'is-active' : ''} onClick={() => setActiveSection('bookings')}>Bookings</button>
        <button type="button" className={activeSection === 'invoices' ? 'is-active' : ''} onClick={() => setActiveSection('invoices')}>Invoices</button>
        <button type="button" className={activeSection === 'payments' ? 'is-active' : ''} onClick={() => setActiveSection('payments')}>Payments & receipts</button>
      </nav>

      <section className="customer-portal__content">
        {activeSection === 'bookings' ? (
          data.bookings.length ? <div className="customer-portal__records">{data.bookings.map(booking => (
            <article className="customer-portal__record" key={booking.id}>
              <div className="customer-portal__record-head"><div><small>Booking</small><h3>{booking.serviceName}</h3></div><span>{statusLabel(booking.status)}</span></div>
              <dl>
                <div><dt>Date</dt><dd>{booking.bookingDate || '—'}{booking.bookingTime ? ` · ${booking.bookingTime}` : ''}</dd></div>
                <div><dt>Reference</dt><dd>{booking.reference}</dd></div>
                {booking.location ? <div><dt>Location</dt><dd>{booking.location}</dd></div> : null}
                <div><dt>Payment</dt><dd>{statusLabel(booking.paymentStatus)}</dd></div>
                <div><dt>Total</dt><dd>{formatMoney(booking.total, booking.currency)}</dd></div>
                <div><dt>Balance</dt><dd>{formatMoney(booking.amountOutstanding, booking.currency)}</dd></div>
              </dl>
            </article>
          ))}</div> : <div className="customer-portal__empty">No bookings are linked to this customer yet.</div>
        ) : null}

        {activeSection === 'invoices' ? (
          data.invoices.length ? <div className="customer-portal__records">{data.invoices.map(invoice => (
            <article className="customer-portal__record" key={invoice.id}>
              <div className="customer-portal__record-head"><div><small>Invoice</small><h3>{invoice.invoiceNumber}</h3></div><span>{statusLabel(invoice.status)}</span></div>
              <dl>
                <div><dt>Total</dt><dd>{formatMoney(invoice.total, invoice.currency)}</dd></div>
                <div><dt>Paid</dt><dd>{formatMoney(invoice.amountPaid, invoice.currency)}</dd></div>
                <div><dt>Balance</dt><dd>{formatMoney(invoice.balance, invoice.currency)}</dd></div>
                <div><dt>Due</dt><dd>{formatDate(invoice.dueDate)}</dd></div>
              </dl>
              {invoice.publicUrl ? <a className="customer-portal__document-link" href={invoice.publicUrl} target="_blank" rel="noreferrer">View invoice</a> : null}
            </article>
          ))}</div> : <div className="customer-portal__empty">No invoices are linked to this customer yet.</div>
        ) : null}

        {activeSection === 'payments' ? (
          paymentRows.length ? <div className="customer-portal__records">{paymentRows.map(payment => (
            <article className="customer-portal__record" key={`${payment.kind}-${payment.id}`}>
              <div className="customer-portal__record-head"><div><small>{payment.kind === 'receipt' ? 'Receipt' : 'Payment confirmation'}</small><h3>{payment.title}</h3></div><span>{statusLabel(payment.status)}</span></div>
              <dl>
                <div><dt>Amount</dt><dd>{formatMoney(payment.amountPaid, payment.currency)}</dd></div>
                <div><dt>Method</dt><dd>{payment.paymentMethod || '—'}</dd></div>
                <div><dt>Date</dt><dd>{formatDate(payment.createdAt)}</dd></div>
                {payment.reference ? <div><dt>Reference</dt><dd>{payment.reference}</dd></div> : null}
              </dl>
              {payment.kind === 'receipt' && payment.publicUrl ? <a className="customer-portal__document-link" href={payment.publicUrl} target="_blank" rel="noreferrer">View receipt</a> : null}
            </article>
          ))}</div> : <div className="customer-portal__empty">No payments or receipts are linked to this customer yet.</div>
        ) : null}
      </section>

      <footer className="customer-portal__footer">
        <strong>{data.brand.storeName}</strong>
        {storeAddress ? <span>{storeAddress}</span> : null}
        <span>{[data.brand.phone, data.brand.email].filter(Boolean).join(' · ')}</span>
        <small>Powered by Sedifex · Keep this private link secure.</small>
      </footer>
    </main>
  )
}
