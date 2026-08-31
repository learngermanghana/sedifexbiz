import * as functions from 'firebase-functions/v1'
import { randomBytes } from 'crypto'
import { admin, defaultDb } from './firestore'
import { hashPublicContractToken } from './eventContractSigningCore'
import { deliverTransactionalEmail } from './emailDelivery'

type RecordMap = Record<string, unknown>

type CustomerPortalLink = {
  linkKind?: 'customer_portal'
  storeId: string
  customerId: string
  status: 'active' | 'revoked'
  expiresAt: FirebaseFirestore.Timestamp
  brandSnapshot?: RecordMap
}

const LINK_LIFETIME_DAYS = 180
const COLLECTION_SCAN_LIMIT = 250
const CUSTOMER_PORTAL_BASE_URL = (process.env.SEDIFEX_CUSTOMER_PORTAL_BASE_URL || 'https://pay.sedifex.com').replace(/\/$/, '')

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function email(value: unknown) {
  const valueText = text(value, 220).toLowerCase()
  return valueText.includes('@') ? valueText : ''
}

function escapeHtml(value: unknown) {
  return text(value, 5000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function phone(value: unknown) {
  return text(value, 80)
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

function dateToIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value.slice(0, 80) : parsed.toISOString()
  }
  if (typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  if (typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      const parsed = (value as { toDate: () => Date }).toDate()
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
    } catch {
      return null
    }
  }
  return null
}

function firstText(data: RecordMap, paths: string[]): string {
  for (const path of paths) {
    let current: unknown = data
    let valid = true
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        valid = false
        break
      }
      current = (current as RecordMap)[part]
    }
    if (!valid) continue
    const valueText = text(current, 500)
    if (valueText) return valueText
  }
  return ''
}

function firstNumber(data: RecordMap, paths: string[]): number | null {
  for (const path of paths) {
    let current: unknown = data
    let valid = true
    for (const part of path.split('.')) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        valid = false
        break
      }
      current = (current as RecordMap)[part]
    }
    if (!valid) continue
    const parsed = numberValue(current)
    if (parsed !== null) return parsed
  }
  return null
}

function normalizePhone(value: unknown) {
  return phone(value).replace(/\D/g, '')
}

function normalizeName(value: unknown) {
  return text(value, 220).replace(/\s+/g, ' ').toLowerCase()
}

function matchesCustomer(customerId: string, customer: RecordMap, data: RecordMap) {
  const idCandidates = [
    firstText(data, ['customerId', 'clientCustomerId', 'customer.id', 'customer.customerId', 'integrations.clientCustomerId']),
  ].filter(Boolean)
  if (idCandidates.includes(customerId)) return true

  const customerEmail = email(customer.email)
  const rowEmail = email(firstText(data, ['customerEmail', 'email', 'clientEmail', 'customer.email', 'contact.email']))
  if (customerEmail && rowEmail && customerEmail === rowEmail) return true

  const customerPhone = normalizePhone(customer.phone)
  const rowPhone = normalizePhone(firstText(data, ['customerPhone', 'phone', 'clientPhone', 'customer.phone', 'contact.phone']))
  if (customerPhone && rowPhone && customerPhone === rowPhone) return true

  if (customerEmail || customerPhone) return false
  const customerName = normalizeName(customer.displayName || customer.name)
  const rowName = normalizeName(firstText(data, ['customerName', 'name', 'clientName', 'customer.name', 'contact.name', 'displayName']))
  return Boolean(customerName && rowName && customerName === rowName)
}

function paidLike(value: unknown) {
  const status = text(value, 80).toLowerCase()
  return ['paid', 'confirmed', 'success', 'succeeded', 'captured', 'complete', 'completed', 'paid_cash'].includes(status)
}

function customerDisplayName(customer: RecordMap) {
  return text(customer.displayName, 220) || text(customer.name, 220) || email(customer.email) || phone(customer.phone) || 'Customer'
}

function brandSnapshot(store: RecordMap) {
  return {
    storeName: text(store.displayName, 180) || text(store.businessName, 180) || text(store.name, 180) || 'Sedifex Store',
    email: email(store.email) || email(store.ownerEmail) || email(store.firstSignupEmail),
    phone: phone(store.phone),
    logoUrl: text(store.logoUrl, 1000),
    brandColor: text(store.brandColor, 40) || '#4f46e5',
    address: text(store.address, 500),
    town: text(store.town, 160),
    country: text(store.country, 160),
  }
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
  if (!direct && !linkedOwner && !ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this customer')
  }
  return store
}

async function loadCustomerForStore(storeId: string, customerId: string) {
  const customerRef = defaultDb.collection('customers').doc(customerId)
  const customerSnapshot = await customerRef.get()
  if (!customerSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Customer not found')
  const customer = customerSnapshot.data() as RecordMap
  if (text(customer.storeId, 180) !== storeId) throw new functions.https.HttpsError('permission-denied', 'Customer belongs to another store')
  return { customerRef, customer, customerSnapshot }
}

async function scanCollection(ref: FirebaseFirestore.CollectionReference, customerId: string, customer: RecordMap) {
  const directSnapshots = await Promise.all([
    ref.where('customerId', '==', customerId).limit(200).get(),
    ref.where('customer_id', '==', customerId).limit(200).get(),
  ])
  const direct = new Map<string, { id: string; data: RecordMap }>()
  directSnapshots.forEach(snapshot => snapshot.docs.forEach(item => direct.set(item.id, { id: item.id, data: item.data() as RecordMap })))
  if (direct.size) return Array.from(direct.values())

  // Legacy fallback for older rows created before canonical customer IDs were
  // backfilled. This is deliberately bounded; current booking/invoice/receipt
  // writers attach customerId and customer_id automatically.
  const snapshot = await ref.limit(COLLECTION_SCAN_LIMIT).get()
  return snapshot.docs
    .map(item => ({ id: item.id, data: item.data() as RecordMap }))
    .filter(item => matchesCustomer(customerId, customer, item.data))
}

function mapBooking(id: string, data: RecordMap) {
  const payment = record(data.payment)
  const total = firstNumber(data, ['totalAmount', 'amount', 'total', 'grandTotal', 'payment.total'])
  const received = firstNumber(data, ['amountReceived', 'amountPaid', 'paidAmount', 'payment.amountReceived', 'payment.amountPaid'])
  const paymentStatus = firstText(data, ['paymentStatus', 'payment.status']) || 'pending'
  const directOutstanding = firstNumber(data, ['amountOutstanding', 'balance', 'outstandingAmount', 'payment.amountOutstanding', 'payment.balance'])
  const outstanding = paidLike(paymentStatus)
    ? 0
    : directOutstanding !== null
      ? Math.max(0, directOutstanding)
      : total !== null && received !== null
        ? Math.max(0, total - received)
        : null
  return {
    id,
    reference: firstText(data, ['reference', 'bookingId', 'paymentReference', 'payment.reference']) || id,
    serviceName: firstText(data, ['serviceName', 'booking.serviceName', 'metadata.serviceName', 'itemName']) || 'Service booking',
    bookingDate: firstText(data, ['bookingDate', 'date', 'booking.preferredDate', 'metadata.bookingDate']),
    bookingTime: firstText(data, ['bookingTime', 'time', 'booking.preferredTime', 'metadata.bookingTime']),
    location: firstText(data, ['location', 'branch', 'venue', 'booking.location']),
    status: firstText(data, ['status', 'bookingStatus']) || 'pending',
    paymentStatus,
    currency: firstText(data, ['currency', 'payment.currency']) || 'GHS',
    total,
    amountReceived: received,
    amountOutstanding: outstanding,
    updatedAt: dateToIso(data.updatedAt ?? data.createdAt),
  }
}

function mapInvoice(id: string, data: RecordMap) {
  const status = firstText(data, ['status']) || 'draft'
  const total = firstNumber(data, ['total', 'grandTotal', 'amount'])
  const amountPaid = firstNumber(data, ['amountPaid', 'paidAmount'])
  const directBalance = firstNumber(data, ['balance', 'amountOutstanding'])
  const balance = directBalance !== null
    ? Math.max(0, directBalance)
    : ['paid', 'cancelled', 'canceled', 'void'].includes(status.toLowerCase())
      ? 0
      : total !== null && amountPaid !== null
        ? Math.max(0, total - amountPaid)
        : null
  return {
    id,
    invoiceNumber: firstText(data, ['invoiceNumber', 'number', 'reference']) || id,
    status,
    currency: firstText(data, ['currency']) || 'GHS',
    total,
    amountPaid,
    balance,
    dueDate: dateToIso(data.dueDate) || firstText(data, ['dueDate']),
    createdAt: dateToIso(data.createdAt),
    updatedAt: dateToIso(data.updatedAt),
    publicUrl: firstText(data, ['publicUrl', 'shareUrl']),
  }
}

function mapReceipt(id: string, data: RecordMap) {
  return {
    id,
    receiptNumber: firstText(data, ['receiptNumber', 'number', 'reference']) || id,
    reference: firstText(data, ['paymentReference', 'reference', 'transactionReference']),
    currency: firstText(data, ['currency']) || 'GHS',
    amountPaid: firstNumber(data, ['amountPaid', 'amount', 'total']),
    paymentMethod: firstText(data, ['paymentMethod', 'payment.method', 'method']),
    status: firstText(data, ['status', 'paymentStatus']) || 'paid',
    createdAt: dateToIso(data.createdAt ?? data.updatedAt),
    publicUrl: firstText(data, ['publicUrl', 'shareUrl']),
  }
}

function mapBookingPayment(id: string, data: RecordMap) {
  const payment = record(data.payment)
  const status = firstText(data, ['paymentStatus', 'payment.status']) || (payment.confirmed === true ? 'paid' : 'pending')
  const explicitReceived = firstNumber(data, ['amountReceived', 'amountPaid', 'paidAmount', 'payment.amountReceived', 'payment.amountPaid'])
  const depositAmount = firstNumber(data, ['depositAmount', 'payment.depositAmount'])
  const total = firstNumber(data, ['totalAmount', 'paymentAmount', 'amount', 'total', 'grandTotal', 'payment.amount'])
  const paid = payment.confirmed === true || paidLike(status)
  const amountPaid = explicitReceived !== null
    ? Math.max(0, explicitReceived)
    : paid
      ? (depositAmount !== null && depositAmount > 0 ? Math.max(0, depositAmount) : total)
      : depositAmount !== null && depositAmount > 0
        ? Math.max(0, depositAmount)
        : null
  const hasRecordedPayment = payment.confirmed === true || paidLike(status) || (amountPaid !== null && amountPaid > 0)
  if (!hasRecordedPayment) return null

  return {
    id: `booking-payment-${id}`,
    kind: 'payment_confirmation' as const,
    title: firstText(data, ['serviceName', 'booking.serviceName', 'metadata.serviceName', 'itemName']) || 'Booking payment',
    reference: firstText(data, ['paymentReference', 'payment.reference', 'reference', 'bookingId']) || id,
    currency: firstText(data, ['currency', 'payment.currency']) || 'GHS',
    amountPaid,
    paymentMethod: firstText(data, ['paymentMethod', 'payment.method', 'method']),
    status,
    createdAt: dateToIso(data.paymentConfirmedAt ?? data.payment_confirmed_at ?? data.updatedAt ?? data.createdAt),
    publicUrl: '',
  }
}

async function loadPortalData(storeId: string, customerId: string, customer: RecordMap, brand: RecordMap) {
  const storeRef = defaultDb.collection('stores').doc(storeId)
  const [bookings, invoices, receipts] = await Promise.all([
    scanCollection(storeRef.collection('integrationBookings'), customerId, customer),
    scanCollection(storeRef.collection('invoices'), customerId, customer),
    scanCollection(storeRef.collection('receipts'), customerId, customer),
  ])

  const bookingRows = bookings
    .map(item => mapBooking(item.id, item.data))
    .sort((left, right) => `${right.bookingDate || ''}${right.bookingTime || ''}`.localeCompare(`${left.bookingDate || ''}${left.bookingTime || ''}`))
  const invoiceRows = invoices
    .map(item => mapInvoice(item.id, item.data))
    .sort((left, right) => (right.updatedAt || right.createdAt || '').localeCompare(left.updatedAt || left.createdAt || ''))
  const receiptRows = receipts
    .map(item => mapReceipt(item.id, item.data))
    .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))
  const receiptReferences = new Set(receiptRows.map(item => item.reference.trim().toLowerCase()).filter(Boolean))
  const bookingPaymentRows = bookings
    .map(item => mapBookingPayment(item.id, item.data))
    .filter((item): item is NonNullable<ReturnType<typeof mapBookingPayment>> => Boolean(item))
    .filter(item => !item.reference || !receiptReferences.has(item.reference.trim().toLowerCase()))
  const paymentRows = [
    ...receiptRows.map(item => ({ ...item, kind: 'receipt' as const, title: item.receiptNumber })),
    ...bookingPaymentRows,
  ].sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))

  const customerDebt = record(customer.debt)
  const outstandingCents = numberValue(customerDebt.outstandingCents)
  const invoiceBalance = invoiceRows.reduce((sum, invoice) => {
    if (['paid', 'cancelled', 'canceled', 'void'].includes(invoice.status.toLowerCase())) return sum
    if (invoice.balance !== null) return sum + Math.max(0, invoice.balance)
    if (invoice.total !== null && invoice.amountPaid !== null) return sum + Math.max(0, invoice.total - invoice.amountPaid)
    return sum
  }, 0)

  return {
    customer: {
      name: customerDisplayName(customer),
      email: email(customer.email),
      phone: phone(customer.phone),
    },
    brand: {
      storeName: text(brand.storeName, 180) || 'Sedifex Store',
      email: email(brand.email),
      phone: phone(brand.phone),
      logoUrl: text(brand.logoUrl, 1000),
      brandColor: text(brand.brandColor, 40) || '#4f46e5',
      address: text(brand.address, 500),
      town: text(brand.town, 160),
      country: text(brand.country, 160),
    },
    summary: {
      upcomingBookings: bookingRows.filter(item => !['cancelled', 'canceled', 'completed', 'complete'].includes(item.status.toLowerCase())).length,
      invoices: invoiceRows.length,
      payments: paymentRows.length,
      receipts: receiptRows.length,
      outstanding: outstandingCents !== null ? Math.max(0, outstandingCents / 100) : invoiceBalance,
      currency: invoiceRows.find(item => item.currency)?.currency || bookingRows.find(item => item.currency)?.currency || 'GHS',
    },
    bookings: bookingRows,
    invoices: invoiceRows,
    payments: paymentRows,
    receipts: receiptRows,
  }
}

function createToken() {
  return randomBytes(32).toString('base64url')
}

async function loadLink(rawToken: string) {
  const token = text(rawToken, 300)
  if (!token) throw new Error('INVALID_LINK')
  const hash = hashPublicContractToken(token)
  const linkRef = defaultDb.collection('eventClientLinks').doc(hash)
  let linkSnapshot = await linkRef.get()
  let legacyRef: FirebaseFirestore.DocumentReference | null = null
  let legacy = false
  if (!linkSnapshot.exists) {
    legacyRef = defaultDb.collection('customerPortalLinks').doc(hash)
    linkSnapshot = await legacyRef.get()
    if (!linkSnapshot.exists) throw new Error('INVALID_LINK')
    legacy = true
  }
  const link = linkSnapshot.data() as unknown as CustomerPortalLink
  if (!legacy && link.linkKind !== 'customer_portal') throw new Error('INVALID_LINK')
  if (link.status !== 'active') throw new Error('LINK_REVOKED')
  if (!link.expiresAt?.toMillis || link.expiresAt.toMillis() < Date.now()) throw new Error('LINK_EXPIRED')

  const customerRef = defaultDb.collection('customers').doc(link.customerId)
  const customerSnapshot = await customerRef.get()
  if (!customerSnapshot.exists) throw new Error('CUSTOMER_NOT_FOUND')
  const customer = customerSnapshot.data() as RecordMap
  if (text(customer.storeId, 180) !== link.storeId) throw new Error('INVALID_LINK')
  const portal = record(customer.portal)
  if (text(portal.publicLinkHash, 100) !== hash || text(portal.status, 40) !== 'active') throw new Error('LINK_REVOKED')

  if (legacy && legacyRef) {
    const now = admin.firestore.FieldValue.serverTimestamp()
    await defaultDb.runTransaction(async transaction => {
      transaction.set(linkRef, {
        ...link,
        linkKind: 'customer_portal',
        migratedAt: now,
        updatedAt: now,
      }, { merge: true })
      transaction.delete(legacyRef as FirebaseFirestore.DocumentReference)
      transaction.update(customerRef, {
        'portal.linkCollection': 'eventClientLinks',
        updatedAt: now,
      })
    })
  }
  return { token, hash, linkRef, link: { ...link, linkKind: 'customer_portal' as const }, customerRef, customer }
}

export const shareCustomerPortal = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const customerId = text(data?.customerId, 220)
  const sendEmail = data?.sendEmail !== false
  if (!storeId || !customerId) throw new functions.https.HttpsError('invalid-argument', 'storeId and customerId are required')

  const store = await assertStoreAccess(storeId, context.auth.uid)
  const { customerRef, customer } = await loadCustomerForStore(storeId, customerId)
  const token = createToken()
  const hash = hashPublicContractToken(token)
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_DAYS * 86400000)
  const publicUrl = `${CUSTOMER_PORTAL_BASE_URL}/customer-portal/${encodeURIComponent(token)}`
  const brand = brandSnapshot(store)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const linkRef = defaultDb.collection('eventClientLinks').doc(hash)

  await defaultDb.runTransaction(async transaction => {
    const current = await transaction.get(customerRef)
    if (!current.exists) throw new functions.https.HttpsError('not-found', 'Customer not found')
    const currentData = current.data() as RecordMap
    if (text(currentData.storeId, 180) !== storeId) throw new functions.https.HttpsError('permission-denied', 'Customer belongs to another store')
    const currentPortal = record(currentData.portal)
    const currentHash = text(currentPortal.publicLinkHash, 100)
    if (currentHash && currentHash !== hash) {
      transaction.set(defaultDb.collection('eventClientLinks').doc(currentHash), {
        status: 'revoked',
        revokedAt: now,
        updatedAt: now,
      }, { merge: true })
    }

    transaction.set(linkRef, {
      linkKind: 'customer_portal',
      storeId,
      customerId,
      status: 'active',
      expiresAt,
      brandSnapshot: brand,
      createdAt: now,
      updatedAt: now,
      createdBy: context.auth?.uid || null,
    })
    transaction.update(customerRef, {
      portal: {
        status: 'active',
        publicLinkHash: hash,
        linkCollection: 'eventClientLinks',
        publicUrl,
        expiresAt,
        sharedAt: now,
        sharedBy: context.auth?.uid || null,
      },
      updatedAt: now,
    })
  })

  let deliveries = 0
  let deliveryStatus = 'not-requested'
  let deliveryChannel = 'none'
  let deliveryReason = ''
  const customerEmail = email(customer.email)
  if (sendEmail && customerEmail) {
    const result = await deliverTransactionalEmail({
      storeId,
      eventType: 'customer.portal_shared',
      reference: `${customerId}-portal-${hash.slice(0, 12)}`,
      recipientType: 'customer',
      to: customerEmail,
      subject: `Your customer portal - ${text(brand.storeName, 180) || 'Sedifex'}`,
      html: `<p>Hello ${escapeHtml(customerDisplayName(customer))},</p><p>${escapeHtml(text(brand.storeName, 180) || 'The business')} has shared a secure customer portal with you.</p><p>You can use it to review your bookings, invoices, payment receipts and current balance.</p><p><a href="${publicUrl}">Open your customer portal</a></p><p>This private link expires in ${LINK_LIFETIME_DAYS} days. Do not forward it to anyone you do not trust.</p>`,
      text: `Hello ${customerDisplayName(customer)}, open your secure customer portal: ${publicUrl}`,
      customer: { name: customerDisplayName(customer), email: customerEmail, phone: phone(customer.phone) },
      data: { customerId, portalUrl: publicUrl, expiresAt: expiresAt.toDate().toISOString() },
    })
    deliveries = result.ok && result.channel !== 'outbox_only' ? 1 : 0
    deliveryStatus = result.deliveryStatus
    deliveryChannel = result.channel
    deliveryReason = result.reason || ''
  }

  const communicationStatus = !sendEmail
    ? 'link_created_only'
    : !customerEmail
      ? 'needs_customer_email'
      : deliveries > 0
        ? (deliveryStatus === 'queued' ? 'queued' : 'sent')
        : deliveryStatus === 'outbox'
          ? 'queued_no_live_sender'
          : 'failed'
  await customerRef.collection('messages').doc(`sedifex-portal-manual-${hash}`).set({
    storeId,
    customerId,
    customerName: customerDisplayName(customer),
    channel: sendEmail ? 'email' : 'portal_link',
    direction: 'outbound',
    source: 'sedifex_manual_portal_share',
    eventType: 'customer.portal_shared',
    subject: 'Your customer portal',
    body: sendEmail
      ? `Sedifex attempted to share the secure customer portal with ${customerEmail || 'the customer'}. Delivery: ${communicationStatus} via ${deliveryChannel}.`
      : 'Sedifex created a secure customer portal link without sending an email.',
    recipient: customerEmail || null,
    status: communicationStatus,
    deliveryChannel,
    deliveryStatus,
    deliveryReason: deliveryReason || null,
    portalUrl: publicUrl,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })

  return {
    ok: true,
    portalUrl: publicUrl,
    expiresAt: expiresAt.toDate().toISOString(),
    deliveries,
    deliveryStatus,
    deliveryChannel,
    deliveryReason,
  }
})

export const revokeCustomerPortal = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const customerId = text(data?.customerId, 220)
  if (!storeId || !customerId) throw new functions.https.HttpsError('invalid-argument', 'storeId and customerId are required')
  await assertStoreAccess(storeId, context.auth.uid)
  const { customerRef, customer } = await loadCustomerForStore(storeId, customerId)
  const portal = record(customer.portal)
  const hash = text(portal.publicLinkHash, 100)
  const now = admin.firestore.FieldValue.serverTimestamp()

  await defaultDb.runTransaction(async transaction => {
    if (hash) {
      transaction.set(defaultDb.collection('eventClientLinks').doc(hash), {
        status: 'revoked',
        revokedAt: now,
        updatedAt: now,
      }, { merge: true })
    }
    transaction.update(customerRef, {
      'portal.status': 'revoked',
      'portal.publicUrl': null,
      'portal.revokedAt': now,
      updatedAt: now,
    })
  })

  return { ok: true }
})

export const getCustomerPortal = functions.https.onCall(async (data) => {
  try {
    const loaded = await loadLink(data?.token)
    const brand = record(loaded.link.brandSnapshot)
    const portal = await loadPortalData(loaded.link.storeId, loaded.link.customerId, loaded.customer, brand)
    return {
      ok: true,
      ...portal,
      expiresAt: loaded.link.expiresAt.toDate().toISOString(),
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'LINK_EXPIRED') throw new functions.https.HttpsError('failed-precondition', 'This customer portal link has expired. Ask the business for a new link.')
    if (code === 'LINK_REVOKED') throw new functions.https.HttpsError('permission-denied', 'This customer portal link is no longer active. Ask the business for the latest link.')
    if (code === 'CUSTOMER_NOT_FOUND') throw new functions.https.HttpsError('not-found', 'This customer profile is no longer available.')
    throw new functions.https.HttpsError('not-found', 'This customer portal link is invalid or no longer available.')
  }
})
