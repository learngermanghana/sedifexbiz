import * as functions from 'firebase-functions/v1'
import { defaultDb } from './firestore'
import { queueBrandedNotification } from './notifications'

const TIME_ZONE = 'Africa/Accra'
const REMINDER_DAYS = new Set([3, 2, 1])
const STORE_BOOKING_LIMIT = 500

type RecordMap = Record<string, unknown>

type BookingEmailEvent =
  | 'booking.received'
  | 'booking.confirmed'
  | 'booking.rescheduled'
  | 'booking.cancelled'
  | 'booking.completed'
  | 'booking.payment_submitted'
  | 'booking.payment_received'
  | 'booking.payment_confirmed'
  | 'booking.reminder_3d'
  | 'booking.reminder_2d'
  | 'booking.reminder_1d'

function text(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
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
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstNumber(values: unknown[], fallback = 0) {
  for (const value of values) {
    const parsed = numberValue(value)
    if (parsed !== null) return parsed
  }
  return fallback
}

function normalizeStatus(value: unknown, fallback = '') {
  return text(value, 100).toLowerCase().replace(/[\s-]+/g, '_') || fallback
}

function asDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof candidate.toDate === 'function') {
      const date = candidate.toDate()
      return Number.isNaN(date.getTime()) ? null : date
    }
    const seconds = typeof candidate.seconds === 'number'
      ? candidate.seconds
      : typeof candidate._seconds === 'number'
        ? candidate._seconds
        : null
    if (seconds !== null) return new Date(seconds * 1000)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftDate(key: string, days: number) {
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dayDiff(from: string, to: string) {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`)
  const toMs = Date.parse(`${to}T00:00:00.000Z`)
  return Number.isFinite(fromMs) && Number.isFinite(toMs)
    ? Math.round((toMs - fromMs) / 86400000)
    : null
}

function bookingStoreId(data: RecordMap) {
  return firstText([data.storeId, data.store_id], 180)
}

function bookingStatus(data: RecordMap) {
  const booking = record(data.booking)
  return normalizeStatus(data.bookingStatus ?? data.booking_status ?? data.status ?? booking.status, 'pending')
}

function paymentStatus(data: RecordMap) {
  const payment = record(data.payment)
  return normalizeStatus(data.paymentStatus ?? data.payment_status ?? payment.status ?? payment.paymentStatus, 'pending')
}

function hasPaymentConfirmation(data: RecordMap) {
  const payment = record(data.payment)
  return Boolean(
    asDate(data.paymentConfirmedAt ?? data.payment_confirmed_at) ||
    asDate(data.paymentVerifiedAt ?? data.payment_verified_at) ||
    asDate(payment.confirmedAt ?? payment.confirmed_at) ||
    asDate(payment.verifiedAt ?? payment.verified_at),
  )
}

function verifiedPaid(data: RecordMap) {
  return paymentStatus(data) === 'paid' && hasPaymentConfirmation(data)
}

function customerFromBooking(data: RecordMap) {
  const customer = record(data.customer)
  return {
    name: firstText([data.customerName, data.customer_name, data.fullName, data.name, customer.name], 180) || null,
    email: firstText([data.customerEmail, data.customer_email, data.email, customer.email], 220).toLowerCase() || null,
    phone: firstText([data.customerPhone, data.customer_phone, data.phone, customer.phone], 80) || null,
  }
}

function serviceName(data: RecordMap) {
  const booking = record(data.booking)
  return firstText([
    data.serviceName,
    data.service_name,
    data.internalServiceName,
    data.itemName,
    data.productName,
    booking.serviceName,
  ], 240) || 'Service booking'
}

function bookingDate(data: RecordMap) {
  const booking = record(data.booking)
  return firstText([
    data.bookingDate,
    data.booking_date,
    data.date,
    booking.preferredDate,
    booking.preferred_date,
    booking.date,
  ], 40)
}

function bookingTime(data: RecordMap) {
  const booking = record(data.booking)
  return firstText([
    data.bookingTime,
    data.booking_time,
    data.time,
    booking.preferredTime,
    booking.preferred_time,
    booking.time,
  ], 40)
}

function branchName(data: RecordMap) {
  return firstText([
    data.preferredBranch,
    data.branchLocationName,
    data.branchName,
    data.branch,
    data.location,
  ], 180)
}

function totalAmount(data: RecordMap) {
  const payment = record(data.payment)
  return Math.max(0, firstNumber([
    data.paymentAmount,
    data.amount,
    data.total,
    data.price,
    payment.amount,
    payment.total,
  ]))
}

function amountReceived(data: RecordMap) {
  const payment = record(data.payment)
  const explicit = Math.max(0, firstNumber([
    data.amountReceived,
    data.amount_received,
    data.depositAmount,
    data.deposit_amount,
    data.depositPaid,
    data.amountPaid,
    payment.amountReceived,
    payment.amount_received,
    payment.depositAmount,
    payment.deposit_amount,
    payment.amountPaid,
  ]))
  if (verifiedPaid(data) && explicit <= 0) return totalAmount(data)
  return explicit
}

function amountOutstanding(data: RecordMap) {
  const payment = record(data.payment)
  const explicit = firstNumber([
    data.amountOutstanding,
    data.amount_outstanding,
    payment.amountOutstanding,
    payment.amount_outstanding,
  ], Number.NaN)
  if (Number.isFinite(explicit)) return Math.max(0, explicit)
  return Math.max(0, totalAmount(data) - amountReceived(data))
}

function paymentReference(data: RecordMap) {
  const payment = record(data.payment)
  return firstText([
    data.paymentReference,
    data.payment_reference,
    data.paystackReference,
    data.reference,
    payment.reference,
  ], 220)
}

function paymentMethod(data: RecordMap) {
  const payment = record(data.payment)
  return firstText([
    data.paymentMethod,
    data.payment_method,
    data.paymentCollectionMode,
    data.paymentOption,
    payment.method,
  ], 80)
}

function notificationData(bookingId: string, data: RecordMap) {
  return {
    bookingId,
    booking_id: bookingId,
    bookingStatus: bookingStatus(data),
    booking_status: bookingStatus(data),
    itemName: serviceName(data),
    serviceName: serviceName(data),
    bookingDate: bookingDate(data) || null,
    bookingTime: bookingTime(data) || null,
    branch: branchName(data) || null,
    location: branchName(data) || null,
    totalAmount: totalAmount(data).toFixed(2),
    amountReceived: amountReceived(data).toFixed(2),
    amountOutstanding: amountOutstanding(data).toFixed(2),
    receiptNumber: paymentReference(data) || `BK-${bookingId.slice(0, 12)}`,
    notes: firstText([data.notes, record(data.booking).notes], 1000) || null,
  }
}

function paymentFromBooking(data: RecordMap) {
  return {
    status: paymentStatus(data),
    amount: amountReceived(data) || totalAmount(data),
    currency: firstText([data.currency, record(data.payment).currency], 20) || 'GHS',
    method: paymentMethod(data) || null,
    reference: paymentReference(data) || null,
  }
}

function eventReference(bookingId: string, eventType: BookingEmailEvent, data: RecordMap, extra = '') {
  const schedule = `${bookingDate(data)}-${bookingTime(data)}`.replace(/[^A-Za-z0-9_-]/g, '')
  const paymentRef = paymentReference(data).replace(/[^A-Za-z0-9_-]/g, '')
  const suffix = extra || paymentRef || schedule || bookingId
  return `${bookingId}-${eventType.replace(/\./g, '-')}-${suffix}`.slice(0, 220)
}

async function queueBookingEmail(
  storeId: string,
  bookingId: string,
  eventType: BookingEmailEvent,
  data: RecordMap,
  options: { forceStoreAlert?: boolean; referenceSuffix?: string } = {},
) {
  return queueBrandedNotification({
    eventType,
    storeId,
    reference: eventReference(bookingId, eventType, data, options.referenceSuffix),
    customer: customerFromBooking(data),
    payment: paymentFromBooking(data),
    data: notificationData(bookingId, data),
    forceStoreAlert: options.forceStoreAlert === true,
  })
}

function meaningfulScheduleChanged(before: RecordMap, after: RecordMap) {
  if (!Object.keys(before).length) return false
  return bookingDate(before) !== bookingDate(after) || bookingTime(before) !== bookingTime(after)
}

async function handleBookingEmailTransitions(
  storeId: string,
  bookingId: string,
  before: RecordMap,
  after: RecordMap,
) {
  const embeddedStoreId = bookingStoreId(after)
  if (embeddedStoreId && embeddedStoreId !== storeId) {
    functions.logger.error('Blocked cross-store booking email automation', {
      bookingId,
      expectedStoreId: storeId,
      embeddedStoreId,
    })
    return
  }

  const isCreate = !Object.keys(before).length
  const beforeBookingStatus = bookingStatus(before)
  const afterBookingStatus = bookingStatus(after)
  const beforePaymentStatus = paymentStatus(before)
  const afterPaymentStatus = paymentStatus(after)
  const wasVerifiedPaid = verifiedPaid(before)
  const isVerifiedPaid = verifiedPaid(after)
  const receivedBefore = amountReceived(before)
  const receivedAfter = amountReceived(after)
  const tasks: Promise<unknown>[] = []

  if (isCreate && afterBookingStatus === 'confirmed') {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.confirmed', after, { forceStoreAlert: true }))
  } else if (isCreate && isVerifiedPaid) {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.received', after, { forceStoreAlert: true }))
  }

  if (!isCreate && afterBookingStatus === 'confirmed' && beforeBookingStatus !== 'confirmed') {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.confirmed', after, { forceStoreAlert: true }))
  }

  const scheduleChanged = meaningfulScheduleChanged(before, after)
  const explicitReschedule = afterBookingStatus === 'rescheduled' && beforeBookingStatus !== 'rescheduled'
  if (!isCreate && (explicitReschedule || (scheduleChanged && beforeBookingStatus === afterBookingStatus)) && !['cancelled', 'completed'].includes(afterBookingStatus)) {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.rescheduled', after, {
      forceStoreAlert: true,
      referenceSuffix: `${bookingDate(after)}-${bookingTime(after)}`,
    }))
  }

  if (!isCreate && afterBookingStatus === 'cancelled' && beforeBookingStatus !== 'cancelled') {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.cancelled', after, { forceStoreAlert: true }))
  }

  if (!isCreate && afterBookingStatus === 'completed' && beforeBookingStatus !== 'completed') {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.completed', after))
  }

  if (afterPaymentStatus === 'awaiting_verification' && beforePaymentStatus !== 'awaiting_verification') {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.payment_submitted', after, { forceStoreAlert: true }))
  }

  if (!isVerifiedPaid && afterPaymentStatus === 'partial' && receivedAfter > receivedBefore + 0.005) {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.payment_received', after, {
      forceStoreAlert: true,
      referenceSuffix: receivedAfter.toFixed(2),
    }))
  }

  if (isVerifiedPaid && !wasVerifiedPaid) {
    tasks.push(queueBookingEmail(storeId, bookingId, 'booking.payment_confirmed', after, {
      forceStoreAlert: true,
      referenceSuffix: paymentReference(after) || amountReceived(after).toFixed(2),
    }))
  }

  const results = await Promise.allSettled(tasks)
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) {
    functions.logger.error('One or more booking email automations failed', {
      storeId,
      bookingId,
      failureCount: failures.length,
      errors: failures.map(result => result.status === 'rejected'
        ? result.reason instanceof Error ? result.reason.message : String(result.reason)
        : ''),
    })
  }
}

export const automateBookingEmailOnWrite = functions.firestore
  .document('stores/{storeId}/integrationBookings/{bookingId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const storeId = text(context.params.storeId, 180)
    const bookingId = text(context.params.bookingId, 260)
    if (!storeId || !bookingId) return null

    const before = change.before.exists ? change.before.data() as RecordMap : {}
    const after = change.after.data() as RecordMap

    try {
      await handleBookingEmailTransitions(storeId, bookingId, before, after)
    } catch (error) {
      functions.logger.error('Booking email automation failed', {
        storeId,
        bookingId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  })

async function runReminderForBooking(storeId: string, bookingId: string, data: RecordMap, today: string) {
  const status = bookingStatus(data)
  if (!['confirmed', 'rescheduled'].includes(status)) return false
  const appointmentDate = bookingDate(data)
  if (!appointmentDate) return false
  const days = dayDiff(today, appointmentDate)
  if (days === null || !REMINDER_DAYS.has(days)) return false

  const eventType = `booking.reminder_${days}d` as BookingEmailEvent
  await queueBookingEmail(storeId, bookingId, eventType, data, {
    referenceSuffix: appointmentDate,
  })
  return true
}

async function storeReminderCandidates(storeId: string, today: string, endDate: string) {
  const collection = defaultDb.collection('stores').doc(storeId).collection('integrationBookings')
  const [bookingDateSnapshot, legacyDateSnapshot] = await Promise.all([
    collection.where('bookingDate', '>=', today).where('bookingDate', '<=', endDate).limit(STORE_BOOKING_LIMIT).get(),
    collection.where('date', '>=', today).where('date', '<=', endDate).limit(STORE_BOOKING_LIMIT).get(),
  ])

  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()
  bookingDateSnapshot.docs.forEach(document => candidates.set(document.id, document))
  legacyDateSnapshot.docs.forEach(document => candidates.set(document.id, document))
  return Array.from(candidates.values())
}

export const processBookingEmailReminders = functions.pubsub
  .schedule('0 8 * * *')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const today = dateKey(new Date())
    const endDate = shiftDate(today, 3)
    const stores = await defaultDb.collection('stores').get()
    const summary = { stores: stores.size, checked: 0, queued: 0, errors: 0 }

    for (const storeDocument of stores.docs) {
      try {
        const candidates = await storeReminderCandidates(storeDocument.id, today, endDate)
        summary.checked += candidates.length
        for (const document of candidates) {
          try {
            const queued = await runReminderForBooking(storeDocument.id, document.id, document.data() as RecordMap, today)
            if (queued) summary.queued += 1
          } catch (error) {
            summary.errors += 1
            functions.logger.error('Booking reminder email failed', {
              storeId: storeDocument.id,
              bookingId: document.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
      } catch (error) {
        summary.errors += 1
        functions.logger.error('Booking reminder store scan failed', {
          storeId: storeDocument.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    functions.logger.info('Booking email reminder scan complete', summary)
    return null
  })
