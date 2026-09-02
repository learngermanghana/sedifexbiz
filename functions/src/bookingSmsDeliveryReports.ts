import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { resolveStoreSmsGateway, type StoreSmsGatewayConfig } from './smsGateway'

const TIME_ZONE = 'Africa/Accra'
const QUERY_LIMIT = 5
const RETRY_MINUTES = 5
const MAX_CHECKS = 36

type RecordMap = Record<string, unknown>
type FinalStatus = 'delivered' | 'undeliverable' | 'rejected' | 'failed'

type DeliveryQueueItem = {
  storeId: string
  notificationId: string
  bookingId: string
  stage: string
  appointmentDate: string
  providerMessageId: string
  checkCount: number
}

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

function normalizeStatus(value: unknown) {
  return text(value, 100).toLowerCase().replace(/[\s-]+/g, '_')
}

function stageLabel(stage: string) {
  if (stage === 'booking_received') return 'Booking received'
  if (stage === 'booking_confirmed') return 'Booking confirmation'
  if (stage === 'booking_rescheduled') return 'Booking reschedule'
  if (stage === 'booking_cancelled') return 'Booking cancellation'
  if (stage === 'payment_confirmation') return 'Payment confirmation'
  if (stage === 'reminder_3d') return '3-day reminder'
  if (stage === 'reminder_2d') return '2-day reminder'
  if (stage === 'reminder_1d') return '1-day reminder'
  if (stage === 'thank_you') return 'Thank-you'
  return 'Booking SMS'
}

function queueId(storeId: string, notificationId: string) {
  return encodeURIComponent(`${storeId}|${notificationId}`)
}

function legacyStoreAlertId(bookingId: string, stage: string, appointmentDate: string) {
  return encodeURIComponent(`${bookingId}|${stage}|sent|${appointmentDate}`)
}

function isFinalStatus(value: string): value is FinalStatus {
  return ['delivered', 'undeliverable', 'rejected', 'failed'].includes(value)
}

function displayProviderStatus(value: string) {
  if (!value) return 'Unknown'
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

async function queryHubtelStatus(gateway: StoreSmsGatewayConfig, messageId: string) {
  const url = `https://smsc.hubtel.com/v1/messages/${encodeURIComponent(messageId)}`
  const authorization = Buffer.from(`${gateway.clientId}:${gateway.clientSecret}`).toString('base64')
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Basic ${authorization}` },
  })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`Hubtel delivery query ${response.status}: ${responseText || response.statusText || 'Unknown error'}`)
  }
  if (!responseText) throw new Error('Hubtel returned an empty delivery-status response')

  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    throw new Error(`Hubtel returned an invalid delivery-status response: ${responseText.slice(0, 200)}`)
  }

  const root = record(parsed)
  const data = record(root.data)
  const providerMessageId = first([
    data.messageId,
    data.messageID,
    data.MessageId,
    data.MessageID,
    root.messageId,
    root.messageID,
  ], 180)
  const status = normalizeStatus(first([data.status, data.Status, root.status, root.Status], 100))
  if (!status) throw new Error('Hubtel delivery-status response did not include a status')

  return { status, providerMessageId: providerMessageId || messageId }
}

function readQueueItem(data: RecordMap): DeliveryQueueItem | null {
  const storeId = first([data.storeId], 180)
  const notificationId = first([data.notificationId], 500)
  const bookingId = first([data.bookingId], 260)
  const stage = normalizeStatus(data.stage)
  const appointmentDate = first([data.appointmentDate], 40)
  const providerMessageId = first([data.providerMessageId], 180)
  const checkCount = Math.max(0, Math.floor(Number(data.checkCount) || 0))
  if (!storeId || !notificationId || !bookingId || !stage || !providerMessageId) return null
  return { storeId, notificationId, bookingId, stage, appointmentDate, providerMessageId, checkCount }
}

function customerFromAlert(data: RecordMap) {
  return first([data.customerName], 160) || 'the customer'
}

async function updateStoreFacingStatus(args: {
  item: DeliveryQueueItem
  providerStatus: string
  notificationData: RecordMap
  final: boolean
  timedOut?: boolean
}) {
  const { item, providerStatus, notificationData, final, timedOut = false } = args
  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const alertId = legacyStoreAlertId(item.bookingId, item.stage, item.appointmentDate)
  const alertRef = storeRef.collection('storeNotifications').doc(alertId)
  const historyRef = storeRef
    .collection('integrationBookings')
    .doc(item.bookingId)
    .collection('communicationHistory')
    .doc(alertId)
  const alertSnap = await alertRef.get()
  const alertData = alertSnap.exists ? alertSnap.data() as RecordMap : {}
  const label = stageLabel(item.stage)
  const customer = customerFromAlert(alertData)
  const providerLabel = displayProviderStatus(providerStatus)
  const now = admin.firestore.FieldValue.serverTimestamp()

  let patch: RecordMap
  if (providerStatus === 'delivered') {
    patch = {
      kind: 'delivered',
      status: 'delivered',
      providerDeliveryStatus: 'delivered',
      deliveryConfirmed: true,
      severity: 'success',
      title: `${label} SMS delivered`,
      message: `Hubtel confirms that the ${label.toLowerCase()} SMS was delivered to ${customer}’s handset.`,
      deliveredAt: now,
      deliveryCheckedAt: now,
      updatedAt: now,
    }
  } else if (final) {
    patch = {
      kind: providerStatus,
      status: 'failed',
      providerDeliveryStatus: providerStatus,
      deliveryConfirmed: false,
      severity: 'error',
      title: `${label} SMS not delivered`,
      message: `Hubtel reports ${providerLabel} for the ${label.toLowerCase()} SMS to ${customer}. Review the phone number, sender ID and Hubtel SMS report before retrying.`,
      deliveryCheckedAt: now,
      updatedAt: now,
    }
  } else if (timedOut) {
    patch = {
      kind: 'unknown',
      status: 'unknown',
      providerDeliveryStatus: providerStatus || 'unknown',
      deliveryConfirmed: false,
      severity: 'warning',
      title: `${label} SMS delivery not confirmed`,
      message: `Hubtel accepted the ${label.toLowerCase()} SMS to ${customer}, but Sedifex did not receive a final delivery status after repeated checks. Review the message in Hubtel using its provider message ID.`,
      deliveryCheckedAt: now,
      updatedAt: now,
    }
  } else {
    patch = {
      kind: 'accepted',
      status: 'accepted',
      providerDeliveryStatus: providerStatus,
      deliveryConfirmed: false,
      severity: 'info',
      title: `${label} SMS accepted by Hubtel`,
      message: `Hubtel accepted the ${label.toLowerCase()} SMS to ${customer}. Current provider status: ${providerLabel}. Handset delivery has not yet been confirmed.`,
      deliveryCheckedAt: now,
      updatedAt: now,
    }
  }

  const notificationRef = storeRef.collection('bookingSmsNotifications').doc(item.notificationId)
  const notificationPatch: RecordMap = {
    providerDeliveryStatus: providerStatus,
    deliveryConfirmed: providerStatus === 'delivered',
    deliveryCheckedAt: now,
    updatedAt: now,
  }
  if (providerStatus === 'delivered') {
    notificationPatch.status = 'delivered'
    notificationPatch.deliveredAt = now
  } else if (final) {
    notificationPatch.status = providerStatus
  } else if (timedOut) {
    notificationPatch.status = 'unknown'
  }

  await Promise.all([
    notificationRef.set(notificationPatch, { merge: true }),
    alertRef.set({
      ...patch,
      providerMessageId: item.providerMessageId,
      provider: first([notificationData.provider], 60) || 'hubtel',
    }, { merge: true }),
    historyRef.set({
      ...patch,
      providerMessageId: item.providerMessageId,
      provider: first([notificationData.provider], 60) || 'hubtel',
    }, { merge: true }),
  ])
}

export const queueBookingSmsDeliveryCheck = functions.firestore
  .document('stores/{storeId}/bookingSmsNotifications/{notificationId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data() as RecordMap
    if (normalizeStatus(data.status) !== 'sent' || normalizeStatus(data.provider) !== 'hubtel') return null

    const storeId = text(context.params.storeId, 180)
    const notificationId = text(context.params.notificationId, 500)
    const providerMessageId = first([data.providerMessageId], 180)
    const bookingId = first([data.bookingId], 260)
    const stage = normalizeStatus(data.stage)
    if (!storeId || !notificationId || !providerMessageId || !bookingId || !stage) return null

    await defaultDb.collection('bookingSmsDeliveryQueue').doc(queueId(storeId, notificationId)).set({
      storeId,
      notificationId,
      bookingId,
      stage,
      appointmentDate: first([data.appointmentDate], 40) || null,
      provider: 'hubtel',
      providerMessageId,
      status: 'pending',
      checkCount: 0,
      nextCheckAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 60_000)),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    return null
  })

async function processDeliveryQueueDoc(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const raw = doc.data() as RecordMap
  const item = readQueueItem(raw)
  if (!item) {
    await doc.ref.delete()
    return
  }

  const storeRef = defaultDb.collection('stores').doc(item.storeId)
  const notificationRef = storeRef.collection('bookingSmsNotifications').doc(item.notificationId)
  const [storeSnap, notificationSnap] = await Promise.all([storeRef.get(), notificationRef.get()])
  if (!storeSnap.exists || !notificationSnap.exists) {
    await doc.ref.delete()
    return
  }

  const notificationData = notificationSnap.data() as RecordMap
  if (notificationData.deliveryConfirmed === true || normalizeStatus(notificationData.status) === 'delivered') {
    await doc.ref.delete()
    return
  }

  const gateway = resolveStoreSmsGateway(storeSnap.data() as RecordMap)
  if (!gateway) {
    await doc.ref.set({
      lastError: 'Hubtel gateway credentials are unavailable for delivery-status lookup.',
      nextCheckAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 60_000)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    return
  }

  let providerStatus = ''
  try {
    const result = await queryHubtelStatus(gateway, item.providerMessageId)
    providerStatus = result.status
  } catch (error) {
    const checkCount = item.checkCount + 1
    await doc.ref.set({
      checkCount,
      lastError: error instanceof Error ? error.message.slice(0, 500) : 'Hubtel delivery-status lookup failed',
      nextCheckAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + RETRY_MINUTES * 60_000)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    return
  }

  const checkCount = item.checkCount + 1
  const final = isFinalStatus(providerStatus)
  const timedOut = !final && checkCount >= MAX_CHECKS
  await updateStoreFacingStatus({ item, providerStatus, notificationData, final, timedOut })

  if (final || timedOut) {
    await doc.ref.delete()
    return
  }

  await doc.ref.set({
    status: 'pending',
    checkCount,
    lastProviderStatus: providerStatus,
    lastError: null,
    lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
    nextCheckAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + RETRY_MINUTES * 60_000)),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })
}

export const processBookingSmsDeliveryChecks = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    const snapshot = await defaultDb
      .collection('bookingSmsDeliveryQueue')
      .where('nextCheckAt', '<=', admin.firestore.Timestamp.now())
      .limit(QUERY_LIMIT)
      .get()

    const results = { checked: snapshot.size, errors: 0 }
    for (const doc of snapshot.docs) {
      try {
        await processDeliveryQueueDoc(doc)
      } catch (error) {
        results.errors += 1
        functions.logger.error('booking SMS delivery check failed', {
          queueId: doc.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    functions.logger.info('booking SMS delivery checks complete', results)
    return null
  })