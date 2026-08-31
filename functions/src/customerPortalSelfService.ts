import * as functions from 'firebase-functions/v1'
import { randomBytes } from 'crypto'
import { admin, defaultDb } from './firestore'
import { hashPublicContractToken } from './eventContractSigningCore'
import { deliverTransactionalEmail } from './emailDelivery'

type RecordMap = Record<string, unknown>
type RequestType = 'reschedule' | 'cancel'
type RequestStatus = 'pending' | 'approved' | 'rejected'

type PortalLink = {
  linkKind?: string
  storeId: string
  customerId: string
  status: string
  expiresAt: FirebaseFirestore.Timestamp
  brandSnapshot?: RecordMap
}

type PortalRequest = {
  id: string
  type: RequestType
  status: RequestStatus
  requestedDate?: string | null
  requestedTime?: string | null
  note?: string | null
  previousDate?: string | null
  previousTime?: string | null
  submittedAt?: FirebaseFirestore.Timestamp | null
  reviewedAt?: FirebaseFirestore.Timestamp | null
  reviewedBy?: string | null
  decisionNote?: string | null
}

const PUBLIC_APP_BASE_URL = (process.env.SEDIFEX_PUBLIC_APP_URL || 'https://sedifex.com').replace(/\/$/, '')
const CHECKOUT_CREATE_URL = process.env.SEDIFEX_CHECKOUT_CREATE_URL
  || 'https://us-central1-sedifex-web.cloudfunctions.net/integrationCheckoutCreate'
const CONTRACT_VERSION = process.env.INTEGRATION_CONTRACT_VERSION || '2026-04-13'
const COLLECTION_SCAN_LIMIT = 250

function text(value: unknown, max = 5000) {
  if (typeof value === 'string') return value.trim().slice(0, max)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function email(value: unknown) {
  const candidate = text(value, 220).toLowerCase()
  return candidate.includes('@') ? candidate : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(typeof value === 'string' ? value.replace(/,/g, '') : value)
  return Number.isFinite(parsed) ? parsed : null
}

function readPath(data: RecordMap, path: string): unknown {
  let current: unknown = data
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as RecordMap)[part]
  }
  return current
}

function firstText(data: RecordMap, paths: string[], max = 500) {
  for (const path of paths) {
    const candidate = text(readPath(data, path), max)
    if (candidate) return candidate
  }
  return ''
}

function firstNumber(data: RecordMap, paths: string[]) {
  for (const path of paths) {
    const candidate = numberValue(readPath(data, path))
    if (candidate !== null) return candidate
  }
  return null
}

function normalizeStatus(value: unknown) {
  return text(value, 80).toLowerCase().replace(/[\s-]+/g, '_')
}

function paidLike(value: unknown) {
  return ['paid', 'confirmed', 'success', 'succeeded', 'captured', 'complete', 'completed', 'paid_cash'].includes(normalizeStatus(value))
}

function timestampToIso(value: unknown) {
  if (!value) return null
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString()
    } catch {
      return null
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

function escapeHtml(value: unknown) {
  return text(value, 5000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function customerName(customer: RecordMap) {
  return text(customer.displayName, 220) || text(customer.name, 220) || email(customer.email) || text(customer.phone, 80) || 'Customer'
}

function bookingReference(bookingId: string, booking: RecordMap) {
  return firstText(booking, ['reference', 'bookingId', 'booking_id', 'paymentReference', 'payment.reference'], 220) || bookingId
}

function bookingServiceName(booking: RecordMap) {
  return firstText(booking, ['serviceName', 'booking.serviceName', 'metadata.serviceName', 'itemName'], 240) || 'Service booking'
}

function bookingDate(booking: RecordMap) {
  return firstText(booking, ['bookingDate', 'date', 'booking.preferredDate', 'booking.date'], 40)
}

function bookingTime(booking: RecordMap) {
  return firstText(booking, ['bookingTime', 'time', 'booking.preferredTime', 'booking.time'], 40)
}

function bookingStatus(booking: RecordMap) {
  return normalizeStatus(firstText(booking, ['bookingStatus', 'booking_status', 'status', 'booking.status'], 80) || 'pending')
}

function bookingPaymentStatus(booking: RecordMap) {
  const payment = record(booking.payment)
  return normalizeStatus(booking.paymentStatus ?? booking.payment_status ?? payment.status ?? payment.paymentStatus ?? 'pending')
}

function bookingTotal(booking: RecordMap) {
  return firstNumber(booking, ['paymentAmount', 'totalAmount', 'amount', 'total', 'grandTotal', 'payment.amount', 'payment.total'])
}

function bookingReceived(booking: RecordMap) {
  const total = bookingTotal(booking)
  const explicit = firstNumber(booking, [
    'amountReceived', 'amount_received', 'amountPaid', 'paidAmount',
    'payment.amountReceived', 'payment.amount_received', 'payment.amountPaid',
  ])
  if (explicit !== null) return Math.max(0, explicit)
  if (paidLike(bookingPaymentStatus(booking))) return total !== null ? Math.max(0, total) : 0
  const deposit = firstNumber(booking, ['depositAmount', 'deposit_amount', 'depositPaid', 'payment.depositAmount', 'payment.deposit_amount'])
  return deposit !== null ? Math.max(0, deposit) : 0
}

function bookingOutstanding(booking: RecordMap) {
  if (paidLike(bookingPaymentStatus(booking))) return 0
  const direct = firstNumber(booking, [
    'amountOutstanding', 'amount_outstanding', 'balance', 'outstandingAmount',
    'payment.amountOutstanding', 'payment.amount_outstanding', 'payment.balance',
  ])
  if (direct !== null) return Math.max(0, direct)
  const total = bookingTotal(booking)
  if (total === null) return 0
  return Math.max(0, total - bookingReceived(booking))
}

function explicitBookingCustomerId(booking: RecordMap) {
  return firstText(booking, ['customerId', 'customer_id', 'customer.customerId', 'customer.id'], 220)
}

function normalizePhone(value: unknown) {
  return text(value, 80).replace(/\D/g, '')
}

function bookingBelongsToCustomer(customerId: string, customer: RecordMap, booking: RecordMap) {
  const explicit = explicitBookingCustomerId(booking)
  if (explicit) return explicit === customerId

  const customerEmail = email(customer.email)
  const bookingEmail = email(firstText(booking, ['customerEmail', 'email', 'customer.email'], 220))
  if (customerEmail && bookingEmail) return customerEmail === bookingEmail

  const customerPhone = normalizePhone(customer.phone)
  const bookingPhone = normalizePhone(firstText(booking, ['customerPhone', 'phone', 'customer.phone'], 80))
  return Boolean(customerPhone && bookingPhone && customerPhone === bookingPhone)
}

function serializeRequest(value: unknown, bookingId = '') {
  const request = record(value)
  const type = normalizeStatus(request.type) === 'cancel' ? 'cancel' : 'reschedule'
  const rawStatus = normalizeStatus(request.status)
  const status: RequestStatus = rawStatus === 'approved' ? 'approved' : rawStatus === 'rejected' ? 'rejected' : 'pending'
  return {
    bookingId,
    id: text(request.id, 220),
    type,
    status,
    requestedDate: text(request.requestedDate, 40),
    requestedTime: text(request.requestedTime, 40),
    note: text(request.note, 1200),
    previousDate: text(request.previousDate, 40),
    previousTime: text(request.previousTime, 40),
    submittedAt: timestampToIso(request.submittedAt),
    reviewedAt: timestampToIso(request.reviewedAt),
    reviewedBy: text(request.reviewedBy, 220),
    decisionNote: text(request.decisionNote, 1200),
  }
}

async function loadPortal(rawToken: unknown) {
  const token = text(rawToken, 300)
  if (!token) throw new functions.https.HttpsError('not-found', 'This customer portal link is invalid or no longer available.')
  const hash = hashPublicContractToken(token)
  const linkRef = defaultDb.collection('eventClientLinks').doc(hash)
  const linkSnapshot = await linkRef.get()
  if (!linkSnapshot.exists) throw new functions.https.HttpsError('not-found', 'This customer portal link is invalid or no longer available.')
  const link = linkSnapshot.data() as PortalLink
  if (link.linkKind !== 'customer_portal' || link.status !== 'active') {
    throw new functions.https.HttpsError('permission-denied', 'This customer portal link is no longer active.')
  }
  if (!link.expiresAt?.toMillis || link.expiresAt.toMillis() < Date.now()) {
    throw new functions.https.HttpsError('failed-precondition', 'This customer portal link has expired.')
  }
  const customerRef = defaultDb.collection('customers').doc(link.customerId)
  const customerSnapshot = await customerRef.get()
  if (!customerSnapshot.exists) throw new functions.https.HttpsError('not-found', 'This customer profile is no longer available.')
  const customer = customerSnapshot.data() as RecordMap
  if (text(customer.storeId, 180) !== link.storeId) throw new functions.https.HttpsError('permission-denied', 'This portal link is invalid.')
  const portal = record(customer.portal)
  if (text(portal.publicLinkHash, 100) !== hash || text(portal.status, 40) !== 'active') {
    throw new functions.https.HttpsError('permission-denied', 'This customer portal link is no longer active.')
  }
  return { token, hash, link, customerRef, customer }
}

async function loadPortalBooking(rawToken: unknown, rawBookingId: unknown) {
  const portal = await loadPortal(rawToken)
  const bookingId = text(rawBookingId, 220)
  if (!bookingId) throw new functions.https.HttpsError('invalid-argument', 'bookingId is required')
  const bookingRef = defaultDb.collection('stores').doc(portal.link.storeId).collection('integrationBookings').doc(bookingId)
  const bookingSnapshot = await bookingRef.get()
  if (!bookingSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Booking not found')
  const booking = bookingSnapshot.data() as RecordMap
  const embeddedStoreId = firstText(booking, ['storeId', 'store_id', 'merchantId'], 180)
  if (embeddedStoreId && embeddedStoreId !== portal.link.storeId) throw new functions.https.HttpsError('permission-denied', 'Booking belongs to another store')
  if (!bookingBelongsToCustomer(portal.link.customerId, portal.customer, booking)) {
    throw new functions.https.HttpsError('permission-denied', 'Booking is not linked to this customer portal')
  }
  return { ...portal, bookingId, bookingRef, booking }
}

async function assertStoreAccess(storeId: string, uid: string) {
  const [storeSnapshot, memberSnapshot] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('teamMembers').doc(uid).get(),
  ])
  if (!storeSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Store not found')
  const store = storeSnapshot.data() as RecordMap
  const member = memberSnapshot.exists ? memberSnapshot.data() as RecordMap : {}
  const direct = text(member.uid, 220) === uid && text(member.storeId, 180) === storeId
  const linkedOwner = text(member.uid, 220) === uid
    && text(member.role, 40) === 'owner'
    && Boolean(text(member.storeId, 180))
    && text(store.parentStoreId, 180) === text(member.storeId, 180)
  const ownerUid = text(store.ownerUid, 220) === uid
  if (!direct && !linkedOwner && !ownerUid) throw new functions.https.HttpsError('permission-denied', 'You do not have access to this booking')
  return store
}

async function storeRecipients(storeId: string, store: RecordMap) {
  const recipients = new Set<string>()
  try {
    const settings = await defaultDb.collection('storeSettings').doc(storeId).get()
    const notifications = record(settings.data()?.notifications)
    const adminEmails = Array.isArray(notifications.adminEmails) ? notifications.adminEmails : []
    adminEmails.forEach(value => {
      const address = email(value)
      if (address) recipients.add(address)
    })
  } catch (error) {
    functions.logger.warn('Unable to load store recipients for customer portal request', { storeId, error })
  }
  ;[store.email, store.ownerEmail, store.firstSignupEmail].forEach(value => {
    const address = email(value)
    if (address) recipients.add(address)
  })
  return Array.from(recipients).slice(0, 8)
}

function storeBrand(store: RecordMap) {
  return {
    storeName: text(store.displayName, 180) || text(store.businessName, 180) || text(store.name, 180) || 'Sedifex Store',
    email: email(store.email) || email(store.ownerEmail) || email(store.firstSignupEmail),
    phone: text(store.phone, 80),
    logoUrl: text(store.logoUrl, 1000),
    brandColor: text(store.brandColor, 40) || '#4f46e5',
  }
}

async function logCustomerMessage(customerId: string, messageId: string, data: RecordMap) {
  await defaultDb.collection('customers').doc(customerId).collection('messages').doc(messageId).set({
    ...data,
    customerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
}

async function notifyStoreOfRequest(input: {
  storeId: string
  store: RecordMap
  customer: RecordMap
  bookingId: string
  booking: RecordMap
  request: PortalRequest
}) {
  const recipients = await storeRecipients(input.storeId, input.store)
  if (!recipients.length) return
  const brand = storeBrand(input.store)
  const name = customerName(input.customer)
  const reference = bookingReference(input.bookingId, input.booking)
  const detailUrl = `${PUBLIC_APP_BASE_URL}/bookings/${encodeURIComponent(input.bookingId)}`
  const actionLabel = input.request.type === 'cancel' ? 'cancellation' : 'reschedule'
  const requestedSchedule = input.request.type === 'reschedule'
    ? `${input.request.requestedDate || 'Date not set'}${input.request.requestedTime ? ` at ${input.request.requestedTime}` : ''}`
    : ''
  const noteLine = input.request.note ? `<p><strong>Customer note:</strong> ${escapeHtml(input.request.note)}</p>` : ''
  const html = `<p>${escapeHtml(name)} submitted a booking ${actionLabel} request through their Sedifex customer portal.</p><table><tr><td><strong>Booking</strong></td><td>${escapeHtml(reference)}</td></tr><tr><td><strong>Service</strong></td><td>${escapeHtml(bookingServiceName(input.booking))}</td></tr>${requestedSchedule ? `<tr><td><strong>Requested time</strong></td><td>${escapeHtml(requestedSchedule)}</td></tr>` : ''}</table>${noteLine}<p><a href="${escapeHtml(detailUrl)}">Review request in Sedifex</a></p>`
  const plain = `${name} submitted a booking ${actionLabel} request.\nBooking: ${reference}\nService: ${bookingServiceName(input.booking)}${requestedSchedule ? `\nRequested time: ${requestedSchedule}` : ''}${input.request.note ? `\nNote: ${input.request.note}` : ''}\nReview: ${detailUrl}`
  await Promise.allSettled(recipients.map(to => deliverTransactionalEmail({
    storeId: input.storeId,
    eventType: input.request.type === 'cancel' ? 'customer.booking_cancellation_requested' : 'customer.booking_reschedule_requested',
    reference: `${input.bookingId}-${input.request.id}-${to}`.slice(0, 220),
    recipientType: 'store',
    to,
    subject: `Customer booking request - ${brand.storeName}`,
    html,
    text: plain,
    brand,
    customer: { name, email: email(input.customer.email), phone: text(input.customer.phone, 80) },
    data: {
      bookingId: input.bookingId,
      bookingReference: reference,
      requestId: input.request.id,
      requestType: input.request.type,
      requestedDate: input.request.requestedDate || null,
      requestedTime: input.request.requestedTime || null,
    },
  })))
}

async function notifyCustomerOfRejection(input: {
  storeId: string
  store: RecordMap
  customer: RecordMap
  bookingId: string
  booking: RecordMap
  request: PortalRequest
}) {
  const to = email(input.customer.email) || email(firstText(input.booking, ['customerEmail', 'email', 'customer.email'], 220))
  if (!to) return null
  const brand = storeBrand(input.store)
  const name = customerName(input.customer)
  const reference = bookingReference(input.bookingId, input.booking)
  const note = input.request.decisionNote ? `<p><strong>Business note:</strong> ${escapeHtml(input.request.decisionNote)}</p>` : ''
  return deliverTransactionalEmail({
    storeId: input.storeId,
    eventType: 'customer.booking_request_rejected',
    reference: `${input.bookingId}-${input.request.id}-rejected`.slice(0, 220),
    recipientType: 'customer',
    to,
    subject: `Booking request update - ${brand.storeName}`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(brand.storeName)} could not approve your ${input.request.type === 'cancel' ? 'cancellation' : 'reschedule'} request for booking ${escapeHtml(reference)}.</p>${note}<p>Your current booking remains unchanged. Please contact the business if you need another option.</p>`,
    text: `Hello ${name}, ${brand.storeName} could not approve your ${input.request.type === 'cancel' ? 'cancellation' : 'reschedule'} request for booking ${reference}.${input.request.decisionNote ? ` Note: ${input.request.decisionNote}` : ''} Your current booking remains unchanged.`,
    brand,
    customer: { name, email: to, phone: text(input.customer.phone, 80) },
    data: { bookingId: input.bookingId, requestId: input.request.id, requestType: input.request.type },
  })
}

async function scanCustomerBookings(storeId: string, customerId: string, customer: RecordMap) {
  const ref = defaultDb.collection('stores').doc(storeId).collection('integrationBookings')
  const [byCustomerId, byCustomerIdSnake] = await Promise.all([
    ref.where('customerId', '==', customerId).limit(200).get(),
    ref.where('customer_id', '==', customerId).limit(200).get(),
  ])
  const rows = new Map<string, RecordMap>()
  byCustomerId.docs.forEach(item => rows.set(item.id, item.data() as RecordMap))
  byCustomerIdSnake.docs.forEach(item => rows.set(item.id, item.data() as RecordMap))
  if (rows.size) return Array.from(rows.entries()).map(([id, data]) => ({ id, data }))
  const fallback = await ref.limit(COLLECTION_SCAN_LIMIT).get()
  return fallback.docs
    .map(item => ({ id: item.id, data: item.data() as RecordMap }))
    .filter(item => bookingBelongsToCustomer(customerId, customer, item.data))
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function validTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

export const getCustomerPortalSelfServiceState = functions.https.onCall(async data => {
  const portal = await loadPortal(data?.token)
  const bookings = await scanCustomerBookings(portal.link.storeId, portal.link.customerId, portal.customer)
  const requests = bookings
    .map(item => serializeRequest(item.data.customerPortalRequest, item.id))
    .filter(item => Boolean(item.id))
  return { ok: true, requests }
})

export const submitCustomerPortalBookingRequest = functions.https.onCall(async data => {
  const loaded = await loadPortalBooking(data?.token, data?.bookingId)
  const action = normalizeStatus(data?.action) === 'cancel' ? 'cancel' : 'reschedule'
  const requestedDate = text(data?.requestedDate, 40)
  const requestedTime = text(data?.requestedTime, 40)
  const note = text(data?.note, 1200)
  if (action === 'reschedule' && (!validDate(requestedDate) || !validTime(requestedTime))) {
    throw new functions.https.HttpsError('invalid-argument', 'Choose a valid new date and time.')
  }
  if (['cancelled', 'canceled', 'completed', 'complete'].includes(bookingStatus(loaded.booking))) {
    throw new functions.https.HttpsError('failed-precondition', 'This booking can no longer be changed from the customer portal.')
  }

  const now = admin.firestore.Timestamp.now()
  const request: PortalRequest = {
    id: `cpr_${Date.now()}_${randomBytes(6).toString('hex')}`,
    type: action,
    status: 'pending',
    requestedDate: action === 'reschedule' ? requestedDate : null,
    requestedTime: action === 'reschedule' ? requestedTime : null,
    note: note || null,
    previousDate: bookingDate(loaded.booking) || null,
    previousTime: bookingTime(loaded.booking) || null,
    submittedAt: now,
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  }

  await defaultDb.runTransaction(async transaction => {
    const current = await transaction.get(loaded.bookingRef)
    if (!current.exists) throw new functions.https.HttpsError('not-found', 'Booking not found')
    const currentData = current.data() as RecordMap
    if (!bookingBelongsToCustomer(loaded.link.customerId, loaded.customer, currentData)) {
      throw new functions.https.HttpsError('permission-denied', 'Booking is not linked to this customer portal')
    }
    const existing = record(currentData.customerPortalRequest)
    if (normalizeStatus(existing.status) === 'pending') {
      throw new functions.https.HttpsError('failed-precondition', 'A booking request is already waiting for the business to review it.')
    }
    if (['cancelled', 'canceled', 'completed', 'complete'].includes(bookingStatus(currentData))) {
      throw new functions.https.HttpsError('failed-precondition', 'This booking can no longer be changed from the customer portal.')
    }
    transaction.set(loaded.bookingRef, {
      customerPortalRequest: request,
      customerPortalRequestStatus: 'pending',
      customerPortalRequestUpdatedAt: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
  })

  const rootRef = defaultDb.collection('integrationBookings').doc(loaded.bookingId)
  try {
    const root = await rootRef.get()
    if (root.exists) {
      await rootRef.set({
        customerPortalRequest: request,
        customerPortalRequestStatus: 'pending',
        customerPortalRequestUpdatedAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  } catch (error) {
    functions.logger.warn('Unable to mirror customer portal request to root booking', { bookingId: loaded.bookingId, error })
  }

  const storeSnapshot = await defaultDb.collection('stores').doc(loaded.link.storeId).get()
  const store = storeSnapshot.exists ? storeSnapshot.data() as RecordMap : {}
  const reference = bookingReference(loaded.bookingId, loaded.booking)
  await Promise.allSettled([
    logCustomerMessage(loaded.link.customerId, request.id, {
      storeId: loaded.link.storeId,
      customerName: customerName(loaded.customer),
      channel: 'portal',
      direction: 'inbound',
      source: 'customer_portal',
      eventType: action === 'cancel' ? 'customer.booking_cancellation_requested' : 'customer.booking_reschedule_requested',
      subject: action === 'cancel' ? 'Cancellation requested' : 'Reschedule requested',
      body: action === 'cancel'
        ? `Customer requested cancellation of booking ${reference}.${note ? ` Note: ${note}` : ''}`
        : `Customer requested ${requestedDate} at ${requestedTime} for booking ${reference}.${note ? ` Note: ${note}` : ''}`,
      status: 'received',
      bookingId: loaded.bookingId,
      bookingReference: reference,
      requestId: request.id,
    }),
    notifyStoreOfRequest({ storeId: loaded.link.storeId, store, customer: loaded.customer, bookingId: loaded.bookingId, booking: loaded.booking, request }),
  ])

  return { ok: true, request: serializeRequest(request, loaded.bookingId) }
})

export const reviewCustomerPortalBookingRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const bookingId = text(data?.bookingId, 220)
  const decision = normalizeStatus(data?.decision)
  const decisionNote = text(data?.note, 1200)
  if (!storeId || !bookingId || !['approve', 'reject'].includes(decision)) {
    throw new functions.https.HttpsError('invalid-argument', 'storeId, bookingId and a valid decision are required')
  }
  const store = await assertStoreAccess(storeId, context.auth.uid)
  const bookingRef = defaultDb.collection('stores').doc(storeId).collection('integrationBookings').doc(bookingId)
  const reviewedAt = admin.firestore.Timestamp.now()
  let reviewedRequest: PortalRequest | null = null
  let customerId = ''
  let customer: RecordMap = {}
  let bookingAfter: RecordMap = {}

  await defaultDb.runTransaction(async transaction => {
    const bookingSnapshot = await transaction.get(bookingRef)
    if (!bookingSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Booking not found')
    const booking = bookingSnapshot.data() as RecordMap
    const requestData = record(booking.customerPortalRequest)
    if (normalizeStatus(requestData.status) !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', 'This customer request has already been reviewed.')
    }
    const requestType: RequestType = normalizeStatus(requestData.type) === 'cancel' ? 'cancel' : 'reschedule'
    if (['cancelled', 'canceled', 'completed', 'complete'].includes(bookingStatus(booking)) && decision === 'approve') {
      throw new functions.https.HttpsError('failed-precondition', 'This booking can no longer be changed.')
    }
    customerId = explicitBookingCustomerId(booking)
    const nextStatus: RequestStatus = decision === 'approve' ? 'approved' : 'rejected'
    reviewedRequest = {
      id: text(requestData.id, 220),
      type: requestType,
      status: nextStatus,
      requestedDate: text(requestData.requestedDate, 40) || null,
      requestedTime: text(requestData.requestedTime, 40) || null,
      note: text(requestData.note, 1200) || null,
      previousDate: text(requestData.previousDate, 40) || null,
      previousTime: text(requestData.previousTime, 40) || null,
      submittedAt: requestData.submittedAt instanceof admin.firestore.Timestamp ? requestData.submittedAt : null,
      reviewedAt,
      reviewedBy: context.auth?.uid || null,
      decisionNote: decisionNote || null,
    }

    const update: Record<string, unknown> = {
      customerPortalRequest: reviewedRequest,
      customerPortalRequestStatus: nextStatus,
      customerPortalRequestUpdatedAt: reviewedAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (decision === 'approve' && requestType === 'reschedule') {
      const nextDate = text(requestData.requestedDate, 40)
      const nextTime = text(requestData.requestedTime, 40)
      if (!validDate(nextDate) || !validTime(nextTime)) throw new functions.https.HttpsError('failed-precondition', 'The requested date or time is invalid.')
      Object.assign(update, {
        bookingDate: nextDate,
        date: nextDate,
        bookingTime: nextTime,
        time: nextTime,
        booking: {
          ...record(booking.booking),
          preferredDate: nextDate,
          preferredTime: nextTime,
        },
        syncStatus: 'pending',
        syncReason: 'booking_rescheduled',
        syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    if (decision === 'approve' && requestType === 'cancel') {
      Object.assign(update, {
        bookingStatus: 'cancelled',
        booking_status: 'cancelled',
        status: 'cancelled',
        booking: {
          ...record(booking.booking),
          status: 'cancelled',
          bookingStatus: 'cancelled',
          booking_status: 'cancelled',
        },
        cancelledAt: reviewedAt,
        syncStatus: 'pending',
        syncReason: 'booking_cancelled',
        syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
    transaction.set(bookingRef, update, { merge: true })
    bookingAfter = { ...booking, ...update }
  })

  if (!reviewedRequest) throw new functions.https.HttpsError('internal', 'Unable to review this request')
  if (customerId) {
    const customerSnapshot = await defaultDb.collection('customers').doc(customerId).get()
    if (customerSnapshot.exists && text(customerSnapshot.data()?.storeId, 180) === storeId) customer = customerSnapshot.data() as RecordMap
  }
  if (!customerId) {
    customerId = explicitBookingCustomerId(bookingAfter)
  }

  const rootRef = defaultDb.collection('integrationBookings').doc(bookingId)
  try {
    const root = await rootRef.get()
    if (root.exists) {
      const mirror: Record<string, unknown> = {
        customerPortalRequest: reviewedRequest,
        customerPortalRequestStatus: reviewedRequest.status,
        customerPortalRequestUpdatedAt: reviewedAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      if (decision === 'approve' && reviewedRequest.type === 'reschedule') {
        Object.assign(mirror, {
          bookingDate: reviewedRequest.requestedDate,
          date: reviewedRequest.requestedDate,
          bookingTime: reviewedRequest.requestedTime,
          time: reviewedRequest.requestedTime,
          booking: {
            ...record(root.data()?.booking),
            preferredDate: reviewedRequest.requestedDate,
            preferredTime: reviewedRequest.requestedTime,
          },
          syncStatus: 'pending',
          syncReason: 'booking_rescheduled',
          syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      if (decision === 'approve' && reviewedRequest.type === 'cancel') {
        Object.assign(mirror, {
          bookingStatus: 'cancelled', booking_status: 'cancelled', status: 'cancelled', cancelledAt: reviewedAt,
          booking: { ...record(root.data()?.booking), status: 'cancelled', bookingStatus: 'cancelled', booking_status: 'cancelled' },
          syncStatus: 'pending', syncReason: 'booking_cancelled', syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      await rootRef.set(mirror, { merge: true })
    }
  } catch (error) {
    functions.logger.warn('Unable to mirror reviewed customer portal request to root booking', { bookingId, error })
  }

  const reference = bookingReference(bookingId, bookingAfter)
  if (customerId) {
    await logCustomerMessage(customerId, `${reviewedRequest.id}-${reviewedRequest.status}`, {
      storeId,
      customerName: customerName(customer),
      channel: 'portal',
      direction: 'outbound',
      source: 'sedifex_store_review',
      eventType: reviewedRequest.status === 'approved' ? 'customer.booking_request_approved' : 'customer.booking_request_rejected',
      subject: reviewedRequest.status === 'approved' ? 'Booking request approved' : 'Booking request rejected',
      body: reviewedRequest.status === 'approved'
        ? `The business approved the customer's ${reviewedRequest.type === 'cancel' ? 'cancellation' : 'reschedule'} request for booking ${reference}.`
        : `The business rejected the customer's ${reviewedRequest.type === 'cancel' ? 'cancellation' : 'reschedule'} request for booking ${reference}.${decisionNote ? ` Note: ${decisionNote}` : ''}`,
      status: reviewedRequest.status,
      bookingId,
      bookingReference: reference,
      requestId: reviewedRequest.id,
      reviewedBy: context.auth.uid,
    })
  }

  if (reviewedRequest.status === 'rejected' && customerId) {
    await notifyCustomerOfRejection({ storeId, store, customer, bookingId, booking: bookingAfter, request: reviewedRequest })
  }

  return {
    ok: true,
    request: serializeRequest(reviewedRequest, bookingId),
    bookingDate: reviewedRequest.status === 'approved' && reviewedRequest.type === 'reschedule' ? reviewedRequest.requestedDate : bookingDate(bookingAfter),
    bookingTime: reviewedRequest.status === 'approved' && reviewedRequest.type === 'reschedule' ? reviewedRequest.requestedTime : bookingTime(bookingAfter),
    bookingStatus: reviewedRequest.status === 'approved' && reviewedRequest.type === 'cancel' ? 'cancelled' : bookingStatus(bookingAfter),
  }
})

export const createCustomerPortalPaymentCheckout = functions.https.onCall(async data => {
  const loaded = await loadPortalBooking(data?.token, data?.bookingId)
  const status = bookingStatus(loaded.booking)
  if (['cancelled', 'canceled', 'completed', 'complete'].includes(status)) {
    throw new functions.https.HttpsError('failed-precondition', 'This booking is not eligible for a new portal payment.')
  }
  const outstanding = bookingOutstanding(loaded.booking)
  if (!Number.isFinite(outstanding) || outstanding <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'This booking has no outstanding balance.')
  }

  const safeBookingId = loaded.bookingId.replace(/[^A-Za-z0-9._=-]/g, '-').slice(0, 80) || 'booking'
  const reference = `portal_${safeBookingId}_${Date.now()}_${randomBytes(4).toString('hex')}`.slice(0, 100)
  const realEmail = email(loaded.customer.email) || email(firstText(loaded.booking, ['customerEmail', 'email', 'customer.email'], 220))
  const checkoutEmail = realEmail || `portal-${safeBookingId}-${Date.now()}@sedifex.com`
  const name = customerName(loaded.customer)
  const phone = text(loaded.customer.phone, 80) || firstText(loaded.booking, ['customerPhone', 'phone', 'customer.phone'], 80)
  const service = bookingServiceName(loaded.booking)
  const currency = firstText(loaded.booking, ['currency', 'payment.currency'], 20) || 'GHS'
  const returnUrl = `${PUBLIC_APP_BASE_URL}/customer-portal/${encodeURIComponent(loaded.token)}?payment=returning&reference=${encodeURIComponent(reference)}`
  const checkoutBody = {
    storeId: loaded.link.storeId,
    merchantId: loaded.link.storeId,
    reference,
    clientOrderId: reference,
    bookingId: loaded.bookingId,
    amount: outstanding,
    currency,
    customer: { name, email: checkoutEmail, phone },
    customerEmail: checkoutEmail,
    customerName: name,
    customerPhone: phone,
    returnUrl,
    sourceChannel: 'customer_portal',
    sourceLabel: 'Sedifex Customer Portal',
    paymentMethod: 'ONLINE',
    paymentProvider: 'paystack',
    paymentCollectionMode: 'online_checkout',
    quickPay: true,
    quickPayType: 'BOOKING',
    accountingType: 'booking',
    orderType: 'booking',
    items: [{
      item_id: loaded.bookingId,
      itemId: loaded.bookingId,
      name: `Balance - ${service}`,
      serviceName: service,
      type: 'SERVICE',
      item_type: 'service',
      quickPayType: 'BOOKING',
      accountingType: 'booking',
      qty: 1,
      quantity: 1,
      unitPrice: outstanding,
      price: outstanding,
    }],
    pricing_snapshot: {
      pricing_version: 'customer-portal-balance-v1',
      currency,
      subtotal: Math.round(outstanding * 100),
      tax_total: 0,
      final_total: Math.round(outstanding * 100),
      items: [{ item_id: loaded.bookingId, name: `Balance - ${service}`, qty: 1, unit_price: Math.round(outstanding * 100), line_total: Math.round(outstanding * 100), type: 'SERVICE', quickPayType: 'BOOKING', accountingType: 'booking' }],
    },
    metadata: {
      quickPay: true,
      portalPayment: true,
      balancePayment: true,
      bookingId: loaded.bookingId,
      customerId: loaded.link.customerId,
      itemName: service,
      source: 'customer_portal',
    },
  }

  let response: Response
  try {
    response = await fetch(CHECKOUT_CREATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Sedifex-Contract-Version': CONTRACT_VERSION,
      },
      body: JSON.stringify(checkoutBody),
    })
  } catch (error) {
    functions.logger.error('Customer portal checkout request failed', { bookingId: loaded.bookingId, error })
    throw new functions.https.HttpsError('unavailable', 'Payment checkout is temporarily unavailable. Please try again.')
  }

  let payload: RecordMap = {}
  try {
    payload = await response.json() as RecordMap
  } catch {
    payload = {}
  }
  const checkoutUrl = text(payload.checkoutUrl, 1400) || text(payload.authorizationUrl, 1400)
  if (!response.ok || !checkoutUrl) {
    functions.logger.error('Customer portal checkout creation was rejected', { bookingId: loaded.bookingId, status: response.status, payload })
    throw new functions.https.HttpsError('unavailable', 'Payment checkout could not be opened. Please try again or contact the business.')
  }

  await logCustomerMessage(loaded.link.customerId, `portal-payment-${reference}`, {
    storeId: loaded.link.storeId,
    customerName: name,
    channel: 'portal',
    direction: 'inbound',
    source: 'customer_portal',
    eventType: 'customer.portal_payment_started',
    subject: 'Portal payment started',
    body: `Customer opened checkout for ${currency} ${outstanding.toFixed(2)} outstanding on booking ${bookingReference(loaded.bookingId, loaded.booking)}.`,
    status: 'checkout_created',
    bookingId: loaded.bookingId,
    bookingReference: bookingReference(loaded.bookingId, loaded.booking),
    paymentReference: reference,
    amount: outstanding,
    currency,
  })

  return {
    ok: true,
    checkoutUrl,
    reference,
    amount: outstanding,
    currency,
    processingFeeMinor: numberValue(record(payload.pricingSnapshot).processingFeeMinor) ?? null,
    customerTotalMinor: numberValue(record(payload.pricingSnapshot).customerTotalMinor) ?? null,
  }
})
