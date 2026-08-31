import React, { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { useParams, useSearchParams } from 'react-router-dom'
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

type PortalBookingRequest = {
  bookingId: string
  id: string
  type: 'reschedule' | 'cancel'
  status: 'pending' | 'approved' | 'rejected'
  requestedDate: string
  requestedTime: string
  note: string
  previousDate: string
  previousTime: string
  submittedAt: string | null
  reviewedAt: string | null
  reviewedBy: string
  decisionNote: string
}

type SelfServiceState = {
  ok: boolean
  requests: PortalBookingRequest[]
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

type SubmitRequestResponse = { ok: boolean; request: PortalBookingRequest }
type PaymentCheckoutResponse = { ok: boolean; checkoutUrl: string; reference: string; amount: number; currency: string }
type BookingAction = 'reschedule' | 'cancel'

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

function actionErrorMessage(error: unknown) {
  const raw = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : ''
  return raw
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^functions\/[a-z-]+:\s*/i, '')
    || 'Unable to complete this request right now.'
}

export default function PublicCustomerPortal() {
  const { token = '' } = useParams<{ token?: string }>()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<PortalData | null>(null)
  const [selfService, setSelfService] = useState<SelfServiceState>({ ok: true, requests: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<'bookings' | 'invoices' | 'payments'>('bookings')
  const [actionBookingId, setActionBookingId] = useState('')
  const [actionType, setActionType] = useState<BookingAction | ''>('')
  const [requestedDate, setRequestedDate] = useState('')
  const [requestedTime, setRequestedTime] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [payingBookingId, setPayingBookingId] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const paymentReturning = searchParams.get('payment') === 'returning'

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

        try {
          const getSelfService = httpsCallable<{ token: string }, SelfServiceState>(functions, 'getCustomerPortalSelfServiceState')
          const selfServiceResponse = await getSelfService({ token })
          if (active) setSelfService(selfServiceResponse.data)
        } catch (selfServiceError) {
          console.warn('[customer-portal] Self-service state unavailable', selfServiceError)
        }
      } catch (loadError) {
        if (!active) return
        setError(actionErrorMessage(loadError) || 'This customer portal is unavailable.')
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

  const requestByBooking = useMemo(() => {
    const map = new Map<string, PortalBookingRequest>()
    selfService.requests.forEach(request => map.set(request.bookingId, request))
    return map
  }, [selfService.requests])

  function openBookingAction(booking: BookingRow, type: BookingAction) {
    setActionBookingId(booking.id)
    setActionType(type)
    setRequestedDate(type === 'reschedule' ? booking.bookingDate : '')
    setRequestedTime(type === 'reschedule' ? booking.bookingTime : '')
    setActionNote('')
    setActionMessage('')
    setActionError('')
  }

  function closeBookingAction() {
    setActionBookingId('')
    setActionType('')
    setRequestedDate('')
    setRequestedTime('')
    setActionNote('')
  }

  async function submitBookingRequest(booking: BookingRow) {
    if (!actionType) return
    if (actionType === 'reschedule' && (!requestedDate || !requestedTime)) {
      setActionError('Choose the new date and time you would like to request.')
      return
    }
    setActionBusy(true)
    setActionError('')
    setActionMessage('')
    try {
      const submitRequest = httpsCallable<{
        token: string
        bookingId: string
        action: BookingAction
        requestedDate: string
        requestedTime: string
        note: string
      }, SubmitRequestResponse>(functions, 'submitCustomerPortalBookingRequest')
      const response = await submitRequest({
        token,
        bookingId: booking.id,
        action: actionType,
        requestedDate: actionType === 'reschedule' ? requestedDate : '',
        requestedTime: actionType === 'reschedule' ? requestedTime : '',
        note: actionNote,
      })
      setSelfService(previous => ({
        ...previous,
        requests: [...previous.requests.filter(item => item.bookingId !== booking.id), response.data.request],
      }))
      setActionMessage('Your request was sent to the business. Sedifex will show the decision here when it is reviewed.')
      closeBookingAction()
    } catch (requestError) {
      setActionError(actionErrorMessage(requestError))
    } finally {
      setActionBusy(false)
    }
  }

  async function payBookingBalance(booking: BookingRow) {
    setPayingBookingId(booking.id)
    setActionError('')
    setActionMessage('')
    try {
      const createCheckout = httpsCallable<{ token: string; bookingId: string }, PaymentCheckoutResponse>(functions, 'createCustomerPortalPaymentCheckout')
      const response = await createCheckout({ token, bookingId: booking.id })
      if (!response.data.checkoutUrl) throw new Error('Secure checkout is unavailable.')
      window.location.assign(response.data.checkoutUrl)
    } catch (paymentError) {
      setActionError(actionErrorMessage(paymentError))
      setPayingBookingId('')
    }
  }

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

      {paymentReturning ? (
        <div className="customer-portal__notice customer-portal__notice--payment" role="status">
          <strong>Payment returned to Sedifex.</strong>
          <span>We are verifying the transaction. Your balance and payment history update automatically after confirmation. Refresh this page shortly if the payment is not visible yet.</span>
        </div>
      ) : null}
      {actionMessage ? <div className="customer-portal__notice customer-portal__notice--success" role="status">{actionMessage}</div> : null}
      {actionError ? <div className="customer-portal__notice customer-portal__notice--error" role="alert">{actionError}</div> : null}

      <nav className="customer-portal__tabs" aria-label="Portal sections">
        <button type="button" className={activeSection === 'bookings' ? 'is-active' : ''} onClick={() => setActiveSection('bookings')}>Bookings</button>
        <button type="button" className={activeSection === 'invoices' ? 'is-active' : ''} onClick={() => setActiveSection('invoices')}>Invoices</button>
        <button type="button" className={activeSection === 'payments' ? 'is-active' : ''} onClick={() => setActiveSection('payments')}>Payments & receipts</button>
      </nav>

      <section className="customer-portal__content">
        {activeSection === 'bookings' ? (
          data.bookings.length ? <div className="customer-portal__records">{data.bookings.map(booking => {
            const normalizedBookingStatus = booking.status.toLowerCase().replace(/[\s-]+/g, '_')
            const normalizedPaymentStatus = booking.paymentStatus.toLowerCase().replace(/[\s-]+/g, '_')
            const isClosed = ['cancelled', 'canceled', 'completed', 'complete'].includes(normalizedBookingStatus)
            const isPaid = ['paid', 'confirmed', 'success', 'succeeded', 'captured', 'complete', 'completed', 'paid_cash'].includes(normalizedPaymentStatus)
            const displayOutstanding = isPaid ? 0 : booking.amountOutstanding
            const request = requestByBooking.get(booking.id)
            const pendingRequest = request?.status === 'pending'
            const canPay = !isClosed && !isPaid && typeof displayOutstanding === 'number' && displayOutstanding > 0
            const isEditingAction = actionBookingId === booking.id && Boolean(actionType)
            return (
              <article className="customer-portal__record" key={booking.id}>
                <div className="customer-portal__record-head"><div><small>Booking</small><h3>{booking.serviceName}</h3></div><span>{statusLabel(booking.status)}</span></div>
                <dl>
                  <div><dt>Date</dt><dd>{booking.bookingDate || '—'}{booking.bookingTime ? ` · ${booking.bookingTime}` : ''}</dd></div>
                  <div><dt>Reference</dt><dd>{booking.reference}</dd></div>
                  {booking.location ? <div><dt>Location</dt><dd>{booking.location}</dd></div> : null}
                  <div><dt>Payment</dt><dd>{statusLabel(booking.paymentStatus)}</dd></div>
                  <div><dt>Total</dt><dd>{formatMoney(booking.total, booking.currency)}</dd></div>
                  <div><dt>Balance</dt><dd>{formatMoney(displayOutstanding, booking.currency)}</dd></div>
                </dl>

                {request ? (
                  <div className={`customer-portal__request-state customer-portal__request-state--${request.status}`}>
                    <div><strong>{request.type === 'cancel' ? 'Cancellation request' : 'Reschedule request'}</strong><span>{statusLabel(request.status)}</span></div>
                    {request.type === 'reschedule' ? <p>Requested: {request.requestedDate || '—'}{request.requestedTime ? ` · ${request.requestedTime}` : ''}</p> : null}
                    {request.note ? <p>Your note: {request.note}</p> : null}
                    {request.decisionNote ? <p>Business note: {request.decisionNote}</p> : null}
                    {request.submittedAt ? <small>Sent {formatDate(request.submittedAt)}</small> : null}
                  </div>
                ) : null}

                {!isClosed ? (
                  <div className="customer-portal__record-actions">
                    {canPay ? (
                      <button type="button" className="customer-portal__action-button customer-portal__action-button--primary" disabled={Boolean(payingBookingId)} onClick={() => void payBookingBalance(booking)}>
                        {payingBookingId === booking.id ? 'Opening secure payment…' : `Pay balance · ${formatMoney(displayOutstanding, booking.currency)}`}
                      </button>
                    ) : null}
                    {!pendingRequest ? (
                      <>
                        <button type="button" className="customer-portal__action-button" onClick={() => openBookingAction(booking, 'reschedule')}>Request new time</button>
                        <button type="button" className="customer-portal__action-button" onClick={() => openBookingAction(booking, 'cancel')}>Request cancellation</button>
                      </>
                    ) : <span className="customer-portal__request-waiting">Waiting for the business to review your request.</span>}
                  </div>
                ) : null}

                {isEditingAction ? (
                  <div className="customer-portal__action-form">
                    <div className="customer-portal__action-form-head">
                      <strong>{actionType === 'reschedule' ? 'Request a new date and time' : 'Request cancellation'}</strong>
                      <button type="button" onClick={closeBookingAction}>Close</button>
                    </div>
                    {actionType === 'reschedule' ? (
                      <div className="customer-portal__action-form-grid">
                        <label><span>New date</span><input type="date" value={requestedDate} onChange={event => setRequestedDate(event.target.value)} /></label>
                        <label><span>New time</span><input type="time" value={requestedTime} onChange={event => setRequestedTime(event.target.value)} /></label>
                      </div>
                    ) : <p>The booking will stay unchanged until the business approves this request.</p>}
                    <label className="customer-portal__action-note"><span>{actionType === 'cancel' ? 'Reason or note (optional)' : 'Note to the business (optional)'}</span><textarea rows={3} value={actionNote} onChange={event => setActionNote(event.target.value)} maxLength={1200} /></label>
                    <div className="customer-portal__action-form-actions">
                      <button type="button" onClick={closeBookingAction} disabled={actionBusy}>Keep current booking</button>
                      <button type="button" className="customer-portal__action-button--primary" onClick={() => void submitBookingRequest(booking)} disabled={actionBusy}>{actionBusy ? 'Sending…' : 'Send request'}</button>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}</div> : <div className="customer-portal__empty">No bookings are linked to this customer yet.</div>
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
