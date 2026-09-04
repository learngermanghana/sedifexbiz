import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { queueBrandedNotification } from './notifications'
import {
  calculateSmsCredits,
  formatSmsAddress,
  loadSmsRateTable,
  resolveStoreSmsGateway,
  type SmsRateTable,
} from './smsGateway'

const TIME_ZONE = 'Africa/Accra'
const QUERY_LIMIT = 250
const CONCURRENCY = 8

type Stage =
  | 'booking_received'
  | 'booking_confirmed'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'payment_confirmation'
  | 'reminder_3d'
  | 'reminder_2d'
  | 'reminder_1d'
  | 'thank_you'
type AlertKind = 'sent' | 'failed' | 'unknown' | 'insufficient_credits' | 'sender_not_configured'
type RecordMap = Record<string, unknown>

const stages: Stage[] = [
  'booking_received',
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'payment_confirmation',
  'reminder_3d',
  'reminder_2d',
  'reminder_1d',
  'thank_you',
]

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function first(values: unknown[], max = 500) {
  for (const value of values) {
    const candidate = text(value, max)
    if (candidate) return candidate
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function norm(value: unknown, fallback = '') {
  return text(value, 100).toLowerCase().replace(/[\s-]+/g, '_') || fallback
}

function asDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate()
    const seconds = typeof timestamp.seconds === 'number'
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

function bookingStatus(data: RecordMap) {
  const booking = record(data.booking)
  return norm(data.bookingStatus ?? data.booking_status ?? data.status ?? booking.status, 'pending')
}

function paymentStatus(data: RecordMap) {
  const payment = record(data.payment)
  return norm(data.paymentStatus ?? data.payment_status ?? payment.status ?? payment.paymentStatus, 'pending')
}

function verifiedPaid(data: RecordMap) {
  if (paymentStatus(data) !== 'paid') return false
  const payment = record(data.payment)
  return Boolean(
    asDate(data.paymentVerifiedAt ?? data.payment_verified_at) ||
    asDate(data.paymentConfirmedAt ?? data.payment_confirmed_at) ||
    asDate(payment.verifiedAt ?? payment.verified_at) ||
    asDate(payment.confirmedAt ?? payment.confirmed_at),
  )
}

function bookingDate(data: RecordMap) {
  const booking = record(data.booking)
  return first([data.bookingDate, data.booking_date, data.date, booking.preferredDate, booking.preferred_date, booking.date], 40)
}

function bookingTime(data: RecordMap) {
  const booking = record(data.booking)
  return first([data.bookingTime, data.booking_time, data.time, booking.preferredTime, booking.preferred_time, booking.time], 40)
}

function customerName(data: RecordMap) {
  const customer = record(data.customer)
  return first([data.customerName, data.customer_name, data.fullName, data.name, customer.name], 160)
}

function customerPhone(data: RecordMap) {
  const customer = record(data.customer)
  return first([data.customerPhone, data.customer_phone, data.phone, customer.phone], 80)
}

function serviceName(data: RecordMap) {
  const booking = record(data.booking)
  return first([data.serviceName, data.service_name, data.internalServiceName, data.itemName, data.productName, booking.serviceName], 160) || 'appointment'
}

function branchName(data: RecordMap) {
  return first([data.preferredBranch, data.branchLocationName, data.branchName, data.branch, data.location], 120)
}

function storeName(data: RecordMap) {
  return first([data.displayName, data.storeName, data.businessName, data.name], 100) || 'the business'
}

function displayDate(key: string) {
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return key
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function displayTime(raw: string) {
  const value = raw.trim().replace(/\s+/g, '').toLowerCase()
  const ap = value.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (ap) return `${Number(ap[1])}:${String(Number(ap[2] ?? 0)).padStart(2, '0')} ${ap[3].toUpperCase()}`
  const hm = value.match(/^(\d{1,2}):(\d{2})$/)
  if (hm) {
    const hour = Number(hm[1])
    const minute = Number(hm[2])
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
    }
  }
  return raw.trim()
}

function appointment(data: RecordMap) {
  const date = bookingDate(data)
  const time = displayTime(bookingTime(data))
  const label = date ? displayDate(date) : 'the scheduled date'
  return time ? `${label} at ${time}` : label
}

function stageLabel(stage: Stage) {
  if (stage === 'booking_received') return 'Booking received'
  if (stage === 'booking_confirmed') return 'Booking confirmation'
  if (stage === 'booking_rescheduled') return 'Booking reschedule'
  if (stage === 'booking_cancelled') return 'Booking cancellation'
  if (stage === 'payment_confirmation') return 'Payment confirmation'
  if (stage === 'reminder_3d') return '3-day reminder'
  if (stage === 'reminder_2d') return '2-day reminder'
  if (stage === 'reminder_1d') return '1-day reminder'
  return 'Thank-you'
}

function messageFor(stage: Stage, booking: RecordMap, store: RecordMap) {
  const name = customerName(booking).split(/\s+/)[0] || 'there'
  const business = storeName(store)
  const service = serviceName(booking)
  const branch = branchName(booking)
  const suffix = branch ? `, ${branch}` : ''
  if (stage === 'booking_received') return `Hi ${name}, ${business} received your ${service} booking for ${appointment(booking)}${suffix}. We'll confirm it shortly.`
  if (stage === 'booking_confirmed') return `Hi ${name}, your ${service} booking with ${business} is confirmed for ${appointment(booking)}${suffix}.`
  if (stage === 'booking_rescheduled') return `Hi ${name}, ${business} rescheduled your ${service} booking to ${appointment(booking)}${suffix}.`
  if (stage === 'booking_cancelled') return `Hi ${name}, your ${service} booking with ${business} for ${appointment(booking)}${suffix} has been cancelled.`
  if (stage === 'payment_confirmation') return `Hi ${name}, payment received by ${business}. ${service}: ${appointment(booking)}${suffix}. Thank you.`
  if (stage === 'reminder_3d') return `Hi ${name}, reminder from ${business}: your ${service} appointment is in 3 days, ${appointment(booking)}${suffix}.`
  if (stage === 'reminder_2d') return `Hi ${name}, reminder from ${business}: your ${service} appointment is in 2 days, ${appointment(booking)}${suffix}.`
  if (stage === 'reminder_1d') return `Hi ${name}, reminder from ${business}: your ${service} appointment is tomorrow, ${appointment(booking)}${suffix}.`
  return `Hi ${name}, thank you for choosing ${business} for ${service}. We appreciate your business and hope to serve you again.`
}

function queueEligible(stage: Stage, appointmentDate: string, booking: RecordMap) {
  const status = bookingStatus(booking)
  const cancelled = status === 'cancelled' || status === 'canceled'
  if (!customerPhone(booking)) return false
  if (stage === 'booking_received') return !cancelled && status !== 'completed' && status !== 'confirmed'
  if (stage === 'booking_confirmed') return status === 'confirmed'
  if (stage === 'booking_rescheduled') return !cancelled && status !== 'completed'
  if (stage === 'booking_cancelled') return cancelled
  if (cancelled) return false
  if (stage === 'payment_confirmation') return verifiedPaid(booking)
  if (stage === 'thank_you') return status === 'completed'
  return ['confirmed', 'rescheduled'].includes(status) && verifiedPaid(booking) && Boolean(appointmentDate && bookingDate(booking) === appointmentDate)
}

function alertId(bookingId: string, stage: Stage, kind: AlertKind, appointmentDate = '') {
  return encodeURIComponent(`${bookingId}|${stage}|${kind}|${appointmentDate}`)
}

function alertCopy(kind: AlertKind, stage: Stage, booking: RecordMap, reason = '') {
  const label = stageLabel(stage)
  const customer = customerName(booking) || 'the client'
  if (kind === 'sent') {
    return {
      title: `${label} SMS accepted by Hubtel`,
      message: `${label} SMS to ${customer} for ${appointment(booking)} was accepted by Hubtel for processing. Handset delivery is not yet confirmed.`,
      severity: 'info',
    }
  }
  if (kind === 'insufficient_credits') {
    return {
      title: 'SMS not sent — insufficient credits',
      message: `${label} SMS to ${customer} could not be sent because the store does not have enough SMS credits.`,
      severity: 'error',
    }
  }
  if (kind === 'sender_not_configured') {
    return {
      title: 'SMS not sent — sender not configured',
      message: `${label} SMS to ${customer} is blocked because the Hubtel sender is not approved or configured.`,
      severity: 'error',
    }
  }
  if (kind === 'unknown') {
    return {
      title: 'SMS delivery needs review',
      message: `${label} SMS to ${customer} may have been accepted by Hubtel, but Sedifex could not confirm final delivery state.${reason ? ` ${reason}` : ''}`,
      severity: 'error',
    }
  }
  return {
    title: 'Client SMS failed',
    message: `${label} SMS to ${customer} failed.${reason ? ` ${reason}` : ''}`,
    severity: 'error',
  }
}

function emailEventType(kind: AlertKind) {
  if (kind === 'failed') return 'booking_sms_failed'
  if (kind === 'unknown') return 'booking_sms_delivery_unknown'
  if (kind === 'insufficient_credits') return 'booking_sms_insufficient_credits'
  if (kind === 'sender_not_configured') return 'booking_sms_sender_not_configured'
  return 'booking_sms_sent'
}

async function loadBooking(storeId: string, bookingId: string) {
  const storeRef = defaultDb.collection('stores').doc(storeId)
  const bookingRef = storeRef.collection('integrationBookings').doc(bookingId)
  const [storeSnap, bookingSnap] = await Promise.all([storeRef.get(), bookingRef.get()])
  if (!storeSnap.exists || !bookingSnap.exists) return null
  return {
    storeRef,
    bookingRef,
    storeData: storeSnap.data() as RecordMap,
    bookingData: bookingSnap.data() as RecordMap,
  }
}

async function recordStoreAlert(args: {
  storeId: string
  bookingId: string
  stage: Stage
  kind: AlertKind
  appointmentDate?: string
  booking: RecordMap
  reason?: string
  emailStore?: boolean
  provider?: string
  providerMessageId?: string
}) {
  const appointmentDate = args.appointmentDate || bookingDate(args.booking)
  const id = alertId(args.bookingId, args.stage, args.kind, appointmentDate)
  const copy = alertCopy(args.kind, args.stage, args.booking, args.reason)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const notificationRef = defaultDb.collection('stores').doc(args.storeId).collection('storeNotifications').doc(id)
  const historyRef = defaultDb
    .collection('stores')
    .doc(args.storeId)
    .collection('integrationBookings')
    .doc(args.bookingId)
    .collection('communicationHistory')
    .doc(id)

  const existing = await notificationRef.get()
  const providerAccepted = args.kind === 'sent'
  const base = {
    category: 'booking_sms',
    source: 'booking_sms_automation',
    storeId: args.storeId,
    bookingId: args.bookingId,
    stage: args.stage,
    stageLabel: stageLabel(args.stage),
    status: providerAccepted ? 'accepted' : args.kind === 'unknown' ? 'unknown' : 'failed',
    kind: providerAccepted ? 'accepted' : args.kind,
    severity: copy.severity,
    title: copy.title,
    message: copy.message,
    customerName: customerName(args.booking) || null,
    customerPhone: customerPhone(args.booking) || null,
    serviceName: serviceName(args.booking),
    bookingDate: bookingDate(args.booking) || null,
    bookingTime: bookingTime(args.booking) || null,
    appointmentDate: appointmentDate || null,
    branch: branchName(args.booking) || null,
    reason: text(args.reason, 500) || null,
    ...(providerAccepted ? {
      provider: text(args.provider, 60) || 'hubtel',
      providerMessageId: text(args.providerMessageId, 180) || null,
      providerDeliveryStatus: 'accepted',
      deliveryConfirmed: false,
      deliveryNote: 'Hubtel accepted the SMS request. Handset delivery has not been confirmed.',
    } : {}),
    updatedAt: now,
  }

  await Promise.all([
    notificationRef.set({
      ...base,
      ...(existing.exists ? {} : { createdAt: now, unread: true, readAt: null }),
    }, { merge: true }),
    historyRef.set({
      ...base,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true }),
  ])

  if (args.emailStore && !existing.exists) {
    await queueBrandedNotification({
      eventType: emailEventType(args.kind),
      storeId: args.storeId,
      reference: id,
      customer: {
        name: customerName(args.booking) || null,
        email: null,
        phone: customerPhone(args.booking) || null,
      },
      data: {
        itemName: serviceName(args.booking),
        serviceName: serviceName(args.booking),
        bookingId: args.bookingId,
        bookingDate: bookingDate(args.booking),
        bookingTime: bookingTime(args.booking),
        branch: branchName(args.booking),
        notes: copy.message,
      },
      forceStoreAlert: true,
    })
  }
}

export const notifyStoreBookingSmsSent = functions.firestore
  .document('stores/{storeId}/bookingSmsNotifications/{notificationId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data() as RecordMap
    if (norm(data.status) !== 'sent') return null
    const storeId = text(context.params.storeId, 180)
    const bookingId = first([data.bookingId], 260)
    const stage = norm(data.stage) as Stage
    if (!storeId || !bookingId || !stages.includes(stage)) return null
    const loaded = await loadBooking(storeId, bookingId)
    if (!loaded) return null
    await recordStoreAlert({
      storeId,
      bookingId,
      stage,
      kind: 'sent',
      appointmentDate: first([data.appointmentDate], 40),
      booking: loaded.bookingData,
      provider: first([data.provider], 60),
      providerMessageId: first([data.providerMessageId], 180),
    })
    return null
  })

export const notifyStoreBookingSmsQueueState = functions.firestore
  .document('bookingSmsQueue/{queueId}')
  .onWrite(async (change) => {
    if (!change.after.exists) return null
    const after = change.after.data() as RecordMap
    const before = change.before.exists ? change.before.data() as RecordMap : {}
    const afterStatus = norm(after.status, 'pending')
    const beforeStatus = norm(before.status, '')
    if (afterStatus === beforeStatus || !['failed', 'unknown'].includes(afterStatus)) return null

    const storeId = first([after.storeId], 180)
    const bookingId = first([after.bookingId], 260)
    const stage = norm(after.stage) as Stage
    if (!storeId || !bookingId || !stages.includes(stage)) return null
    const loaded = await loadBooking(storeId, bookingId)
    if (!loaded) return null

    await recordStoreAlert({
      storeId,
      bookingId,
      stage,
      kind: afterStatus === 'unknown' ? 'unknown' : 'failed',
      appointmentDate: first([after.appointmentDate], 40),
      booking: loaded.bookingData,
      reason: first([after.lastError], 500),
      emailStore: true,
    })
    return null
  })

async function parallel<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

async function inspectBlockedQueue(doc: FirebaseFirestore.QueryDocumentSnapshot, rates: SmsRateTable) {
  const data = doc.data() as RecordMap
  if (norm(data.status, 'pending') !== 'pending') return
  const storeId = first([data.storeId], 180)
  const bookingId = first([data.bookingId], 260)
  const stage = norm(data.stage) as Stage
  const appointmentDate = first([data.appointmentDate], 40)
  if (!storeId || !bookingId || !stages.includes(stage)) return

  const loaded = await loadBooking(storeId, bookingId)
  if (!loaded || !queueEligible(stage, appointmentDate, loaded.bookingData)) return

  const phone = formatSmsAddress(customerPhone(loaded.bookingData))
  if (!phone) return
  const gateway = resolveStoreSmsGateway(loaded.storeData)
  if (!gateway) {
    await recordStoreAlert({
      storeId,
      bookingId,
      stage,
      kind: 'sender_not_configured',
      appointmentDate,
      booking: loaded.bookingData,
      emailStore: false,
    })
    return
  }

  const message = messageFor(stage, loaded.bookingData, loaded.storeData)
  const cost = calculateSmsCredits(phone, message, rates)
  const balance = typeof loaded.storeData.bulkMessagingCredits === 'number' && Number.isFinite(loaded.storeData.bulkMessagingCredits)
    ? loaded.storeData.bulkMessagingCredits
    : 0
  if (balance < cost.credits) {
    await recordStoreAlert({
      storeId,
      bookingId,
      stage,
      kind: 'insufficient_credits',
      appointmentDate,
      booking: loaded.bookingData,
      reason: `Required ${cost.credits} credits; available ${balance}.`,
      emailStore: true,
    })
  }
}

export const processBookingSmsStoreAlertChecks = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const today = dateKey(new Date())
    const [snapshot, rates] = await Promise.all([
      defaultDb.collection('bookingSmsQueue').where('dueDateKey', '<=', today).limit(QUERY_LIMIT).get(),
      loadSmsRateTable(),
    ])
    const results = { checked: snapshot.size, errors: 0 }
    await parallel(snapshot.docs, async doc => {
      try {
        await inspectBlockedQueue(doc, rates)
      } catch (error) {
        results.errors += 1
        functions.logger.error('booking SMS store alert check failed', {
          queueId: doc.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
    functions.logger.info('booking SMS store alert check complete', results)
    return null
  })