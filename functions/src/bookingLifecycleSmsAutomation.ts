import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import {
  calculateSmsCredits,
  formatSmsAddress,
  loadSmsRateTable,
  resolveStoreSmsGateway,
  sendSmsViaHubtel,
  type SmsRateTable,
  type StoreSmsGatewayConfig,
} from './smsGateway'
import {
  automationSettingsRef,
  isSmsAutomationEnabledForStage,
  parseAutomationSettings,
  type SmsAutomationStage,
} from './automationSettings'
import {
  bookingLifecycleDate,
  bookingLifecycleEventId,
  bookingLifecycleScheduleKey,
  bookingLifecycleStatus,
  bookingLifecycleTime,
  deriveBookingLifecycleSmsEvents,
  LIFECYCLE_SMS_STAGES,
  type LifecycleSmsStage,
} from './bookingLifecycleSmsRules'

const TIME_ZONE = 'Africa/Accra'
const QUERY_LIMIT = 250
const CONCURRENCY = 8
const RETRY_MINUTES = 60
const STALE_MINUTES = 30
const DISABLED_DATE = '9999-12-31'

type RecordMap = Record<string, unknown>
type SendingState = false | 'active' | 'stale'
type QueueItem = {
  id: string
  ref: FirebaseFirestore.DocumentReference
  eventRef: FirebaseFirestore.DocumentReference
  storeId: string
  bookingId: string
  stage: LifecycleSmsStage
  eventId: string
  eventKey: string
  scheduleKey: string
  statusKey: string
  data: RecordMap
}
type BookingContext = {
  ref: FirebaseFirestore.DocumentReference
  data: RecordMap
  storeData: RecordMap
}
type Claim =
  | { ok: true; claimId: string; credits: number; gateway: StoreSmsGatewayConfig }
  | { ok: false; reason: string }
type ProblemKind = 'failed' | 'unknown' | 'insufficient_credits' | 'sender_not_configured'

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
  return first([
    data.serviceName,
    data.service_name,
    data.internalServiceName,
    data.itemName,
    data.productName,
    booking.serviceName,
  ], 120) || 'appointment'
}

function branchName(data: RecordMap) {
  return first([data.preferredBranch, data.branchLocationName, data.branchName, data.branch, data.location], 100)
}

function storeName(data: RecordMap) {
  return first([data.displayName, data.storeName, data.businessName, data.name], 80) || 'the business'
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
  const twelveHour = value.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (twelveHour) {
    return `${Number(twelveHour[1])}:${String(Number(twelveHour[2] ?? 0)).padStart(2, '0')} ${twelveHour[3].toUpperCase()}`
  }
  const twentyFourHour = value.match(/^(\d{1,2}):(\d{2})$/)
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1])
    const minute = Number(twentyFourHour[2])
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
    }
  }
  return raw.trim()
}

function appointment(data: RecordMap) {
  const rawDate = bookingLifecycleDate(data)
  const rawTime = bookingLifecycleTime(data)
  const date = rawDate ? displayDate(rawDate) : 'the scheduled date'
  const time = displayTime(rawTime)
  return time ? `${date} at ${time}` : date
}

function stageLabel(stage: LifecycleSmsStage) {
  if (stage === 'booking_received') return 'Booking received'
  if (stage === 'booking_confirmed') return 'Booking confirmation'
  if (stage === 'booking_rescheduled') return 'Booking reschedule'
  return 'Booking cancellation'
}

export function bookingLifecycleSmsMessage(stage: LifecycleSmsStage, booking: RecordMap, store: RecordMap) {
  const name = customerName(booking).split(/\s+/)[0] || 'there'
  const business = storeName(store)
  const service = serviceName(booking)
  const branch = branchName(booking)
  const suffix = branch ? `, ${branch}` : ''

  if (stage === 'booking_received') {
    return `Hi ${name}, ${business} received your ${service} booking for ${appointment(booking)}${suffix}. We'll confirm it shortly.`
  }
  if (stage === 'booking_confirmed') {
    return `Hi ${name}, your ${service} booking with ${business} is confirmed for ${appointment(booking)}${suffix}.`
  }
  if (stage === 'booking_rescheduled') {
    return `Hi ${name}, ${business} rescheduled your ${service} booking to ${appointment(booking)}${suffix}.`
  }
  return `Hi ${name}, your ${service} booking with ${business} for ${appointment(booking)}${suffix} has been cancelled.`
}

function rootId(storeId: string, bookingId: string, eventId: string) {
  return encodeURIComponent(`${storeId}|${bookingId}|${eventId}`)
}

function eventRef(storeId: string, bookingId: string, eventId: string) {
  return defaultDb.collection('bookingLifecycleSmsEvents').doc(rootId(storeId, bookingId, eventId))
}

function queueRef(storeId: string, bookingId: string, eventId: string) {
  return defaultDb.collection('bookingLifecycleSmsQueue').doc(rootId(storeId, bookingId, eventId))
}

function notificationRef(item: QueueItem) {
  return defaultDb.collection('stores').doc(item.storeId).collection('bookingSmsNotifications').doc(item.id)
}

async function enqueueEvent(
  storeId: string,
  bookingId: string,
  stage: LifecycleSmsStage,
  eventKey: string,
  booking: RecordMap,
) {
  const eventId = bookingLifecycleEventId(stage, eventKey)
  const event = eventRef(storeId, bookingId, eventId)
  const queue = queueRef(storeId, bookingId, eventId)
  const scheduleKey = bookingLifecycleScheduleKey(booking)
  const statusKey = bookingLifecycleStatus(booking)
  const dueDateKey = dateKey(new Date())

  await defaultDb.runTransaction(async tx => {
    const existing = await tx.get(event)
    if (existing.exists) return
    const now = admin.firestore.FieldValue.serverTimestamp()
    const base = {
      storeId,
      bookingId,
      stage,
      eventId,
      eventKey,
      scheduleKey,
      statusKey,
      bookingDate: bookingLifecycleDate(booking) || null,
      bookingTime: bookingLifecycleTime(booking) || null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    tx.set(event, base)
    tx.set(queue, { ...base, dueDateKey })
  })
}

export const queueBookingLifecycleSmsOnWrite = functions.firestore
  .document('stores/{storeId}/integrationBookings/{bookingId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null

    const storeId = text(context.params.storeId, 180)
    const bookingId = text(context.params.bookingId, 260)
    if (!storeId || !bookingId) return null

    const before = change.before.exists ? change.before.data() as RecordMap : {}
    const after = change.after.data() as RecordMap
    const embeddedStoreId = first([after.storeId, after.store_id], 180)
    if (embeddedStoreId && embeddedStoreId !== storeId) {
      functions.logger.error('Blocked cross-store booking lifecycle SMS automation', {
        storeId,
        bookingId,
        embeddedStoreId,
      })
      return null
    }
    if (!customerPhone(after)) return null

    const transitions = deriveBookingLifecycleSmsEvents(before, after)
    if (!transitions.length) return null

    const settingsSnapshot = await automationSettingsRef(storeId).get()
    const settings = parseAutomationSettings(settingsSnapshot.data())
    const tasks = transitions
      .filter(event => isSmsAutomationEnabledForStage(settings, event.stage as SmsAutomationStage))
      .map(event => enqueueEvent(storeId, bookingId, event.stage, event.eventKey, after))

    const results = await Promise.allSettled(tasks)
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) {
      functions.logger.error('One or more booking lifecycle SMS events failed to queue', {
        storeId,
        bookingId,
        failureCount: failures.length,
        errors: failures.map(result => result.status === 'rejected'
          ? result.reason instanceof Error ? result.reason.message : String(result.reason)
          : ''),
      })
    }
    return null
  })

async function readQueueItem(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<QueueItem | null> {
  const data = doc.data() as RecordMap
  const storeId = first([data.storeId], 180)
  const bookingId = first([data.bookingId], 260)
  const stage = norm(data.stage) as LifecycleSmsStage
  const eventId = first([data.eventId], 220)
  const eventKey = first([data.eventKey], 220)
  const scheduleKey = first([data.scheduleKey], 220)
  const statusKey = first([data.statusKey], 100)

  if (!storeId || !bookingId || !eventId || !eventKey || !LIFECYCLE_SMS_STAGES.includes(stage)) {
    await doc.ref.delete()
    return null
  }

  return {
    id: doc.id,
    ref: doc.ref,
    eventRef: eventRef(storeId, bookingId, eventId),
    storeId,
    bookingId,
    stage,
    eventId,
    eventKey,
    scheduleKey,
    statusKey,
    data,
  }
}

async function loadBooking(item: QueueItem): Promise<BookingContext | null> {
  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const bookingRef = storeRef.collection('integrationBookings').doc(item.bookingId)
  const [storeSnapshot, bookingSnapshot] = await Promise.all([storeRef.get(), bookingRef.get()])
  if (!storeSnapshot.exists || !bookingSnapshot.exists) return null
  return {
    ref: bookingRef,
    data: bookingSnapshot.data() as RecordMap,
    storeData: storeSnapshot.data() as RecordMap,
  }
}

function eligible(item: QueueItem, booking: BookingContext) {
  if (!customerPhone(booking.data)) return false

  const status = bookingLifecycleStatus(booking.data)
  const schedule = bookingLifecycleScheduleKey(booking.data)
  const cancelled = status === 'cancelled' || status === 'canceled'
  const completed = status === 'completed'

  if (item.stage === 'booking_received') {
    return !cancelled
      && !completed
      && status !== 'confirmed'
      && (!item.statusKey || item.statusKey === status)
      && (!item.scheduleKey || item.scheduleKey === schedule)
  }
  if (item.stage === 'booking_confirmed') {
    return status === 'confirmed' && (!item.scheduleKey || item.scheduleKey === schedule)
  }
  if (item.stage === 'booking_rescheduled') {
    return !cancelled && !completed && (!item.scheduleKey || item.scheduleKey === schedule)
  }
  return cancelled
}

async function markTerminal(item: QueueItem, status: 'disabled' | 'stale' | 'booking_missing') {
  const now = admin.firestore.FieldValue.serverTimestamp()
  await Promise.allSettled([
    item.eventRef.set({ status, updatedAt: now }, { merge: true }),
    item.ref.delete(),
  ])
}

async function sendingState(item: QueueItem): Promise<SendingState> {
  if (norm(item.data.status) !== 'sending') return false

  const lockedAt = asDate(item.data.lockedAt)
  if (lockedAt && Date.now() - lockedAt.getTime() < STALE_MINUTES * 60_000) {
    return 'active'
  }

  const message = 'Previous Hubtel send did not finalize. Automatic resend blocked to avoid duplicate SMS.'
  const now = admin.firestore.FieldValue.serverTimestamp()
  await Promise.allSettled([
    item.ref.set({
      status: 'unknown',
      dueDateKey: DISABLED_DATE,
      lastError: message,
      updatedAt: now,
    }, { merge: true }),
    item.eventRef.set({
      status: 'unknown',
      lastError: message,
      updatedAt: now,
    }, { merge: true }),
  ])
  return 'stale'
}

async function claim(item: QueueItem, message: string, phone: string, rates: SmsRateTable): Promise<Claim> {
  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const settingsRef = automationSettingsRef(item.storeId)
  const cost = calculateSmsCredits(phone, message, rates)
  const claimId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  let result: Claim = { ok: false, reason: 'queue-missing' }

  await defaultDb.runTransaction(async tx => {
    const [queueSnapshot, eventSnapshot, storeSnapshot, settingsSnapshot] = await Promise.all([
      tx.get(item.ref),
      tx.get(item.eventRef),
      tx.get(storeRef),
      tx.get(settingsRef),
    ])

    if (!queueSnapshot.exists || !eventSnapshot.exists) {
      result = { ok: false, reason: 'queue-missing' }
      return
    }
    if (!storeSnapshot.exists) {
      result = { ok: false, reason: 'store-not-found' }
      return
    }

    const queue = queueSnapshot.data() as RecordMap
    const queueStatus = norm(queue.status, 'pending')
    if (queueStatus === 'sending' || queueStatus === 'unknown') {
      result = { ok: false, reason: 'in-flight' }
      return
    }

    const retryAt = asDate(queue.nextRetryAt)
    if (queueStatus === 'failed' && retryAt && retryAt.getTime() > Date.now()) {
      result = { ok: false, reason: 'backoff' }
      return
    }

    const eventStatus = norm((eventSnapshot.data() as RecordMap).status, 'pending')
    if (eventStatus === 'sent' || eventStatus === 'delivered') {
      result = { ok: false, reason: 'already-sent' }
      return
    }

    const settings = parseAutomationSettings(settingsSnapshot.data())
    if (!isSmsAutomationEnabledForStage(settings, item.stage as SmsAutomationStage)) {
      result = { ok: false, reason: 'automation-disabled' }
      return
    }

    const storeData = storeSnapshot.data() as RecordMap
    const gateway = resolveStoreSmsGateway(storeData)
    if (!gateway) {
      result = { ok: false, reason: 'sms-not-configured' }
      return
    }

    const balance = typeof storeData.bulkMessagingCredits === 'number' && Number.isFinite(storeData.bulkMessagingCredits)
      ? storeData.bulkMessagingCredits
      : 0
    if (balance < cost.credits) {
      result = { ok: false, reason: 'insufficient-credits' }
      return
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    tx.update(storeRef, {
      bulkMessagingCredits: balance - cost.credits,
      updatedAt: now,
    })
    tx.set(item.ref, {
      status: 'sending',
      claimId,
      phone,
      senderId: gateway.senderId,
      creditsDebited: cost.credits,
      smsSegments: cost.segments,
      rateGroup: cost.group,
      attemptCount: (Number(queue.attemptCount) || 0) + 1,
      lockedAt: admin.firestore.Timestamp.fromDate(new Date()),
      lastAttemptAt: now,
      nextRetryAt: null,
      lastError: null,
      updatedAt: now,
    }, { merge: true })
    tx.set(item.eventRef, {
      status: 'sending',
      claimId,
      lastAttemptAt: now,
      updatedAt: now,
    }, { merge: true })

    result = { ok: true, claimId, credits: cost.credits, gateway }
  })

  return result
}

function problemId(item: QueueItem, kind: ProblemKind) {
  return encodeURIComponent(`${item.bookingId}|${item.stage}|${kind}|${item.eventKey}`)
}

async function recordProblem(item: QueueItem, booking: BookingContext, kind: ProblemKind, reason = '') {
  const label = stageLabel(item.stage)
  const customer = customerName(booking.data) || 'the client'
  const id = problemId(item, kind)
  const now = admin.firestore.FieldValue.serverTimestamp()
  let title = 'Client SMS failed'
  let message = `${label} SMS to ${customer} failed.${reason ? ` ${reason}` : ''}`
  let severity = 'error'

  if (kind === 'insufficient_credits') {
    title = 'SMS not sent - insufficient credits'
    message = `${label} SMS to ${customer} could not be sent because the store does not have enough SMS credits.`
  } else if (kind === 'sender_not_configured') {
    title = 'SMS not sent - sender not configured'
    message = `${label} SMS to ${customer} is blocked because the Hubtel sender is not approved or configured.`
  } else if (kind === 'unknown') {
    title = 'SMS delivery needs review'
    message = `${label} SMS to ${customer} may have been accepted by Hubtel, but Sedifex could not safely confirm finalization.${reason ? ` ${reason}` : ''}`
    severity = 'warning'
  }

  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const notificationRef = storeRef.collection('storeNotifications').doc(id)
  const historyRef = storeRef
    .collection('integrationBookings')
    .doc(item.bookingId)
    .collection('communicationHistory')
    .doc(id)
  const existing = await notificationRef.get()
  const payload = {
    category: 'booking_sms',
    source: 'booking_lifecycle_sms_automation',
    storeId: item.storeId,
    bookingId: item.bookingId,
    stage: item.stage,
    stageLabel: label,
    status: kind === 'unknown' ? 'unknown' : 'failed',
    kind,
    severity,
    title,
    message,
    customerName: customerName(booking.data) || null,
    customerPhone: customerPhone(booking.data) || null,
    serviceName: serviceName(booking.data),
    bookingDate: bookingLifecycleDate(booking.data) || null,
    bookingTime: bookingLifecycleTime(booking.data) || null,
    eventKey: item.eventKey,
    reason: text(reason, 500) || null,
    updatedAt: now,
  }

  await Promise.all([
    notificationRef.set({
      ...payload,
      ...(existing.exists ? {} : { createdAt: now, unread: true, readAt: null }),
    }, { merge: true }),
    historyRef.set({
      ...payload,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true }),
  ])
}

async function runLog(
  item: QueueItem,
  booking: BookingContext,
  message: string,
  phone: string,
  debit: number,
  refund: number,
  status: 'sent' | 'failed',
  error = '',
) {
  try {
    await defaultDb.collection('stores').doc(item.storeId).collection('bulkMessageRuns').add({
      storeId: item.storeId,
      channel: 'sms',
      source: 'booking_lifecycle_automation',
      bookingId: item.bookingId,
      stage: item.stage,
      eventKey: item.eventKey,
      message,
      attempted: 1,
      sent: status === 'sent' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      deliveryStatus: status === 'sent' ? 'all_sent' : 'all_failed',
      creditsDebited: debit,
      creditsRefunded: refund,
      recipients: [{ id: item.bookingId, name: customerName(booking.data) || null, phone }],
      failures: error ? [{ phone, error }] : [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (errorValue) {
    functions.logger.warn('booking lifecycle SMS audit log failed', {
      bookingId: item.bookingId,
      error: errorValue instanceof Error ? errorValue.message : String(errorValue),
    })
  }
}

async function finalizeSuccess(
  item: QueueItem,
  booking: BookingContext,
  claimResult: Extract<Claim, { ok: true }>,
  message: string,
  phone: string,
  provider: unknown,
) {
  const providerData = record(provider)
  const providerMessageId = first([providerData.messageId], 160)
  const now = admin.firestore.FieldValue.serverTimestamp()

  await Promise.all([
    notificationRef(item).set({
      storeId: item.storeId,
      bookingId: item.bookingId,
      stage: item.stage,
      eventKey: item.eventKey,
      appointmentDate: item.eventKey.slice(0, 40),
      status: 'sent',
      phone,
      senderId: claimResult.gateway.senderId,
      creditsDebited: claimResult.credits,
      provider: 'hubtel',
      providerMessageId,
      sentAt: now,
      createdAt: now,
    }, { merge: true }),
    item.eventRef.set({
      status: 'sent',
      phone,
      senderId: claimResult.gateway.senderId,
      creditsDebited: claimResult.credits,
      provider: 'hubtel',
      providerMessageId,
      sentAt: now,
      updatedAt: now,
    }, { merge: true }),
  ])

  await item.ref.delete()
  await runLog(item, booking, message, phone, claimResult.credits, 0, 'sent')
}

async function finalizeFailure(
  item: QueueItem,
  booking: BookingContext,
  claimResult: Extract<Claim, { ok: true }>,
  message: string,
  phone: string,
  error: string,
) {
  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const safeError = error.slice(0, 500)

  await defaultDb.runTransaction(async tx => {
    const queueSnapshot = await tx.get(item.ref)
    if (!queueSnapshot.exists) return
    const queue = queueSnapshot.data() as RecordMap
    if (text(queue.claimId, 200) !== claimResult.claimId || norm(queue.status) !== 'sending') return

    const now = admin.firestore.FieldValue.serverTimestamp()
    tx.update(storeRef, {
      bulkMessagingCredits: admin.firestore.FieldValue.increment(claimResult.credits),
      updatedAt: now,
    })
    tx.set(item.ref, {
      status: 'failed',
      lastError: safeError,
      failedAt: now,
      creditsRefunded: claimResult.credits,
      nextRetryAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + RETRY_MINUTES * 60_000)),
      updatedAt: now,
    }, { merge: true })
    tx.set(item.eventRef, {
      status: 'failed',
      lastError: safeError,
      failedAt: now,
      updatedAt: now,
    }, { merge: true })
  })

  await Promise.allSettled([
    recordProblem(item, booking, 'failed', safeError),
    runLog(item, booking, message, phone, claimResult.credits, claimResult.credits, 'failed', safeError),
  ])
}

async function processQueueDoc(doc: FirebaseFirestore.QueryDocumentSnapshot, rates: SmsRateTable) {
  const item = await readQueueItem(doc)
  if (!item) return 'invalid'

  const sending = await sendingState(item)
  if (sending === 'active') return 'in-flight'
  if (sending === 'stale') {
    const booking = await loadBooking(item)
    if (booking) {
      await recordProblem(item, booking, 'unknown', 'The previous send did not finalize safely.')
    }
    return 'stale-sending'
  }

  const retryAt = asDate(item.data.nextRetryAt)
  if (norm(item.data.status) === 'failed' && retryAt && retryAt.getTime() > Date.now()) return 'backoff'

  const booking = await loadBooking(item)
  if (!booking) {
    await markTerminal(item, 'booking_missing')
    return 'booking-missing'
  }

  const settingsSnapshot = await automationSettingsRef(item.storeId).get()
  const settings = parseAutomationSettings(settingsSnapshot.data())
  if (!isSmsAutomationEnabledForStage(settings, item.stage as SmsAutomationStage)) {
    await markTerminal(item, 'disabled')
    return 'automation-disabled'
  }

  if (!eligible(item, booking)) {
    await markTerminal(item, 'stale')
    return 'stale'
  }

  const phone = formatSmsAddress(customerPhone(booking.data))
  if (!phone) {
    await markTerminal(item, 'stale')
    return 'missing-phone'
  }

  const message = bookingLifecycleSmsMessage(item.stage, booking.data, booking.storeData)
  const claimed = await claim(item, message, phone, rates)
  if (!claimed.ok) {
    if (claimed.reason === 'automation-disabled') {
      await markTerminal(item, 'disabled')
    } else if (claimed.reason === 'already-sent') {
      await item.ref.delete()
    } else if (claimed.reason === 'insufficient-credits') {
      await recordProblem(item, booking, 'insufficient_credits')
    } else if (claimed.reason === 'sms-not-configured') {
      await recordProblem(item, booking, 'sender_not_configured')
    }
    return claimed.reason
  }

  let provider: unknown
  try {
    provider = await sendSmsViaHubtel({ gateway: claimed.gateway, to: phone, body: message })
  } catch (errorValue) {
    const error = errorValue instanceof Error ? errorValue.message : 'booking-lifecycle-sms-send-failed'
    await finalizeFailure(item, booking, claimed, message, phone, error)
    return 'failed'
  }

  try {
    await finalizeSuccess(item, booking, claimed, message, phone, provider)
    return 'sent'
  } catch (errorValue) {
    const error = errorValue instanceof Error ? errorValue.message : 'booking-lifecycle-sms-finalize-failed'
    const note = `Hubtel accepted SMS but finalization failed: ${error}`.slice(0, 500)
    const now = admin.firestore.FieldValue.serverTimestamp()
    await Promise.allSettled([
      item.ref.set({
        status: 'unknown',
        dueDateKey: DISABLED_DATE,
        providerAcceptedAt: now,
        lastError: note,
        updatedAt: now,
      }, { merge: true }),
      item.eventRef.set({
        status: 'unknown',
        providerAcceptedAt: now,
        lastError: note,
        updatedAt: now,
      }, { merge: true }),
      recordProblem(item, booking, 'unknown', note),
    ])
    functions.logger.error('booking lifecycle SMS accepted but finalization failed', {
      storeId: item.storeId,
      bookingId: item.bookingId,
      stage: item.stage,
      error,
    })
    return 'provider-accepted-finalize-error'
  }
}

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

export const processBookingLifecycleSmsNotifications = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const today = dateKey(new Date())
    const snapshot = await defaultDb
      .collection('bookingLifecycleSmsQueue')
      .where('dueDateKey', '<=', today)
      .limit(QUERY_LIMIT)
      .get()
    const rates = await loadSmsRateTable()
    const results: Record<string, number> = {}

    await parallel(snapshot.docs, async doc => {
      try {
        const result = await processQueueDoc(doc, rates)
        results[result] = (results[result] ?? 0) + 1
      } catch (errorValue) {
        results.error = (results.error ?? 0) + 1
        functions.logger.error('booking lifecycle SMS queue item failed', {
          queueId: doc.id,
          error: errorValue instanceof Error ? errorValue.message : String(errorValue),
        })
      }
    })

    functions.logger.info('booking lifecycle SMS automation run complete', {
      queued: snapshot.size,
      today,
      results,
    })
    return null
  })
