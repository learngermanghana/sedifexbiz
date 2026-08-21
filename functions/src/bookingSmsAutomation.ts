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

const TIME_ZONE = 'Africa/Accra'
const REMINDER_START_HOUR = 9
const QUERY_LIMIT = 250
const SEND_CONCURRENCY = 8
const RETRY_MINUTES = 60

type SmsStage =
  | 'payment_confirmation'
  | 'reminder_3d'
  | 'reminder_2d'
  | 'reminder_1d'
  | 'thank_you'

type BookingContext = {
  bookingId: string
  storeId: string
  data: Record<string, unknown>
  storeData: Record<string, unknown>
  rootRef: FirebaseFirestore.DocumentReference
  storeBookingRef: FirebaseFirestore.DocumentReference
}

type ClaimResult =
  | {
      claimed: true
      claimId: string
      credits: number
      gateway: StoreSmsGatewayConfig
      logRef: FirebaseFirestore.DocumentReference
    }
  | {
      claimed: false
      reason:
        | 'already-sent'
        | 'in-flight'
        | 'backoff'
        | 'insufficient-credits'
        | 'sms-not-configured'
        | 'store-not-found'
      logRef: FirebaseFirestore.DocumentReference
    }

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

function normalizeStatus(value: unknown, fallback = '') {
  const normalized = text(value, 100).toLowerCase().replace(/[\s-]+/g, '_')
  return normalized || fallback
}

function dateFromTimestamp(value: unknown): Date | null {
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

function dateKeyInAccra(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function hourInAccra(date: Date) {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return Number.parseInt(hour, 10)
}

function addDaysToDateKey(dateKey: string, days: number) {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function calendarDayDifference(fromDateKey: string, toDateKey: string) {
  const from = Date.parse(`${fromDateKey}T00:00:00.000Z`)
  const to = Date.parse(`${toDateKey}T00:00:00.000Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / (24 * 60 * 60 * 1000))
}

function mergeNested(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  key: string,
) {
  return { ...asRecord(base[key]), ...asRecord(override[key]) }
}

async function loadBookingContext(
  rootDoc: FirebaseFirestore.QueryDocumentSnapshot,
): Promise<BookingContext | null> {
  const rootData = rootDoc.data() as Record<string, unknown>
  const storeId = firstText([rootData.storeId, rootData.store_id], 180)
  if (!storeId) return null

  const storeRef = defaultDb.collection('stores').doc(storeId)
  const storeBookingRef = storeRef.collection('integrationBookings').doc(rootDoc.id)
  const [storeBookingSnap, storeSnap] = await Promise.all([
    storeBookingRef.get(),
    storeRef.get(),
  ])
  if (!storeSnap.exists) return null

  const storeBookingData = storeBookingSnap.exists
    ? (storeBookingSnap.data() as Record<string, unknown>)
    : {}
  const merged: Record<string, unknown> = {
    ...rootData,
    ...storeBookingData,
    customer: mergeNested(rootData, storeBookingData, 'customer'),
    booking: mergeNested(rootData, storeBookingData, 'booking'),
    payment: mergeNested(rootData, storeBookingData, 'payment'),
  }

  return {
    bookingId: rootDoc.id,
    storeId,
    data: merged,
    storeData: storeSnap.data() as Record<string, unknown>,
    rootRef: rootDoc.ref,
    storeBookingRef,
  }
}

function bookingStatus(data: Record<string, unknown>) {
  const booking = asRecord(data.booking)
  return normalizeStatus(
    data.bookingStatus ?? data.booking_status ?? data.status ?? booking.status,
    'pending',
  )
}

function paymentStatus(data: Record<string, unknown>) {
  const payment = asRecord(data.payment)
  return normalizeStatus(
    data.paymentStatus ?? data.payment_status ?? payment.status ?? payment.paymentStatus,
    'pending',
  )
}

function isVerifiedPaid(data: Record<string, unknown>) {
  if (paymentStatus(data) !== 'paid') return false
  const payment = asRecord(data.payment)
  return Boolean(
    dateFromTimestamp(data.paymentVerifiedAt ?? data.payment_verified_at) ||
      dateFromTimestamp(data.paymentConfirmedAt ?? data.payment_confirmed_at) ||
      dateFromTimestamp(payment.verifiedAt ?? payment.verified_at) ||
      dateFromTimestamp(payment.confirmedAt ?? payment.confirmed_at),
  )
}

function customerName(data: Record<string, unknown>) {
  const customer = asRecord(data.customer)
  return firstText(
    [data.customerName, data.customer_name, data.fullName, data.name, customer.name],
    160,
  )
}

function customerPhone(data: Record<string, unknown>) {
  const customer = asRecord(data.customer)
  return firstText(
    [data.customerPhone, data.customer_phone, data.phone, customer.phone],
    80,
  )
}

function serviceName(data: Record<string, unknown>) {
  const booking = asRecord(data.booking)
  return (
    firstText(
      [
        data.serviceName,
        data.service_name,
        data.internalServiceName,
        data.itemName,
        data.productName,
        booking.serviceName,
        booking.service_name,
      ],
      120,
    ) || 'appointment'
  )
}

function bookingDate(data: Record<string, unknown>) {
  const booking = asRecord(data.booking)
  return firstText(
    [
      data.bookingDate,
      data.booking_date,
      data.date,
      booking.preferredDate,
      booking.preferred_date,
      booking.date,
    ],
    40,
  )
}

function bookingTime(data: Record<string, unknown>) {
  const booking = asRecord(data.booking)
  return firstText(
    [
      data.bookingTime,
      data.booking_time,
      data.time,
      booking.preferredTime,
      booking.preferred_time,
      booking.time,
    ],
    40,
  )
}

function branchName(data: Record<string, unknown>) {
  return firstText(
    [
      data.preferredBranch,
      data.branchLocationName,
      data.branchName,
      data.branch,
      data.location,
    ],
    100,
  )
}

function businessName(storeData: Record<string, unknown>) {
  return (
    firstText(
      [storeData.displayName, storeData.storeName, storeData.businessName, storeData.name],
      80,
    ) || 'the business'
  )
}

function firstName(name: string) {
  const value = name.trim().split(/\s+/)[0]
  return value || 'there'
}

function displayDate(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return dateKey
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function displayTime(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const compact = trimmed.replace(/\s+/g, '').toLowerCase()
  const twelveHour = compact.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (twelveHour) {
    const hour = Number.parseInt(twelveHour[1], 10)
    const minute = Number.parseInt(twelveHour[2] ?? '0', 10)
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      return `${hour}:${String(minute).padStart(2, '0')} ${twelveHour[3].toUpperCase()}`
    }
  }

  const twentyFourHour = compact.match(/^(\d{1,2}):(\d{2})$/)
  if (twentyFourHour) {
    const hour = Number.parseInt(twentyFourHour[1], 10)
    const minute = Number.parseInt(twentyFourHour[2], 10)
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const suffix = hour >= 12 ? 'PM' : 'AM'
      const hour12 = hour % 12 || 12
      return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
    }
  }

  return trimmed
}

function appointmentText(data: Record<string, unknown>) {
  const date = bookingDate(data)
  const time = displayTime(bookingTime(data))
  const dateLabel = date ? displayDate(date) : 'your scheduled date'
  return time ? `${dateLabel} at ${time}` : dateLabel
}

function buildMessage(
  stage: SmsStage,
  data: Record<string, unknown>,
  storeData: Record<string, unknown>,
) {
  const customer = firstName(customerName(data))
  const store = businessName(storeData)
  const service = serviceName(data)
  const appointment = appointmentText(data)
  const branch = branchName(data)
  const branchSuffix = branch ? `, ${branch}` : ''

  if (stage === 'payment_confirmation') {
    return `Hi ${customer}, payment received by ${store}. ${service}: ${appointment}${branchSuffix}. Thank you.`
  }
  if (stage === 'reminder_3d') {
    return `Hi ${customer}, reminder from ${store}: your ${service} appointment is in 3 days, ${appointment}${branchSuffix}.`
  }
  if (stage === 'reminder_2d') {
    return `Hi ${customer}, reminder from ${store}: your ${service} appointment is in 2 days, ${appointment}${branchSuffix}.`
  }
  if (stage === 'reminder_1d') {
    return `Hi ${customer}, reminder from ${store}: your ${service} appointment is tomorrow, ${appointment}${branchSuffix}.`
  }
  return `Hi ${customer}, thank you for choosing ${store} for ${service}. We appreciate your business and hope to serve you again.`
}

function stageMarkerFields(stage: SmsStage) {
  const map: Record<SmsStage, [string, string]> = {
    payment_confirmation: [
      'smsPaymentConfirmationSentAt',
      'sms_payment_confirmation_sent_at',
    ],
    reminder_3d: ['smsReminder3dSentAt', 'sms_reminder_3d_sent_at'],
    reminder_2d: ['smsReminder2dSentAt', 'sms_reminder_2d_sent_at'],
    reminder_1d: ['smsReminder1dSentAt', 'sms_reminder_1d_sent_at'],
    thank_you: ['smsThankYouSentAt', 'sms_thank_you_sent_at'],
  }
  return map[stage]
}

function stageAlreadySent(data: Record<string, unknown>, stage: SmsStage) {
  const [camel, snake] = stageMarkerFields(stage)
  return Boolean(data[camel] || data[snake])
}

function stageFromDays(days: number): SmsStage | null {
  if (days === 3) return 'reminder_3d'
  if (days === 2) return 'reminder_2d'
  if (days === 1) return 'reminder_1d'
  return null
}

function providerMessageId(response: unknown) {
  const result = asRecord(response)
  const data = asRecord(result.data)
  return firstText(
    [result.messageId, result.message_id, result.id, data.messageId, data.message_id, data.id],
    160,
  )
}

function notificationLogRef(storeId: string, bookingId: string, stage: SmsStage) {
  return defaultDb
    .collection('stores')
    .doc(storeId)
    .collection('bookingSmsNotifications')
    .doc(`${bookingId}_${stage}`)
}

async function claimNotification(options: {
  context: BookingContext
  stage: SmsStage
  message: string
  phone: string
  rateTable: SmsRateTable
}): Promise<ClaimResult> {
  const { context, stage, message, phone, rateTable } = options
  const storeRef = defaultDb.collection('stores').doc(context.storeId)
  const logRef = notificationLogRef(context.storeId, context.bookingId, stage)
  const claimId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const cost = calculateSmsCredits(phone, message, rateTable)
  const now = new Date()
  let result: ClaimResult = { claimed: false, reason: 'store-not-found', logRef }

  await defaultDb.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
    const [storeSnap, logSnap] = await Promise.all([
      transaction.get(storeRef),
      transaction.get(logRef),
    ])

    if (!storeSnap.exists) {
      result = { claimed: false, reason: 'store-not-found', logRef }
      return
    }

    const storeData = storeSnap.data() as Record<string, unknown>
    const gateway = resolveStoreSmsGateway(storeData)
    if (!gateway) {
      result = { claimed: false, reason: 'sms-not-configured', logRef }
      return
    }

    const logData = logSnap.exists ? (logSnap.data() as Record<string, unknown>) : {}
    const logStatus = normalizeStatus(logData.status)
    if (logStatus === 'sent') {
      result = { claimed: false, reason: 'already-sent', logRef }
      return
    }
    if (logStatus === 'sending') {
      result = { claimed: false, reason: 'in-flight', logRef }
      return
    }

    const nextRetryAt = dateFromTimestamp(logData.nextRetryAt)
    if (logStatus === 'failed' && nextRetryAt && nextRetryAt.getTime() > now.getTime()) {
      result = { claimed: false, reason: 'backoff', logRef }
      return
    }

    const rawCredits = storeData.bulkMessagingCredits
    const currentCredits =
      typeof rawCredits === 'number' && Number.isFinite(rawCredits) ? rawCredits : 0
    if (currentCredits < cost.credits) {
      result = { claimed: false, reason: 'insufficient-credits', logRef }
      return
    }

    const previousAttempts = Number(logData.attemptCount)
    const attemptCount = Number.isFinite(previousAttempts) ? previousAttempts + 1 : 1
    transaction.update(storeRef, {
      bulkMessagingCredits: currentCredits - cost.credits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    transaction.set(
      logRef,
      {
        storeId: context.storeId,
        bookingId: context.bookingId,
        stage,
        status: 'sending',
        claimId,
        phone,
        senderId: gateway.senderId,
        creditsDebited: cost.credits,
        smsSegments: cost.segments,
        rateGroup: cost.group,
        attemptCount,
        lockedAt: admin.firestore.Timestamp.fromDate(now),
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        nextRetryAt: null,
        lastError: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(logSnap.exists
          ? {}
          : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      },
      { merge: true },
    )

    result = {
      claimed: true,
      claimId,
      credits: cost.credits,
      gateway,
      logRef,
    }
  })

  return result
}

function successBookingPatch(
  context: BookingContext,
  stage: SmsStage,
  todayKey: string,
) {
  const [camel, snake] = stageMarkerFields(stage)
  const patch: Record<string, unknown> = {
    [camel]: admin.firestore.FieldValue.serverTimestamp(),
    [snake]: admin.firestore.FieldValue.serverTimestamp(),
    smsLastSentAt: admin.firestore.FieldValue.serverTimestamp(),
    smsLastStage: stage,
    smsLastError: null,
  }

  if (stage === 'payment_confirmation') {
    patch.smsPaymentConfirmationPending = false
    if (bookingStatus(context.data) === 'confirmed') {
      const appointmentDate = bookingDate(context.data)
      const days = appointmentDate
        ? calendarDayDifference(todayKey, appointmentDate)
        : null
      if (days !== null) {
        const dueReminder = stageFromDays(days)
        if (dueReminder) {
          const [reminderCamel, reminderSnake] = stageMarkerFields(dueReminder)
          patch[reminderCamel] = admin.firestore.FieldValue.serverTimestamp()
          patch[reminderSnake] = admin.firestore.FieldValue.serverTimestamp()
        }
      }
    }
  }

  if (stage === 'thank_you') patch.smsThankYouPending = false
  return patch
}

async function mirrorBookingPatch(context: BookingContext, patch: Record<string, unknown>) {
  await Promise.allSettled([
    context.rootRef.set(patch, { merge: true }),
    context.storeBookingRef.set(patch, { merge: true }),
  ])
}

async function writeRunLog(options: {
  context: BookingContext
  stage: SmsStage
  message: string
  phone: string
  creditsDebited: number
  creditsRefunded: number
  status: 'sent' | 'failed'
  error?: string
}) {
  const { context, stage, message, phone, creditsDebited, creditsRefunded, status, error } =
    options
  try {
    await defaultDb
      .collection('stores')
      .doc(context.storeId)
      .collection('bulkMessageRuns')
      .add({
        storeId: context.storeId,
        channel: 'sms',
        source: 'booking_automation',
        bookingId: context.bookingId,
        stage,
        message,
        attempted: 1,
        sent: status === 'sent' ? 1 : 0,
        failed: status === 'failed' ? 1 : 0,
        deliveryStatus: status === 'sent' ? 'all_sent' : 'all_failed',
        creditsDebited,
        creditsRefunded,
        recipients: [{
          id: context.bookingId,
          name: customerName(context.data) || null,
          phone,
        }],
        failures: error ? [{ phone, error }] : [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
  } catch (logError) {
    functions.logger.warn('booking SMS bulkMessageRuns audit write failed', {
      storeId: context.storeId,
      bookingId: context.bookingId,
      stage,
      error: logError instanceof Error ? logError.message : String(logError),
    })
  }
}

async function finalizeSuccess(options: {
  context: BookingContext
  stage: SmsStage
  claim: Extract<ClaimResult, { claimed: true }>
  message: string
  phone: string
  providerResponse: unknown
  todayKey: string
}) {
  const { context, stage, claim, message, phone, providerResponse, todayKey } = options
  await claim.logRef.set(
    {
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      provider: 'hubtel',
      providerMessageId: providerMessageId(providerResponse) || null,
      claimId: claim.claimId,
      nextRetryAt: null,
      lastError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  await mirrorBookingPatch(context, successBookingPatch(context, stage, todayKey))
  await writeRunLog({
    context,
    stage,
    message,
    phone,
    creditsDebited: claim.credits,
    creditsRefunded: 0,
    status: 'sent',
  })
}

async function finalizeFailure(options: {
  context: BookingContext
  stage: SmsStage
  claim: Extract<ClaimResult, { claimed: true }>
  message: string
  phone: string
  error: string
}) {
  const { context, stage, claim, message, phone } = options
  const error = options.error.slice(0, 500)
  const storeRef = defaultDb.collection('stores').doc(context.storeId)
  const nextRetryAt = new Date(Date.now() + RETRY_MINUTES * 60 * 1000)

  await defaultDb.runTransaction(async (transaction: FirebaseFirestore.Transaction) => {
    const logSnap = await transaction.get(claim.logRef)
    if (!logSnap.exists) return
    const logData = logSnap.data() as Record<string, unknown>
    if (text(logData.claimId, 200) !== claim.claimId) return
    if (normalizeStatus(logData.status) !== 'sending') return

    transaction.update(storeRef, {
      bulkMessagingCredits: admin.firestore.FieldValue.increment(claim.credits),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    transaction.set(
      claim.logRef,
      {
        status: 'failed',
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: error,
        creditsRefunded: claim.credits,
        nextRetryAt: admin.firestore.Timestamp.fromDate(nextRetryAt),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  })

  await mirrorBookingPatch(context, {
    smsLastError: error,
    smsLastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  await writeRunLog({
    context,
    stage,
    message,
    phone,
    creditsDebited: claim.credits,
    creditsRefunded: claim.credits,
    status: 'failed',
    error,
  })
}

function candidateEligible(context: BookingContext, stage: SmsStage, todayKey: string) {
  const { data } = context
  const status = bookingStatus(data)
  if (status === 'cancelled' || stageAlreadySent(data, stage)) return false
  if (!customerPhone(data)) return false

  if (stage === 'payment_confirmation') return isVerifiedPaid(data)
  if (stage === 'thank_you') return status === 'completed'
  if (status !== 'confirmed' || !isVerifiedPaid(data)) return false

  const appointmentDate = bookingDate(data)
  if (!appointmentDate) return false
  const days = calendarDayDifference(todayKey, appointmentDate)
  return stageFromDays(days ?? -1) === stage
}

async function processCandidate(
  rootDoc: FirebaseFirestore.QueryDocumentSnapshot,
  stage: SmsStage,
  todayKey: string,
  rateTable: SmsRateTable,
) {
  const context = await loadBookingContext(rootDoc)
  if (!context || !candidateEligible(context, stage, todayKey)) return 'skipped'

  const gateway = resolveStoreSmsGateway(context.storeData)
  if (!gateway) return 'sms-not-configured'

  const phone = formatSmsAddress(customerPhone(context.data))
  if (!phone) return 'missing-phone'
  const message = buildMessage(stage, context.data, context.storeData)
  const claim = await claimNotification({ context, stage, message, phone, rateTable })

  if (!claim.claimed) {
    if (claim.reason === 'already-sent') {
      await mirrorBookingPatch(context, successBookingPatch(context, stage, todayKey))
    }
    return claim.reason
  }

  try {
    const providerResponse = await sendSmsViaHubtel({
      gateway: claim.gateway,
      to: phone,
      body: message,
    })
    await finalizeSuccess({
      context,
      stage,
      claim,
      message,
      phone,
      providerResponse,
      todayKey,
    })
    return 'sent'
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'booking-sms-send-failed'
    await finalizeFailure({
      context,
      stage,
      claim,
      message,
      phone,
      error: messageText,
    })
    return 'failed'
  }
}

async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      await worker(items[currentIndex])
    }
  })
  await Promise.all(runners)
}

type Candidate = { doc: FirebaseFirestore.QueryDocumentSnapshot; stage: SmsStage }

function addCandidates(
  target: Map<string, Candidate>,
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  stage: SmsStage,
) {
  docs.forEach(doc => target.set(`${doc.id}:${stage}`, { doc, stage }))
}

export const processBookingSmsNotifications = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const now = new Date()
    const todayKey = dateKeyInAccra(now)
    const bookings = defaultDb.collection('integrationBookings')
    const recentPaymentCutoff = admin.firestore.Timestamp.fromDate(
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    )
    const recentCompletionCutoff = admin.firestore.Timestamp.fromDate(
      new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    )

    const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = [
      bookings.where('smsPaymentConfirmationPending', '==', true).limit(QUERY_LIMIT).get(),
      bookings.where('smsThankYouPending', '==', true).limit(QUERY_LIMIT).get(),
      bookings.where('paymentConfirmedAt', '>=', recentPaymentCutoff).limit(QUERY_LIMIT).get(),
      bookings.where('completedAt', '>=', recentCompletionCutoff).limit(QUERY_LIMIT).get(),
    ]

    const shouldProcessReminders = hourInAccra(now) >= REMINDER_START_HOUR
    if (shouldProcessReminders) {
      const reminderDates = [1, 2, 3].map(days => addDaysToDateKey(todayKey, days))
      queries.push(
        bookings.where('bookingDate', 'in', reminderDates).limit(QUERY_LIMIT).get(),
      )
    }

    const snapshots = await Promise.all(queries)
    const candidates = new Map<string, Candidate>()
    addCandidates(candidates, snapshots[0].docs, 'payment_confirmation')
    addCandidates(candidates, snapshots[1].docs, 'thank_you')
    addCandidates(candidates, snapshots[2].docs, 'payment_confirmation')
    addCandidates(candidates, snapshots[3].docs, 'thank_you')

    if (shouldProcessReminders) {
      snapshots[4].docs.forEach(doc => {
        const data = doc.data() as Record<string, unknown>
        const date = bookingDate(data)
        const days = date ? calendarDayDifference(todayKey, date) : null
        const stage = days === null ? null : stageFromDays(days)
        if (stage) candidates.set(`${doc.id}:${stage}`, { doc, stage })
      })
    }

    const rateTable = await loadSmsRateTable()
    const results: Record<string, number> = {}
    await withConcurrency(Array.from(candidates.values()), SEND_CONCURRENCY, async candidate => {
      try {
        const result = await processCandidate(
          candidate.doc,
          candidate.stage,
          todayKey,
          rateTable,
        )
        results[result] = (results[result] ?? 0) + 1
      } catch (error) {
        results.error = (results.error ?? 0) + 1
        functions.logger.error('booking SMS candidate processing failed', {
          bookingId: candidate.doc.id,
          stage: candidate.stage,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    functions.logger.info('booking SMS automation run complete', {
      candidates: candidates.size,
      todayKey,
      shouldProcessReminders,
      results,
    })
    return null
  })
