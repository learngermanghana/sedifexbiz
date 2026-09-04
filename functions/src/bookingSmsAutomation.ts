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
  loadAutomationSettings,
  parseAutomationSettings,
  type AutomationSettings,
} from './automationSettings'

const TIME_ZONE = 'Africa/Accra'
const REMINDER_HOUR = 9
const QUERY_LIMIT = 250
const CONCURRENCY = 8
const RETRY_MINUTES = 60
const STALE_MINUTES = 30
const DISABLED_DATE = '9999-12-31'

type Stage = 'payment_confirmation' | 'reminder_3d' | 'reminder_2d' | 'reminder_1d' | 'thank_you'
type RecordMap = Record<string, unknown>
type QueueItem = {
  id: string
  ref: FirebaseFirestore.DocumentReference
  storeId: string
  bookingId: string
  stage: Stage
  appointmentDate: string
  data: RecordMap
}
type BookingCtx = {
  ref: FirebaseFirestore.DocumentReference
  data: RecordMap
  storeData: RecordMap
}
type Claim =
  | { ok: true; claimId: string; credits: number; gateway: StoreSmsGatewayConfig }
  | { ok: false; reason: string }

const stages: Stage[] = ['payment_confirmation', 'reminder_3d', 'reminder_2d', 'reminder_1d', 'thank_you']

function txt(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
function rec(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}
function first(values: unknown[], max = 500) {
  for (const value of values) {
    const candidate = txt(value, max)
    if (candidate) return candidate
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}
function norm(value: unknown, fallback = '') {
  return txt(value, 100).toLowerCase().replace(/[\s-]+/g, '_') || fallback
}
function asDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'object') {
    const v = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof v.toDate === 'function') return v.toDate()
    const seconds = typeof v.seconds === 'number' ? v.seconds : typeof v._seconds === 'number' ? v._seconds : null
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
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const v = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${v.year}-${v.month}-${v.day}`
}
function localHour(date: Date) {
  return Number.parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23',
  }).format(date), 10)
}
function shiftDate(key: string, days: number) {
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
function dayDiff(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00.000Z`)
  const b = Date.parse(`${to}T00:00:00.000Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null
}

function bookingStatus(data: RecordMap) {
  const booking = rec(data.booking)
  return norm(data.bookingStatus ?? data.booking_status ?? data.status ?? booking.status, 'pending')
}
function reminderActiveStatus(status: string) {
  return status === 'confirmed' || status === 'rescheduled'
}
function paymentStatus(data: RecordMap) {
  const payment = rec(data.payment)
  return norm(data.paymentStatus ?? data.payment_status ?? payment.status ?? payment.paymentStatus, 'pending')
}
function verifiedPaid(data: RecordMap) {
  if (paymentStatus(data) !== 'paid') return false
  const payment = rec(data.payment)
  return Boolean(
    asDate(data.paymentVerifiedAt ?? data.payment_verified_at) ||
    asDate(data.paymentConfirmedAt ?? data.payment_confirmed_at) ||
    asDate(payment.verifiedAt ?? payment.verified_at) ||
    asDate(payment.confirmedAt ?? payment.confirmed_at),
  )
}
function bookingDate(data: RecordMap) {
  const booking = rec(data.booking)
  return first([data.bookingDate, data.booking_date, data.date, booking.preferredDate, booking.preferred_date, booking.date], 40)
}
function bookingTime(data: RecordMap) {
  const booking = rec(data.booking)
  return first([data.bookingTime, data.booking_time, data.time, booking.preferredTime, booking.preferred_time, booking.time], 40)
}
function customerName(data: RecordMap) {
  const customer = rec(data.customer)
  return first([data.customerName, data.customer_name, data.fullName, data.name, customer.name], 160)
}
function customerPhone(data: RecordMap) {
  const customer = rec(data.customer)
  return first([data.customerPhone, data.customer_phone, data.phone, customer.phone], 80)
}
function serviceName(data: RecordMap) {
  const booking = rec(data.booking)
  return first([data.serviceName, data.service_name, data.internalServiceName, data.itemName, data.productName, booking.serviceName], 120) || 'appointment'
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
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}
function displayTime(raw: string) {
  const value = raw.trim().replace(/\s+/g, '').toLowerCase()
  const ap = value.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (ap) return `${Number(ap[1])}:${String(Number(ap[2] ?? 0)).padStart(2, '0')} ${ap[3].toUpperCase()}`
  const hm = value.match(/^(\d{1,2}):(\d{2})$/)
  if (hm) {
    const h = Number(hm[1]); const m = Number(hm[2])
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }
  return raw.trim()
}
function appointment(data: RecordMap) {
  const date = bookingDate(data)
  const time = displayTime(bookingTime(data))
  const label = date ? displayDate(date) : 'your scheduled date'
  return time ? `${label} at ${time}` : label
}
function messageFor(stage: Stage, booking: RecordMap, store: RecordMap) {
  const name = customerName(booking).split(/\s+/)[0] || 'there'
  const business = storeName(store)
  const service = serviceName(booking)
  const where = branchName(booking)
  const suffix = where ? `, ${where}` : ''
  if (stage === 'payment_confirmation') return `Hi ${name}, payment received by ${business}. ${service}: ${appointment(booking)}${suffix}. Thank you.`
  if (stage === 'reminder_3d') return `Hi ${name}, reminder from ${business}: your ${service} appointment is in 3 days, ${appointment(booking)}${suffix}.`
  if (stage === 'reminder_2d') return `Hi ${name}, reminder from ${business}: your ${service} appointment is in 2 days, ${appointment(booking)}${suffix}.`
  if (stage === 'reminder_1d') return `Hi ${name}, reminder from ${business}: your ${service} appointment is tomorrow, ${appointment(booking)}${suffix}.`
  return `Hi ${name}, thank you for choosing ${business} for ${service}. We appreciate your business and hope to serve you again.`
}

function marker(stage: Stage): [string, string] {
  if (stage === 'payment_confirmation') return ['smsPaymentConfirmationSentAt', 'sms_payment_confirmation_sent_at']
  if (stage === 'reminder_3d') return ['smsReminder3dSentAt', 'sms_reminder_3d_sent_at']
  if (stage === 'reminder_2d') return ['smsReminder2dSentAt', 'sms_reminder_2d_sent_at']
  if (stage === 'reminder_1d') return ['smsReminder1dSentAt', 'sms_reminder_1d_sent_at']
  return ['smsThankYouSentAt', 'sms_thank_you_sent_at']
}
function sent(data: RecordMap, stage: Stage) {
  const [a, b] = marker(stage)
  return Boolean(data[a] || data[b])
}
function reminderDays(stage: Stage) {
  return stage === 'reminder_3d' ? 3 : stage === 'reminder_2d' ? 2 : stage === 'reminder_1d' ? 1 : null
}
function queueId(storeId: string, bookingId: string, stage: Stage, appt = '') {
  return encodeURIComponent(`${storeId}|${bookingId}|${stage}|${appt}`)
}
function queueRef(storeId: string, bookingId: string, stage: Stage, appt = '') {
  return defaultDb.collection('bookingSmsQueue').doc(queueId(storeId, bookingId, stage, appt))
}
function queueData(storeId: string, bookingId: string, stage: Stage, dueDateKey: string, appt = '') {
  return { storeId, bookingId, stage, dueDateKey, appointmentDate: appt || null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
}
async function deleteReminderQueues(storeId: string, bookingId: string, appt: string) {
  if (!appt) return
  await Promise.all((['reminder_3d', 'reminder_2d', 'reminder_1d'] as Stage[]).map(stage => queueRef(storeId, bookingId, stage, appt).delete()))
}
function resetReminderFields() {
  return {
    smsReminder3dSentAt: admin.firestore.FieldValue.delete(), sms_reminder_3d_sent_at: admin.firestore.FieldValue.delete(),
    smsReminder2dSentAt: admin.firestore.FieldValue.delete(), sms_reminder_2d_sent_at: admin.firestore.FieldValue.delete(),
    smsReminder1dSentAt: admin.firestore.FieldValue.delete(), sms_reminder_1d_sent_at: admin.firestore.FieldValue.delete(),
  }
}
function withoutReminderMarkers(data: RecordMap) {
  const copy = { ...data }
  Object.keys(resetReminderFields()).forEach(key => delete copy[key])
  return copy
}

async function syncQueues(storeId: string, bookingId: string, before: RecordMap, after: RecordMap) {
  const today = dateKey(new Date())
  const status = bookingStatus(after)
  const paid = verifiedPaid(after)
  const current = bookingDate(after)
  const previous = bookingDate(before)
  const automation = await loadAutomationSettings(storeId)
  const enabled = (stage: Stage) => isSmsAutomationEnabledForStage(automation, stage)
  const ops: Promise<unknown>[] = []
  const payment = queueRef(storeId, bookingId, 'payment_confirmation')
  const thanks = queueRef(storeId, bookingId, 'thank_you')

  ops.push(enabled('payment_confirmation') && paid && status !== 'cancelled' && !sent(after, 'payment_confirmation')
    ? payment.set(queueData(storeId, bookingId, 'payment_confirmation', today), { merge: true })
    : payment.delete())
  ops.push(enabled('thank_you') && status === 'completed' && !sent(after, 'thank_you')
    ? thanks.set(queueData(storeId, bookingId, 'thank_you', today), { merge: true })
    : thanks.delete())

  if (previous && previous !== current) ops.push(deleteReminderQueues(storeId, bookingId, previous))
  if (reminderActiveStatus(status) && paid && current) {
    for (const [stage, days] of [['reminder_3d', 3], ['reminder_2d', 2], ['reminder_1d', 1]] as [Stage, number][]) {
      const due = shiftDate(current, -days)
      const ref = queueRef(storeId, bookingId, stage, current)
      ops.push(enabled(stage) && due && due >= today && !sent(after, stage)
        ? ref.set(queueData(storeId, bookingId, stage, due, current), { merge: true })
        : ref.delete())
    }
  } else if (current) {
    ops.push(deleteReminderQueues(storeId, bookingId, current))
  }
  await Promise.all(ops)
}

export const queueBookingSmsOnWrite = functions.firestore
  .document('stores/{storeId}/integrationBookings/{bookingId}')
  .onWrite(async (change, context) => {
    const storeId = txt(context.params.storeId, 180)
    const bookingId = txt(context.params.bookingId, 260)
    if (!storeId || !bookingId) return null
    if (!change.after.exists) {
      const before = (change.before.data() ?? {}) as RecordMap
      await Promise.all([
        queueRef(storeId, bookingId, 'payment_confirmation').delete(),
        queueRef(storeId, bookingId, 'thank_you').delete(),
        deleteReminderQueues(storeId, bookingId, bookingDate(before)),
      ])
      return null
    }
    const before = change.before.exists ? change.before.data() as RecordMap : {}
    const after = change.after.data() as RecordMap
    const oldDate = bookingDate(before)
    const newDate = bookingDate(after)
    const forQueue = oldDate && oldDate !== newDate ? withoutReminderMarkers(after) : after
    if (oldDate && oldDate !== newDate) await change.after.ref.set(resetReminderFields(), { merge: true })
    await syncQueues(storeId, bookingId, before, forQueue)
    return null
  })

async function loadItem(doc: FirebaseFirestore.QueryDocumentSnapshot): Promise<QueueItem | null> {
  const data = doc.data() as RecordMap
  const storeId = first([data.storeId], 180)
  const bookingId = first([data.bookingId], 260)
  const stage = norm(data.stage) as Stage
  if (!storeId || !bookingId || !stages.includes(stage)) { await doc.ref.delete(); return null }
  return { id: doc.id, ref: doc.ref, storeId, bookingId, stage, appointmentDate: first([data.appointmentDate], 40), data }
}
async function loadBooking(item: QueueItem): Promise<BookingCtx | null> {
  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const ref = storeRef.collection('integrationBookings').doc(item.bookingId)
  const [store, booking] = await Promise.all([storeRef.get(), ref.get()])
  if (!store.exists || !booking.exists) return null
  return { ref, data: booking.data() as RecordMap, storeData: store.data() as RecordMap }
}
function eligible(item: QueueItem, booking: BookingCtx, today: string) {
  const status = bookingStatus(booking.data)
  if (status === 'cancelled' || sent(booking.data, item.stage) || !customerPhone(booking.data)) return false
  if (item.stage === 'payment_confirmation') return verifiedPaid(booking.data)
  if (item.stage === 'thank_you') return status === 'completed'
  const days = reminderDays(item.stage)
  const current = bookingDate(booking.data)
  return reminderActiveStatus(status) && verifiedPaid(booking.data) && Boolean(days && current && current === item.appointmentDate && dayDiff(today, current) === days)
}
async function staleSending(item: QueueItem) {
  if (norm(item.data.status) !== 'sending') return false
  const locked = asDate(item.data.lockedAt)
  if (locked && Date.now() - locked.getTime() < STALE_MINUTES * 60000) return true
  await item.ref.set({
    status: 'unknown', dueDateKey: DISABLED_DATE,
    lastError: 'Previous Hubtel send did not finalize. Automatic resend blocked to avoid duplicate SMS.',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
  return true
}
async function claim(item: QueueItem, message: string, phone: string, rates: SmsRateTable): Promise<Claim> {
  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const settingsRef = automationSettingsRef(item.storeId)
  const cost = calculateSmsCredits(phone, message, rates)
  const claimId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  let result: Claim = { ok: false, reason: 'queue-missing' }
  await defaultDb.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const [queue, store, automationSnapshot] = await Promise.all([tx.get(item.ref), tx.get(storeRef), tx.get(settingsRef)])
    if (!queue.exists) { result = { ok: false, reason: 'queue-missing' }; return }
    if (!store.exists) { result = { ok: false, reason: 'store-not-found' }; return }
    const q = queue.data() as RecordMap
    const qStatus = norm(q.status, 'pending')
    if (qStatus === 'sending' || qStatus === 'unknown') { result = { ok: false, reason: 'in-flight' }; return }
    const automation = parseAutomationSettings(automationSnapshot.data())
    if (!isSmsAutomationEnabledForStage(automation, item.stage)) { result = { ok: false, reason: 'automation-disabled' }; return }
    const retry = asDate(q.nextRetryAt)
    if (qStatus === 'failed' && retry && retry.getTime() > Date.now()) { result = { ok: false, reason: 'backoff' }; return }
    const storeData = store.data() as RecordMap
    const gateway = resolveStoreSmsGateway(storeData)
    if (!gateway) { result = { ok: false, reason: 'sms-not-configured' }; return }
    const balance = typeof storeData.bulkMessagingCredits === 'number' && Number.isFinite(storeData.bulkMessagingCredits) ? storeData.bulkMessagingCredits : 0
    if (balance < cost.credits) { result = { ok: false, reason: 'insufficient-credits' }; return }
    tx.update(storeRef, { bulkMessagingCredits: balance - cost.credits, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
    tx.set(item.ref, {
      status: 'sending', claimId, phone, senderId: gateway.senderId, creditsDebited: cost.credits,
      smsSegments: cost.segments, rateGroup: cost.group,
      attemptCount: (Number(q.attemptCount) || 0) + 1,
      lockedAt: admin.firestore.Timestamp.fromDate(new Date()), lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      nextRetryAt: null, lastError: null, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    result = { ok: true, claimId, credits: cost.credits, gateway }
  })
  return result
}
function successPatch(item: QueueItem, booking: BookingCtx, today: string) {
  const [a, b] = marker(item.stage)
  const patch: RecordMap = {
    [a]: admin.firestore.FieldValue.serverTimestamp(), [b]: admin.firestore.FieldValue.serverTimestamp(),
    smsLastSentAt: admin.firestore.FieldValue.serverTimestamp(), smsLastStage: item.stage, smsLastError: null,
  }
  if (item.stage === 'payment_confirmation') {
    patch.smsPaymentConfirmationPending = false
    const date = bookingDate(booking.data)
    const days = date ? dayDiff(today, date) : null
    if (reminderActiveStatus(bookingStatus(booking.data)) && days && [1, 2, 3].includes(days)) {
      const [x, y] = marker(`reminder_${days}d` as Stage)
      patch[x] = admin.firestore.FieldValue.serverTimestamp(); patch[y] = admin.firestore.FieldValue.serverTimestamp()
    }
  }
  if (item.stage === 'thank_you') patch.smsThankYouPending = false
  return patch
}
async function runLog(item: QueueItem, booking: BookingCtx, message: string, phone: string, debit: number, refund: number, status: 'sent' | 'failed', error = '') {
  try {
    await defaultDb.collection('stores').doc(item.storeId).collection('bulkMessageRuns').add({
      storeId: item.storeId, channel: 'sms', source: 'booking_automation', bookingId: item.bookingId, stage: item.stage,
      message, attempted: 1, sent: status === 'sent' ? 1 : 0, failed: status === 'failed' ? 1 : 0,
      deliveryStatus: status === 'sent' ? 'all_sent' : 'all_failed', creditsDebited: debit, creditsRefunded: refund,
      recipients: [{ id: item.bookingId, name: customerName(booking.data) || null, phone }],
      failures: error ? [{ phone, error }] : [], createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (e) { functions.logger.warn('booking SMS audit log failed', { bookingId: item.bookingId, error: e instanceof Error ? e.message : String(e) }) }
}
async function finalizeSuccess(item: QueueItem, booking: BookingCtx, claimResult: Extract<Claim, { ok: true }>, message: string, phone: string, provider: unknown, today: string) {
  const notification = defaultDb.collection('stores').doc(item.storeId).collection('bookingSmsNotifications').doc(item.id)
  const providerData = rec(provider)
  await Promise.all([
    notification.set({
      storeId: item.storeId, bookingId: item.bookingId, stage: item.stage, appointmentDate: item.appointmentDate || null,
      status: 'sent', phone, senderId: claimResult.gateway.senderId, creditsDebited: claimResult.credits, provider: 'hubtel',
      providerMessageId: first([providerData.messageId], 160),
      sentAt: admin.firestore.FieldValue.serverTimestamp(), createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }),
    booking.ref.set(successPatch(item, booking, today), { merge: true }),
  ])
  if (item.stage === 'payment_confirmation') {
    const date = bookingDate(booking.data); const days = date ? dayDiff(today, date) : null
    if (reminderActiveStatus(bookingStatus(booking.data)) && days && [1, 2, 3].includes(days)) await queueRef(item.storeId, item.bookingId, `reminder_${days}d` as Stage, date).delete()
  }
  await item.ref.delete()
  await runLog(item, booking, message, phone, claimResult.credits, 0, 'sent')
}
async function finalizeFailure(item: QueueItem, booking: BookingCtx, claimResult: Extract<Claim, { ok: true }>, message: string, phone: string, error: string) {
  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const safeError = error.slice(0, 500)
  await defaultDb.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const queue = await tx.get(item.ref)
    if (!queue.exists) return
    const q = queue.data() as RecordMap
    if (txt(q.claimId, 200) !== claimResult.claimId || norm(q.status) !== 'sending') return
    tx.update(storeRef, { bulkMessagingCredits: admin.firestore.FieldValue.increment(claimResult.credits), updatedAt: admin.firestore.FieldValue.serverTimestamp() })
    tx.set(item.ref, {
      status: 'failed', lastError: safeError, failedAt: admin.firestore.FieldValue.serverTimestamp(), creditsRefunded: claimResult.credits,
      nextRetryAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + RETRY_MINUTES * 60000)), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
  })
  await booking.ref.set({ smsLastError: safeError, smsLastAttemptAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  await runLog(item, booking, message, phone, claimResult.credits, claimResult.credits, 'failed', safeError)
}
async function processDoc(doc: FirebaseFirestore.QueryDocumentSnapshot, today: string, hour: number, rates: SmsRateTable) {
  const item = await loadItem(doc)
  if (!item) return 'invalid'
  if (norm(item.data.status) !== 'sending') {
    const automation = await loadAutomationSettings(item.storeId)
    if (!isSmsAutomationEnabledForStage(automation, item.stage)) {
      await item.ref.delete()
      return 'automation-disabled'
    }
  }
  if (await staleSending(item)) return 'in-flight'
  const retry = asDate(item.data.nextRetryAt)
  if (norm(item.data.status) === 'failed' && retry && retry.getTime() > Date.now()) return 'backoff'
  if (reminderDays(item.stage) && hour < REMINDER_HOUR) return 'waiting-for-9am'
  const booking = await loadBooking(item)
  if (!booking) { await item.ref.delete(); return 'booking-missing' }
  if (!eligible(item, booking, today)) { await item.ref.delete(); return 'stale' }
  const phone = formatSmsAddress(customerPhone(booking.data))
  if (!phone) { await item.ref.delete(); return 'missing-phone' }
  if (!resolveStoreSmsGateway(booking.storeData)) return 'sms-not-configured'
  const message = messageFor(item.stage, booking.data, booking.storeData)
  const claimed = await claim(item, message, phone, rates)
  if (!claimed.ok) {
    if (claimed.reason === 'automation-disabled') await item.ref.delete()
    return claimed.reason
  }
  let provider: unknown
  try { provider = await sendSmsViaHubtel({ gateway: claimed.gateway, to: phone, body: message }) }
  catch (e) { await finalizeFailure(item, booking, claimed, message, phone, e instanceof Error ? e.message : 'booking-sms-send-failed'); return 'failed' }
  try { await finalizeSuccess(item, booking, claimed, message, phone, provider, today); return 'sent' }
  catch (e) {
    const error = e instanceof Error ? e.message : 'booking-sms-finalize-failed'
    const note = `Hubtel accepted SMS but finalization failed: ${error}`.slice(0, 500)
    await Promise.allSettled([
      item.ref.set({ status: 'unknown', dueDateKey: DISABLED_DATE, providerAcceptedAt: admin.firestore.FieldValue.serverTimestamp(), lastError: note, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
      booking.ref.set({ smsLastError: note, smsLastAttemptAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
    ])
    functions.logger.error('booking SMS accepted but finalization failed', { storeId: item.storeId, bookingId: item.bookingId, stage: item.stage, error })
    return 'provider-accepted-finalize-error'
  }
}
async function parallel<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; await worker(items[index]) }
  })
  await Promise.all(runners)
}
async function discoverExistingReminders(today: string) {
  const dates = [1, 2, 3].map(days => shiftDate(today, days))
  const roots = await defaultDb.collection('integrationBookings').where('bookingDate', 'in', dates).limit(QUERY_LIMIT).get()
  const settingsCache = new Map<string, Promise<AutomationSettings>>()
  const settingsFor = (storeId: string) => {
    const existing = settingsCache.get(storeId)
    if (existing) return existing
    const loading = loadAutomationSettings(storeId)
    settingsCache.set(storeId, loading)
    return loading
  }
  await parallel(roots.docs, async root => {
    const rootData = root.data() as RecordMap
    const storeId = first([rootData.storeId, rootData.store_id], 180)
    if (!storeId) return
    const ref = defaultDb.collection('stores').doc(storeId).collection('integrationBookings').doc(root.id)
    const snap = await ref.get()
    if (!snap.exists) return
    const data = snap.data() as RecordMap
    const date = bookingDate(data); const days = date ? dayDiff(today, date) : null
    if (!reminderActiveStatus(bookingStatus(data)) || !verifiedPaid(data) || !days || ![1, 2, 3].includes(days)) return
    const stage = `reminder_${days}d` as Stage
    const automation = await settingsFor(storeId)
    if (!isSmsAutomationEnabledForStage(automation, stage) || sent(data, stage)) return
    await queueRef(storeId, root.id, stage, date).set(queueData(storeId, root.id, stage, today, date), { merge: true })
  })
}

export const processBookingSmsNotifications = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const now = new Date(); const today = dateKey(now); const hour = localHour(now)
    await discoverExistingReminders(today)
    const snapshot = await defaultDb.collection('bookingSmsQueue').where('dueDateKey', '<=', today).limit(QUERY_LIMIT).get()
    const rates = await loadSmsRateTable()
    const results: Record<string, number> = {}
    await parallel(snapshot.docs, async doc => {
      try { const result = await processDoc(doc, today, hour, rates); results[result] = (results[result] ?? 0) + 1 }
      catch (e) { results.error = (results.error ?? 0) + 1; functions.logger.error('booking SMS queue item failed', { queueId: doc.id, error: e instanceof Error ? e.message : String(e) }) }
    })
    functions.logger.info('booking SMS automation run complete', { queued: snapshot.size, today, results })
    return null
  })