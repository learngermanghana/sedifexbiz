import * as functions from 'firebase-functions/v1'
import { randomBytes } from 'crypto'
import { admin, defaultDb } from './firestore'
import { hashPublicContractToken } from './eventContractSigningCore'
import { deliverTransactionalEmail, type TransactionalEmailDeliveryResult } from './emailDelivery'

type RecordMap = Record<string, unknown>

type PortalState = {
  created: boolean
  portalUrl: string
  customerId: string
  customerName: string
  customerEmail: string
  customerPhone: string
  expiresAt: FirebaseFirestore.Timestamp
}

const LINK_LIFETIME_DAYS = 180
const PUBLIC_APP_BASE_URL = (process.env.SEDIFEX_PUBLIC_APP_URL || 'https://sedifex.com').replace(/\/$/, '')

function text(value: unknown, max = 5000) {
  if (typeof value === 'string') return value.trim().slice(0, max)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function email(value: unknown) {
  const valueText = text(value, 220).toLowerCase()
  return valueText.includes('@') ? valueText : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function firstText(values: unknown[], max = 500) {
  for (const value of values) {
    const candidate = text(value, max)
    if (candidate) return candidate
  }
  return ''
}

function escapeHtml(value: unknown) {
  return text(value, 5000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function bookingCustomerId(data: RecordMap) {
  const customer = record(data.customer)
  return firstText([data.customerId, data.customer_id, customer.customerId, customer.id], 220)
}

function bookingStatus(data: RecordMap) {
  const booking = record(data.booking)
  return firstText([data.bookingStatus, data.booking_status, data.status, booking.status], 80)
    .toLowerCase()
    .replace(/[\s-]+/g, '_') || 'pending'
}

function bookingReference(bookingId: string, data: RecordMap) {
  const payment = record(data.payment)
  return firstText([data.reference, data.bookingId, data.paymentReference, payment.reference], 220) || bookingId
}

function embeddedStoreId(data: RecordMap) {
  return firstText([data.storeId, data.store_id, data.merchantId], 180)
}

function customerName(customer: RecordMap) {
  return firstText([customer.displayName, customer.name, customer.email, customer.phone], 220) || 'Customer'
}

function storeBrand(store: RecordMap) {
  return {
    storeName: firstText([store.displayName, store.businessName, store.name], 180) || 'Sedifex Store',
    email: email(store.email) || email(store.ownerEmail) || email(store.firstSignupEmail),
    phone: text(store.phone, 80),
    logoUrl: text(store.logoUrl, 1000),
    brandColor: text(store.brandColor, 40) || '#4f46e5',
  }
}

function timestampMillis(value: unknown) {
  if (value instanceof admin.firestore.Timestamp) return value.toMillis()
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    try { return (value as { toMillis: () => number }).toMillis() } catch { return 0 }
  }
  return 0
}

function activePortal(portal: RecordMap) {
  const publicUrl = text(portal.publicUrl, 1400)
  const hash = text(portal.publicLinkHash, 100)
  const expiresAtMs = timestampMillis(portal.expiresAt)
  return text(portal.status, 40) === 'active' && text(portal.linkCollection, 80) === 'eventClientLinks' && Boolean(publicUrl && hash) && expiresAtMs > Date.now()
}

function createToken() {
  return randomBytes(32).toString('base64url')
}

async function ensurePortalForBooking(storeId: string, customerId: string, store: RecordMap): Promise<PortalState | null> {
  const customerRef = defaultDb.collection('customers').doc(customerId)
  const token = createToken()
  const hash = hashPublicContractToken(token)
  const candidateUrl = `${PUBLIC_APP_BASE_URL}/customer-portal/${encodeURIComponent(token)}`
  const candidateExpiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_DAYS * 86400000)
  const brand = storeBrand(store)
  const now = admin.firestore.FieldValue.serverTimestamp()

  return defaultDb.runTransaction(async transaction => {
    const customerSnapshot = await transaction.get(customerRef)
    if (!customerSnapshot.exists) return null
    const customer = customerSnapshot.data() as RecordMap
    if (text(customer.storeId, 180) !== storeId) return null

    const currentPortal = record(customer.portal)
    if (activePortal(currentPortal)) {
      const expiresAt = currentPortal.expiresAt instanceof admin.firestore.Timestamp
        ? currentPortal.expiresAt
        : admin.firestore.Timestamp.fromMillis(timestampMillis(currentPortal.expiresAt))
      return {
        created: false,
        portalUrl: text(currentPortal.publicUrl, 1400),
        customerId,
        customerName: customerName(customer),
        customerEmail: email(customer.email),
        customerPhone: text(customer.phone, 80),
        expiresAt,
      }
    }

    const previousHash = text(currentPortal.publicLinkHash, 100)
    if (previousHash) {
      transaction.set(defaultDb.collection('eventClientLinks').doc(previousHash), {
        status: 'revoked',
        revokedAt: now,
        updatedAt: now,
      }, { merge: true })
    }

    transaction.set(defaultDb.collection('eventClientLinks').doc(hash), {
      linkKind: 'customer_portal',
      storeId,
      customerId,
      status: 'active',
      expiresAt: candidateExpiresAt,
      brandSnapshot: brand,
      source: 'booking_automation',
      createdAt: now,
      updatedAt: now,
      createdBy: 'sedifex',
    })
    transaction.update(customerRef, {
      portal: {
        status: 'active',
        publicLinkHash: hash,
        linkCollection: 'eventClientLinks',
        publicUrl: candidateUrl,
        expiresAt: candidateExpiresAt,
        sharedAt: now,
        sharedBy: 'sedifex_booking_automation',
        source: 'booking_automation',
      },
      updatedAt: now,
    })

    return {
      created: true,
      portalUrl: candidateUrl,
      customerId,
      customerName: customerName(customer),
      customerEmail: email(customer.email),
      customerPhone: text(customer.phone, 80),
      expiresAt: candidateExpiresAt,
    }
  })
}

function communicationStatus(delivery: TransactionalEmailDeliveryResult | null, hasEmail: boolean) {
  if (!hasEmail) return 'needs_customer_email'
  if (!delivery) return 'failed'
  if (delivery.ok && delivery.channel !== 'outbox_only') return delivery.deliveryStatus === 'queued' ? 'queued' : 'sent'
  if (delivery.channel === 'outbox_only') return 'queued_no_live_sender'
  return 'failed'
}

async function logPortalCommunication(input: {
  storeId: string
  bookingId: string
  bookingReference: string
  portal: PortalState
  customerDelivery: TransactionalEmailDeliveryResult | null
}) {
  const status = communicationStatus(input.customerDelivery, Boolean(input.portal.customerEmail))
  const deliveryChannel = input.customerDelivery?.channel || 'none'
  const subject = `Your customer portal`
  const body = input.portal.customerEmail
    ? `Sedifex automatically shared the secure customer portal after booking ${input.bookingReference}. Customer email: ${input.portal.customerEmail}. Delivery: ${status} via ${deliveryChannel}.`
    : `Sedifex created the secure customer portal after booking ${input.bookingReference}, but no customer email is saved. Add an email address and share the portal from the customer profile.`
  const now = admin.firestore.FieldValue.serverTimestamp()

  await defaultDb.collection('customers').doc(input.portal.customerId).collection('messages').doc(`sedifex-portal-${input.bookingId}`).set({
    storeId: input.storeId,
    customerId: input.portal.customerId,
    customerName: input.portal.customerName,
    channel: 'email',
    direction: 'outbound',
    source: 'sedifex_automation',
    eventType: 'customer.portal_shared',
    subject,
    body,
    recipient: input.portal.customerEmail || null,
    status,
    deliveryChannel,
    deliveryStatus: input.customerDelivery?.deliveryStatus || null,
    deliveryReason: input.customerDelivery?.reason || null,
    bookingId: input.bookingId,
    bookingReference: input.bookingReference,
    portalUrl: input.portal.portalUrl,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })
}

async function storeRecipients(storeId: string, store: RecordMap) {
  const recipients = new Set<string>()
  try {
    const settingsSnapshot = await defaultDb.collection('storeSettings').doc(storeId).get()
    const notifications = record(settingsSnapshot.data()?.notifications)
    const adminEmails = Array.isArray(notifications.adminEmails) ? notifications.adminEmails : []
    adminEmails.forEach(value => {
      const address = email(value)
      if (address) recipients.add(address)
    })
  } catch (error) {
    functions.logger.warn('Unable to load store recipients for customer portal activity', { storeId, error })
  }
  const fallback = email(store.email) || email(store.ownerEmail) || email(store.firstSignupEmail)
  if (fallback) recipients.add(fallback)
  return Array.from(recipients).slice(0, 8)
}

async function notifyStoreOfPortalWork(input: {
  storeId: string
  store: RecordMap
  bookingId: string
  bookingReference: string
  portal: PortalState
  customerDelivery: TransactionalEmailDeliveryResult | null
}) {
  const recipients = await storeRecipients(input.storeId, input.store)
  if (!recipients.length) return
  const brand = storeBrand(input.store)
  const status = communicationStatus(input.customerDelivery, Boolean(input.portal.customerEmail))
  const needsAttention = status === 'failed' || status === 'needs_customer_email' || status === 'queued_no_live_sender'
  const title = needsAttention ? 'Customer portal needs attention' : 'Sedifex shared a customer portal'
  const intro = needsAttention
    ? `Sedifex created a customer portal for ${input.portal.customerName}, but the customer communication needs attention.`
    : `Sedifex automatically created and shared a customer portal for ${input.portal.customerName} after their booking.`
  const html = `<p>${escapeHtml(intro)}</p><table><tr><td><strong>Booking</strong></td><td>${escapeHtml(input.bookingReference)}</td></tr><tr><td><strong>Customer</strong></td><td>${escapeHtml(input.portal.customerName)}</td></tr><tr><td><strong>Customer email</strong></td><td>${escapeHtml(input.portal.customerEmail || 'Not saved')}</td></tr><tr><td><strong>Delivery</strong></td><td>${escapeHtml(status)}</td></tr></table><p><a href="${escapeHtml(input.portal.portalUrl)}">Open customer portal</a></p><p>This activity is also recorded in the customer's Sedifex CRM communication history.</p>`
  const plain = `${intro}\nBooking: ${input.bookingReference}\nCustomer: ${input.portal.customerName}\nCustomer email: ${input.portal.customerEmail || 'Not saved'}\nDelivery: ${status}\nPortal: ${input.portal.portalUrl}`

  await Promise.allSettled(recipients.map(to => deliverTransactionalEmail({
    storeId: input.storeId,
    eventType: 'customer.portal_store_activity',
    reference: `${input.bookingId}-portal-store-${to}`.slice(0, 220),
    recipientType: 'store',
    to,
    subject: `${title} - ${brand.storeName}`,
    html,
    text: plain,
    brand,
    customer: { name: input.portal.customerName, email: input.portal.customerEmail, phone: input.portal.customerPhone },
    data: {
      customerId: input.portal.customerId,
      bookingId: input.bookingId,
      bookingReference: input.bookingReference,
      portalUrl: input.portal.portalUrl,
      deliveryStatus: status,
    },
  })))
}

async function sendAutomaticPortalEmail(input: {
  storeId: string
  store: RecordMap
  bookingId: string
  bookingReference: string
  portal: PortalState
}) {
  if (!input.portal.customerEmail) return null
  const brand = storeBrand(input.store)
  const subject = `Your customer portal - ${brand.storeName}`
  return deliverTransactionalEmail({
    storeId: input.storeId,
    eventType: 'customer.portal_shared',
    reference: `${input.bookingId}-auto-customer-portal`.slice(0, 220),
    recipientType: 'customer',
    to: input.portal.customerEmail,
    subject,
    html: `<p>Hello ${escapeHtml(input.portal.customerName)},</p><p>Your booking with ${escapeHtml(brand.storeName)} has been added to Sedifex.</p><p>Sedifex has created a secure customer portal for you so you can review your bookings, invoices, payment receipts and current balance without waiting for the business to send these details manually.</p><p><a href="${escapeHtml(input.portal.portalUrl)}">Open your customer portal</a></p><p>This is a private link. Do not forward it to anyone you do not trust.</p>`,
    text: `Hello ${input.portal.customerName}, your booking with ${brand.storeName} has been added to Sedifex. Open your secure customer portal: ${input.portal.portalUrl}`,
    brand,
    customer: { name: input.portal.customerName, email: input.portal.customerEmail, phone: input.portal.customerPhone },
    data: {
      customerId: input.portal.customerId,
      bookingId: input.bookingId,
      bookingReference: input.bookingReference,
      portalUrl: input.portal.portalUrl,
      expiresAt: input.portal.expiresAt.toDate().toISOString(),
    },
  })
}

export const automateCustomerPortalOnBookingWrite = functions.firestore
  .document('stores/{storeId}/integrationBookings/{bookingId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const storeId = text(context.params.storeId, 180)
    const bookingId = text(context.params.bookingId, 220)
    if (!storeId || !bookingId) return null

    const after = change.after.data() as RecordMap
    const before = change.before.exists ? change.before.data() as RecordMap : {}
    const customerId = bookingCustomerId(after)
    const beforeCustomerId = bookingCustomerId(before)
    const isNewBooking = !change.before.exists
    const customerWasLinkedNow = Boolean(customerId && customerId !== beforeCustomerId)

    if (!customerId || (!isNewBooking && !customerWasLinkedNow)) return null
    if (['cancelled', 'canceled'].includes(bookingStatus(after))) return null

    const embedded = embeddedStoreId(after)
    if (embedded && embedded !== storeId) {
      functions.logger.error('Blocked cross-store customer portal automation', { storeId, bookingId, embeddedStoreId: embedded })
      return null
    }

    try {
      const storeSnapshot = await defaultDb.collection('stores').doc(storeId).get()
      if (!storeSnapshot.exists) return null
      const store = storeSnapshot.data() as RecordMap
      const portal = await ensurePortalForBooking(storeId, customerId, store)
      if (!portal || !portal.created) return null

      const reference = bookingReference(bookingId, after)
      const customerDelivery = await sendAutomaticPortalEmail({ storeId, store, bookingId, bookingReference: reference, portal })
      await Promise.allSettled([
        logPortalCommunication({ storeId, bookingId, bookingReference: reference, portal, customerDelivery }),
        notifyStoreOfPortalWork({ storeId, store, bookingId, bookingReference: reference, portal, customerDelivery }),
      ])
    } catch (error) {
      functions.logger.error('Automatic customer portal sharing failed', {
        storeId,
        bookingId,
        customerId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  })
