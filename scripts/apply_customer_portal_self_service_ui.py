from pathlib import Path

path = Path('web/src/pages/BookingEditor.tsx')
text = path.read_text()

text = text.replace(
"import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, type DocumentData, type DocumentReference } from 'firebase/firestore'\nimport { db } from '../firebase'",
"import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, type DocumentData, type DocumentReference } from 'firebase/firestore'\nimport { httpsCallable } from 'firebase/functions'\nimport { db, functions } from '../firebase'",
1,
)

booking_type_end = """type BookingFormState = {
  fullName: string
  phone: string
  email: string
  serviceName: string
  serviceId: string
  bookingDate: string
  bookingTime: string
  preferredBranch: string
  preferredContactMethod: string
  status: string
  quantity: string
  notes: string
  paymentAmount: string
  depositAmount: string
  paymentMethod: string
  paymentReference: string
  paymentStatus: string
}
"""
request_type = booking_type_end + """
type CustomerPortalRequestState = {
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

type PortalRequestDecisionResponse = {
  ok: boolean
  request: CustomerPortalRequestState
  bookingDate: string
  bookingTime: string
  bookingStatus: string
}
"""
if booking_type_end not in text:
    raise SystemExit('BookingFormState marker missing')
text = text.replace(booking_type_end, request_type, 1)

first_string = """function firstStringValue(...values: unknown[]): string {
  for (const value of values) {
    const str = stringValue(value).trim()
    if (str) return str
  }
  return ''
}
"""
request_helper = first_string + """
function normalizeCustomerPortalRequest(value: unknown, bookingId: string): CustomerPortalRequestState | null {
  const request = recordValue(value)
  const id = firstStringValue(request.id)
  if (!id) return null
  const rawType = firstStringValue(request.type).toLowerCase()
  const rawStatus = firstStringValue(request.status).toLowerCase()
  return {
    bookingId,
    id,
    type: rawType === 'cancel' ? 'cancel' : 'reschedule',
    status: rawStatus === 'approved' ? 'approved' : rawStatus === 'rejected' ? 'rejected' : 'pending',
    requestedDate: firstStringValue(request.requestedDate),
    requestedTime: firstStringValue(request.requestedTime),
    note: firstStringValue(request.note),
    previousDate: firstStringValue(request.previousDate),
    previousTime: firstStringValue(request.previousTime),
    submittedAt: stringValue(request.submittedAt) || null,
    reviewedAt: stringValue(request.reviewedAt) || null,
    reviewedBy: firstStringValue(request.reviewedBy),
    decisionNote: firstStringValue(request.decisionNote),
  }
}
"""
if first_string not in text:
    raise SystemExit('firstStringValue marker missing')
text = text.replace(first_string, request_helper, 1)

state_marker = """  const [existingPaymentConfirmedAt, setExistingPaymentConfirmedAt] = useState<unknown>(null)
  const [paymentStatusReviewed, setPaymentStatusReviewed] = useState(false)
  const { publish } = useToast()
"""
state_replacement = """  const [existingPaymentConfirmedAt, setExistingPaymentConfirmedAt] = useState<unknown>(null)
  const [paymentStatusReviewed, setPaymentStatusReviewed] = useState(false)
  const [portalRequest, setPortalRequest] = useState<CustomerPortalRequestState | null>(null)
  const [portalDecisionNote, setPortalDecisionNote] = useState('')
  const [reviewingPortalRequest, setReviewingPortalRequest] = useState(false)
  const { publish } = useToast()
"""
if state_marker not in text:
    raise SystemExit('state marker missing')
text = text.replace(state_marker, state_replacement, 1)

create_marker = """    if (!storeId || isCreateMode) {
      setExistingPaymentConfirmedAt(null)
      setPaymentStatusReviewed(false)
      setLoading(false)
      return
    }
"""
create_replacement = """    if (!storeId || isCreateMode) {
      setExistingPaymentConfirmedAt(null)
      setPaymentStatusReviewed(false)
      setPortalRequest(null)
      setPortalDecisionNote('')
      setLoading(false)
      return
    }
"""
if create_marker not in text:
    raise SystemExit('create-mode marker missing')
text = text.replace(create_marker, create_replacement, 1)

load_marker = """        setForm(normalizeBookingForm(data))
        setExistingPaymentConfirmedAt(data.paymentConfirmedAt ?? data.payment_confirmed_at ?? null)
        setPaymentStatusReviewed(false)
"""
load_replacement = """        setForm(normalizeBookingForm(data))
        setExistingPaymentConfirmedAt(data.paymentConfirmedAt ?? data.payment_confirmed_at ?? null)
        setPaymentStatusReviewed(false)
        setPortalRequest(normalizeCustomerPortalRequest(data.customerPortalRequest, bookingId))
        setPortalDecisionNote('')
"""
if load_marker not in text:
    raise SystemExit('load marker missing')
text = text.replace(load_marker, load_replacement, 1)

handler_marker = """  async function handleDeleteBooking() {
"""
handler = """  async function handlePortalRequestDecision(decision: 'approve' | 'reject') {
    if (!storeId || isCreateMode || !portalRequest || portalRequest.status !== 'pending') return
    setReviewingPortalRequest(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const reviewRequest = httpsCallable<{
        storeId: string
        bookingId: string
        decision: 'approve' | 'reject'
        note: string
      }, PortalRequestDecisionResponse>(functions, 'reviewCustomerPortalBookingRequest')
      const response = await reviewRequest({ storeId, bookingId, decision, note: portalDecisionNote })
      setPortalRequest(response.data.request)
      if (decision === 'approve' && response.data.request.type === 'reschedule') {
        setForm(previous => ({
          ...previous,
          bookingDate: response.data.bookingDate || previous.bookingDate,
          bookingTime: response.data.bookingTime || previous.bookingTime,
        }))
      }
      if (decision === 'approve' && response.data.request.type === 'cancel') {
        setForm(previous => ({ ...previous, status: 'cancelled' }))
      }
      const message = decision === 'approve'
        ? 'Customer request approved. Sedifex updated the booking and will handle the customer notification.'
        : 'Customer request rejected. Sedifex has recorded the decision and notified the customer when email is available.'
      setSuccessMessage(message)
      publish({ tone: 'success', message })
      void playSound('success')
    } catch (error) {
      console.error('[booking-editor] Failed to review customer portal request', error)
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '').replace(/^FirebaseError:\\s*/i, '')
        : 'Unable to review this customer request right now.'
      setErrorMessage(message || 'Unable to review this customer request right now.')
      publish({ tone: 'error', message: message || 'Unable to review this customer request right now.' })
      void playSound('error')
    } finally {
      setReviewingPortalRequest(false)
    }
  }

""" + handler_marker
if handler_marker not in text:
    raise SystemExit('delete handler marker missing')
text = text.replace(handler_marker, handler, 1)

form_marker = """          >
            <label><span>Customer name</span><input value={form.fullName} onChange={event => setForm(prev => ({ ...prev, fullName: event.target.value }))} required /></label>
"""
portal_panel = """          >
            {portalRequest ? (
              <section className={`booking-editor-page__portal-request booking-editor-page__portal-request--${portalRequest.status}`}>
                <div className="booking-editor-page__portal-request-heading">
                  <div>
                    <small>Customer portal request</small>
                    <strong>{portalRequest.type === 'cancel' ? 'Cancellation requested' : 'Reschedule requested'}</strong>
                  </div>
                  <span className={`booking-editor-page__status-badge booking-editor-page__status-badge--${portalRequest.status === 'pending' ? 'pending' : portalRequest.status === 'approved' ? 'confirmed' : 'cancelled'}`}>
                    {portalRequest.status === 'pending' ? 'Needs review' : portalRequest.status === 'approved' ? 'Approved' : 'Rejected'}
                  </span>
                </div>
                <div className="booking-editor-page__portal-request-details">
                  {portalRequest.type === 'reschedule' ? <span><strong>Requested:</strong> {portalRequest.requestedDate || '—'}{portalRequest.requestedTime ? ` · ${portalRequest.requestedTime}` : ''}</span> : <span><strong>Request:</strong> Cancel this booking</span>}
                  {portalRequest.previousDate ? <span><strong>Current:</strong> {portalRequest.previousDate}{portalRequest.previousTime ? ` · ${portalRequest.previousTime}` : ''}</span> : null}
                  {portalRequest.note ? <span><strong>Customer note:</strong> {portalRequest.note}</span> : null}
                  {portalRequest.decisionNote ? <span><strong>Business note:</strong> {portalRequest.decisionNote}</span> : null}
                </div>
                {portalRequest.status === 'pending' ? (
                  <div className="booking-editor-page__portal-request-review">
                    <label className="booking-editor-page__portal-request-note"><span>Reply / decision note (optional)</span><textarea rows={3} maxLength={1200} value={portalDecisionNote} onChange={event => setPortalDecisionNote(event.target.value)} placeholder="Add a short reason or alternative for the customer" /></label>
                    <div className="booking-editor-page__portal-request-actions">
                      <button type="button" className="button" disabled={reviewingPortalRequest} onClick={() => void handlePortalRequestDecision('reject')}>Reject request</button>
                      <button type="button" className="button button--primary" disabled={reviewingPortalRequest} onClick={() => void handlePortalRequestDecision('approve')}>{reviewingPortalRequest ? 'Saving decision…' : 'Approve request'}</button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <label><span>Customer name</span><input value={form.fullName} onChange={event => setForm(prev => ({ ...prev, fullName: event.target.value }))} required /></label>
"""
if form_marker not in text:
    raise SystemExit('form insertion marker missing')
text = text.replace(form_marker, portal_panel, 1)

path.write_text(text)

css_path = Path('web/src/pages/BookingEditor.css')
css = css_path.read_text()
css_marker = '.booking-editor-page__portal-request {'
if css_marker not in css:
    css += """

.booking-editor-page__portal-request {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid #f59e0b;
  border-radius: 14px;
  background: #fffbeb;
}

.booking-editor-page__portal-request--approved {
  border-color: #86efac;
  background: #f0fdf4;
}

.booking-editor-page__portal-request--rejected {
  border-color: #fecaca;
  background: #fef2f2;
}

.booking-editor-page__portal-request-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.booking-editor-page__portal-request-heading div {
  display: grid;
  gap: 0.2rem;
}

.booking-editor-page__portal-request-heading small {
  color: #64748b;
  font-weight: 700;
}

.booking-editor-page__portal-request-details {
  display: grid;
  gap: 0.4rem;
  color: #475569;
  font-size: 0.9rem;
}

.booking-editor-page__portal-request-review {
  display: grid;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(148, 163, 184, 0.35);
}

.booking-editor-page__portal-request-note {
  display: grid;
  gap: 0.35rem;
}

.booking-editor-page__portal-request-note textarea {
  width: 100%;
  resize: vertical;
}

.booking-editor-page__portal-request-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 640px) {
  .booking-editor-page__portal-request-heading,
  .booking-editor-page__portal-request-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .booking-editor-page__portal-request-actions button {
    width: 100%;
  }
}
"""
css_path.write_text(css)
