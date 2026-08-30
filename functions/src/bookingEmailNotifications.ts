import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { queueBrandedNotification } from './notifications'

const TIME_ZONE = 'Africa/Accra'
const UNPAID_BOOKING_EVENT = 'booking.received'
const FALLBACK_SCAN_LIMIT = 250
const FALLBACK_LOOKBACK_HOURS = 48
const FALLBACK_CONCURRENCY = 8

type RecordMap = Record<string, unknown>

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordMap)
    : {}
}

function firstText(values: unknown[], max = 500) {
  for (const value of values) {
    const candidate = text(value, max)
    if (candidate) return candidate
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeStatus(value: unknown) {
  return text(value, 100).toLowerCase().replace(/[\s-]+/g, '_')
}

function bookingStoreId(data: RecordMap) {
  return firstText([data.storeId, data.store_id], 180)
}

function asDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate()
      return Number.isNaN(date.getTime()) ? null : date
    }
    const seconds =
      typeof timestamp.seconds === 'number'
        ? timestamp.seconds
        : typeof timestamp._seconds === 'number'
          ? timestamp._seconds
          : null
    if (seconds !== null) return new Date(seconds * 1000)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function customerFromBooking(data: RecordMap) {
  const customer = record(data.customer)
  return {
    name:
      firstText(
        [data.customerName, data.customer_name, data.fullName, data.name, customer.name],
        160,
      ) || null,
    email:
      firstText([data.customerEmail, data.customer_email, data.email, customer.email], 220)
        .toLowerCase() || null,
    phone:
      firstText([data.customerPhone, data.customer_phone, data.phone, customer.phone], 80) ||
      null,
  }
}

function paymentStatus(data: RecordMap) {
  const payment = record(data.payment)
  return normalizeStatus(
    data.paymentStatus ?? data.payment_status ?? payment.status ?? payment.paymentStatus,
  )
}

function bookingStatus(data: RecordMap) {
  const booking = record(data.booking)
  return normalizeStatus(
    data.bookingStatus ?? data.booking_status ?? data.status ?? booking.status,
  )
}

function hasPaymentConfirmation(data: RecordMap) {
  const payment = record(data.payment)
  return Boolean(
    data.paymentConfirmedAt ||
      data.payment_confirmed_at ||
      data.paymentVerifiedAt ||
      data.payment_verified_at ||
      payment.confirmedAt ||
      payment.confirmed_at ||
      payment.verifiedAt ||
      payment.verified_at,
  )
}

function isPaymentSettled(data: RecordMap) {
  // A caller-supplied paid-like status is not sufficient. Only a Sedifex/provider
  // confirmation timestamp suppresses the payment-pending notification.
  return hasPaymentConfirmation(data)
}

function isUnpaidBooking(data: RecordMap) {
  const status = bookingStatus(data)
  if (['cancelled', 'canceled', 'completed', 'complete', 'confirmed'].includes(status)) return false
  if (isPaymentSettled(data)) return false

  const rawPaymentStatus = paymentStatus(data)
  const unpaidStatuses = new Set([
    '',
    'pending',
    'payment_pending',
    'pending_payment',
    'unpaid',
    'not_paid',
    'paid',
    'success',
    'succeeded',
    'confirmed',
  ])
  return unpaidStatuses.has(rawPaymentStatus)
}

function paymentFromBooking(data: RecordMap) {
  const payment = record(data.payment)
  return {
    status: 'pending',
    amount: numberValue(
      data.paymentAmount ?? data.amount ?? data.total ?? payment.amount ?? payment.total,
    ),
    currency: firstText([data.currency, payment.currency], 20) || 'GHS',
    method:
      firstText(
        [
          data.paymentMethod,
          data.payment_method,
          data.paymentCollectionMode,
          data.paymentOption,
          payment.method,
        ],
        80,
      ) || null,
    reference:
      firstText(
        [
          data.paymentReference,
          data.payment_reference,
          data.paystackReference,
          payment.reference,
        ],
        220,
      ) || null,
  }
}

function notificationData(bookingId: string, data: RecordMap) {
  const booking = record(data.booking)
  const originalNotes = firstText([data.notes, booking.notes], 1000)
  const paymentNote =
    'Payment has not been confirmed yet. This booking remains payment pending until the customer completes payment.'

  return {
    bookingId,
    booking_id: bookingId,
    bookingStatus: bookingStatus(data) || 'pending_approval',
    booking_status: bookingStatus(data) || 'pending_approval',
    status: bookingStatus(data) || 'pending',
    serviceId: firstText([data.serviceId, data.service_id, booking.serviceId], 220) || null,
    serviceName:
      firstText(
        [
          data.serviceName,
          data.service_name,
          data.internalServiceName,
          data.itemName,
          data.productName,
          booking.serviceName,
        ],
        240,
      ) || 'Service booking',
    itemName:
      firstText(
        [
          data.serviceName,
          data.service_name,
          data.internalServiceName,
          data.itemName,
          data.productName,
          booking.serviceName,
        ],
        240,
      ) || 'Service booking',
    bookingDate:
      firstText(
        [data.bookingDate, data.booking_date, data.date, booking.preferredDate, booking.date],
        80,
      ) || null,
    bookingTime:
      firstText(
        [data.bookingTime, data.booking_time, data.time, booking.preferredTime, booking.time],
        80,
      ) || null,
    branch:
      firstText(
        [
          data.preferredBranch,
          data.branchLocationName,
          data.branchName,
          data.branch,
          data.location,
        ],
        180,
      ) || null,
    location:
      firstText(
        [data.branchLocationName, data.preferredBranch, data.branchName, data.branch, data.location],
        180,
      ) || null,
    notes: originalNotes ? `${originalNotes}\n\n${paymentNote}` : paymentNote,
  }
}

async function markNotificationQueued(
  storeId: string,
  bookingId: string,
  deliveries: number,
) {
  const patch = {
    pendingBookingEmailNotificationQueuedAt: admin.firestore.FieldValue.serverTimestamp(),
    pendingBookingEmailNotificationDeliveries: deliveries,
    pendingBookingEmailNotificationEvent: UNPAID_BOOKING_EVENT,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  const storeBookingRef = defaultDb
    .collection('stores')
    .doc(storeId)
    .collection('integrationBookings')
    .doc(bookingId)

  await storeBookingRef.set(patch, { merge: true })

  // The root integrationBookings collection is only a mirror. Never mutate a root
  // booking unless its embedded storeId proves it belongs to the same store.
  const rootBookingRef = defaultDb.collection('integrationBookings').doc(bookingId)
  try {
    const rootSnapshot = await rootBookingRef.get()
    if (!rootSnapshot.exists) return

    const rootData = rootSnapshot.data() as RecordMap
    const rootStoreId = bookingStoreId(rootData)
    if (rootStoreId !== storeId) {
      functions.logger.error('Blocked cross-store booking email marker write', {
        bookingId,
        expectedStoreId: storeId,
        rootStoreId: rootStoreId || null,
      })
      return
    }

    await rootBookingRef.set(patch, { merge: true })
  } catch (error) {
    functions.logger.warn('Could not mirror booking email notification marker', {
      bookingId,
      storeId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function queueUnpaidBookingEmails(storeId: string, bookingId: string, data: RecordMap) {
  if (!storeId || !bookingId || !isUnpaidBooking(data)) return false

  const embeddedStoreId = bookingStoreId(data)
  if (embeddedStoreId && embeddedStoreId !== storeId) {
    functions.logger.error('Blocked cross-store booking email', {
      bookingId,
      expectedStoreId: storeId,
      embeddedStoreId,
    })
    return false
  }

  const result = await queueBrandedNotification({
    eventType: UNPAID_BOOKING_EVENT,
    storeId,
    reference: firstText([data.reference, data.bookingReference, data.booking_reference], 220) || bookingId,
    customer: customerFromBooking(data),
    payment: paymentFromBooking(data),
    data: notificationData(bookingId, data),
    forceStoreAlert: true,
  })

  if (result.ok) {
    await markNotificationQueued(storeId, bookingId, result.deliveries ?? 0)
    return true
  }

  return false
}

export const notifyUnpaidBookingCreated = functions.firestore
  .document('stores/{storeId}/integrationBookings/{bookingId}')
  .onCreate(async (snapshot, context) => {
    const storeId = text(context.params.storeId, 180)
    const bookingId = text(context.params.bookingId, 260)
    if (!storeId || !bookingId) return null

    const data = snapshot.data() as RecordMap
    await queueUnpaidBookingEmails(storeId, bookingId, data)
    return null
  })

async function loadStoreScopedBooking(storeId: string, bookingId: string) {
  const snapshot = await defaultDb
    .collection('stores')
    .doc(storeId)
    .collection('integrationBookings')
    .doc(bookingId)
    .get()

  if (!snapshot.exists) {
    functions.logger.error('Blocked fallback booking email without store-scoped booking', {
      bookingId,
      storeId,
    })
    return null
  }

  const data = snapshot.data() as RecordMap
  const embeddedStoreId = bookingStoreId(data)
  if (embeddedStoreId && embeddedStoreId !== storeId) {
    functions.logger.error('Blocked fallback booking email with store mismatch', {
      bookingId,
      expectedStoreId: storeId,
      embeddedStoreId,
    })
    return null
  }

  return data
}

async function runWithConcurrency<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(FALLBACK_CONCURRENCY, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++
        await worker(items[index])
      }
    },
  )
  await Promise.all(workers)
}

export const processUnpaidBookingEmailNotifications = functions.pubsub
  .schedule('every 15 minutes')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const cutoff = Date.now() - FALLBACK_LOOKBACK_HOURS * 60 * 60 * 1000
    const snapshot = await defaultDb
      .collection('integrationBookings')
      .orderBy('createdAt', 'desc')
      .limit(FALLBACK_SCAN_LIMIT)
      .get()

    const results = { checked: snapshot.size, queued: 0, skipped: 0, errors: 0 }

    await runWithConcurrency(snapshot.docs, async doc => {
      const rootData = doc.data() as RecordMap
      const storeId = bookingStoreId(rootData)
      if (!storeId) {
        results.skipped += 1
        return
      }

      try {
        // The store-scoped record is authoritative. The root collection is a mirror
        // and must never be trusted by itself to decide who receives a booking email.
        const data = await loadStoreScopedBooking(storeId, doc.id)
        if (!data) {
          results.skipped += 1
          return
        }

        if (data.pendingBookingEmailNotificationQueuedAt) {
          results.skipped += 1
          return
        }

        const createdAt = asDate(data.createdAt) ?? asDate(rootData.createdAt)
        if (createdAt && createdAt.getTime() < cutoff) {
          results.skipped += 1
          return
        }

        if (!isUnpaidBooking(data)) {
          results.skipped += 1
          return
        }

        const queued = await queueUnpaidBookingEmails(storeId, doc.id, data)
        if (queued) results.queued += 1
        else results.skipped += 1
      } catch (error) {
        results.errors += 1
        functions.logger.error('Unpaid booking email fallback failed', {
          bookingId: doc.id,
          storeId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    functions.logger.info('Unpaid booking email scan complete', results)
    return null
  })
