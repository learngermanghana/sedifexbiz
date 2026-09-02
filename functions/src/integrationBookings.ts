import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { admin, defaultDb } from './firestore'

const INTEGRATION_CONTRACT_VERSION = defineString('INTEGRATION_CONTRACT_VERSION', {
  default: '2026-04-13',
})
const SEDIFEX_INTEGRATION_API_KEY = defineString('SEDIFEX_INTEGRATION_API_KEY', { default: '' })

type BookingRequestBody = {
  serviceId?: unknown
  service_id?: unknown
  slotId?: unknown
  customer?: unknown
  quantity?: unknown
  notes?: unknown
  bookingDate?: unknown
  bookingTime?: unknown
  branchLocationId?: unknown
  branchLocationName?: unknown
  preferredBranch?: unknown
  paymentMethod?: unknown
  paymentAmount?: unknown
  paymentStatus?: unknown
  payment_status?: unknown
  paymentCollectionMode?: unknown
  paymentOption?: unknown
  depositAmount?: unknown
  amountOutstanding?: unknown
  serviceName?: unknown
  attributes?: unknown
  status?: unknown
  source?: unknown
  sourceChannel?: unknown
  source_channel?: unknown
}

function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}


function normalizeServiceId(rawValue: unknown) {
  const value = clean(rawValue, 220)
  if (!value) return ''
  return value.toLowerCase().startsWith('draft-') ? value.slice(6).trim() : value
}

function setCors(res: functions.Response) {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-sedifex-api-key, api-key, X-Sedifex-Contract-Version')
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function assertContract(req: functions.https.Request, res: functions.Response) {
  const expected = INTEGRATION_CONTRACT_VERSION.value() || '2026-04-13'
  const received = clean(req.get('x-sedifex-contract-version'), 80)
  res.set('x-sedifex-contract-version', expected)
  res.set('x-sedifex-request-id', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  if (received && received !== expected) {
    res.status(400).json({ error: 'contract-version-mismatch', expectedVersion: expected, receivedVersion: received })
    return false
  }
  return true
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function queryHasMatch(collectionPath: FirebaseFirestore.CollectionReference, field: string, apiKey: string) {
  const snapshot = await collectionPath.where(field, '==', apiKey).limit(1).get()
  return !snapshot.empty
}


async function queryStoreSettingsByStoreId(storeId: string) {
  const snapshot = await defaultDb.collection('storeSettings').where('storeId', '==', storeId).limit(5).get()
  return snapshot.docs
}

function recordContainsKey(record: Record<string, unknown>, apiKey: string) {
  const candidates = [record.integrationApiKey, record.integrationKey, record.integrationToken, record.apiKey, record.token, record.key]
  return candidates.some(value => clean(value, 1000) === apiKey)
}

function resolveRequestApiKey(req: functions.https.Request) {
  const bearer = clean(req.get('authorization'), 1000).replace(/^Bearer\s+/i, '')
  return (
    clean(req.get('x-api-key'), 1000)
    || clean(req.get('x-sedifex-api-key'), 1000)
    || clean(req.get('api-key'), 1000)
    || clean(req.query.apiKey, 1000)
    || clean(req.query.api_key, 1000)
    || bearer
  )
}

async function isAuthorized(req: functions.https.Request, storeId: string) {
  const apiKey = resolveRequestApiKey(req)
  if (!apiKey) return false

  const master = SEDIFEX_INTEGRATION_API_KEY.value()?.trim() || process.env.SEDIFEX_INTEGRATION_API_KEY?.trim() || ''
  if (master && apiKey === master) return true

  try {
    const storeSnap = await defaultDb.collection('stores').doc(storeId).get()
    const storeData = (storeSnap.data() ?? {}) as Record<string, unknown>
    if (recordContainsKey(storeData, apiKey)) return true

    const settingsSnap = await defaultDb.collection('storeSettings').doc(storeId).get()
    const settingsData = (settingsSnap.data() ?? {}) as Record<string, unknown>
    if (recordContainsKey(settingsData, apiKey)) return true

    const matchingSettingsDocs = await queryStoreSettingsByStoreId(storeId)
    for (const settingsDoc of matchingSettingsDocs) {
      const data = (settingsDoc.data() ?? {}) as Record<string, unknown>
      if (recordContainsKey(data, apiKey)) return true
      const nestedCollection = defaultDb.collection('storeSettings').doc(settingsDoc.id).collection('integrationApiKeys')
      for (const field of ['token', 'key', 'apiKey', 'value']) {
        if (await queryHasMatch(nestedCollection, field, apiKey)) return true
      }
    }

    const storeKeyCollections = [
      defaultDb.collection('stores').doc(storeId).collection('integrationApiKeys'),
      defaultDb.collection('storeSettings').doc(storeId).collection('integrationApiKeys'),
    ]

    for (const keyCollection of storeKeyCollections) {
      for (const field of ['token', 'key', 'apiKey', 'value']) {
        if (await queryHasMatch(keyCollection, field, apiKey)) return true
      }
    }

    for (const field of ['token', 'key', 'apiKey', 'value']) {
      const snapshot = await defaultDb
        .collection('integrationApiKeys')
        .where('storeId', '==', storeId)
        .where(field, '==', apiKey)
        .limit(1)
        .get()
      if (!snapshot.empty) return true
    }
  } catch (error) {
    functions.logger.warn('integration bookings auth lookup failed', { storeId, error })
  }

  return false
}

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function findCustomerDoc(storeId: string, phone: string, email: string) {
  const customersRef = defaultDb.collection('stores').doc(storeId).collection('customers')
  if (phone) {
    const byPhone = await customersRef.where('phone', '==', phone).limit(1).get()
    if (!byPhone.empty) return byPhone.docs[0]
  }
  if (email) {
    const byEmail = await customersRef.where('email', '==', email).limit(1).get()
    if (!byEmail.empty) return byEmail.docs[0]
  }
  return null
}

export const v1IntegrationBookings = functions.https.onRequest(async (req, res): Promise<void> => {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (!assertContract(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' })
    return
  }

  const storeId = clean(req.query.storeId, 180)
  if (!storeId) {
    res.status(400).json({ error: 'missing-store-id' })
    return
  }

  if (!(await isAuthorized(req, storeId))) {
    const requestKey = resolveRequestApiKey(req)
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid API key for storeId or missing credentials.',
      debug: {
        storeId,
        hasApiKey: Boolean(requestKey),
        apiKeyHint: requestKey ? `${requestKey.slice(0, 4)}...${requestKey.slice(-4)}` : null,
      },
    })
    return
  }

  try {
    if (req.method === 'GET') {
      const status = clean(req.query.status, 80).toLowerCase()
      const serviceId = normalizeServiceId(req.query.serviceId)

      let query: FirebaseFirestore.Query = defaultDb
        .collection('stores')
        .doc(storeId)
        .collection('integrationBookings')
        .orderBy('createdAt', 'desc')

      if (status) query = query.where('status', '==', status)
      if (serviceId) query = query.where('serviceId', '==', serviceId)

      const snapshot = await query.limit(200).get()
      const bookings = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      res.status(200).json({ ok: true, storeId, status: status || null, serviceId: serviceId || null, bookings })
      return
    }

    const body = asObject(req.body) as BookingRequestBody
    const serviceId = normalizeServiceId(body.serviceId)
    const slotId = clean(body.slotId, 220)
    const quantity = Math.max(1, Math.floor(toNumber(body.quantity, 1)))
    const notes = clean(body.notes, 2000)
    const bookingDate = clean(body.bookingDate, 80)
    const bookingTime = clean(body.bookingTime, 80)
    const branchLocationId = clean(body.branchLocationId, 220)
    const branchLocationName = clean(body.branchLocationName, 240)
    const attributes = asObject(body.attributes)
    const preferredBranch = clean(body.preferredBranch, 240) || branchLocationName || clean(attributes.preferred_branch, 240)
    const paymentMethod = clean(body.paymentMethod, 120)
    // Payment settlement is server-controlled. Provider verification/webhooks must update this later.
    const paymentStatus = 'pending'
    const paymentCollectionMode = clean(body.paymentCollectionMode ?? body.paymentOption, 120)
    const depositAmount = toNumber(body.depositAmount, 0)
    const amountOutstanding = toNumber(body.amountOutstanding, toNumber(body.paymentAmount, 0))
    const serviceName = clean(body.serviceName, 240)
    const requestedStatus = clean(body.status, 80).toLowerCase()
    const status = requestedStatus || 'pending'
    const paymentAmount = toNumber(body.paymentAmount, 0)
    const sourceChannel = clean(body.sourceChannel ?? body.source_channel ?? body.source, 120) || 'integration'
    const customer = asObject(body.customer)
    const customerName = clean(customer.name, 240)
    const customerPhone = clean(customer.phone, 80)
    const customerEmail = clean(customer.email, 240).toLowerCase()

    if (!serviceId && !slotId) {
      res.status(400).json({ error: 'missing-service-or-slot' })
      return
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    const storeRef = defaultDb.collection('stores').doc(storeId)

    let resolvedServiceId = serviceId
    let resolvedServiceName = serviceName
    if (slotId) {
      const slotRef = storeRef.collection('integrationAvailabilitySlots').doc(slotId)
      await defaultDb.runTransaction(async tx => {
        const slotSnap = await tx.get(slotRef)
        if (!slotSnap.exists) throw new Error('slot-not-found')
        const slot = slotSnap.data() as Record<string, unknown>
        const slotStatus = clean(slot.status, 40).toLowerCase() || 'open'
        if (slotStatus !== 'open') throw new Error('slot-not-open')

        const capacity = Math.max(0, Math.floor(toNumber(slot.capacity, 0)))
        const seatsBooked = Math.max(0, Math.floor(toNumber(slot.seatsBooked, 0)))
        const seatsRemaining = Math.max(0, capacity - seatsBooked)
        if (capacity > 0 && seatsRemaining < quantity) throw new Error('slot-capacity-exceeded')

        resolvedServiceId = resolvedServiceId || clean(slot.serviceId, 220)
        resolvedServiceName = resolvedServiceName || clean(slot.serviceName, 240)
        tx.update(slotRef, { seatsBooked: seatsBooked + quantity, updatedAt: now })
      })
    }

    const customerDoc = await findCustomerDoc(storeId, customerPhone, customerEmail)
    const customerRef = customerDoc ? customerDoc.ref : storeRef.collection('customers').doc()
    await customerRef.set(
      {
        name: customerName || null,
        phone: customerPhone || null,
        email: customerEmail || null,
        updatedAt: now,
        createdAt: customerDoc ? customerDoc.get('createdAt') || now : now,
        source: 'integration',
      },
      { merge: true },
    )

    const bookingRef = storeRef.collection('integrationBookings').doc()
    const reference = `IB-${bookingRef.id.slice(0, 8).toUpperCase()}`
    const bookingRecord: Record<string, unknown> = {
      bookingId: bookingRef.id,
      reference,
      storeId,
      customerId: customerRef.id,
      serviceId: resolvedServiceId,
      serviceName: resolvedServiceName || null,
      slotId: slotId || null,
      customer: { name: customerName || null, phone: customerPhone || null, email: customerEmail || null },
      quantity,
      notes: notes || null,
      bookingDate: bookingDate || null,
      bookingTime: bookingTime || null,
      branchLocationId: branchLocationId || null,
      branchLocationName: branchLocationName || null,
      preferredBranch: preferredBranch || null,
      branch: preferredBranch || null,
      paymentMethod: paymentMethod || null,
      paymentAmount,
      paymentStatus,
      payment_status: paymentStatus,
      paymentCollectionMode: paymentCollectionMode || null,
      paymentOption: clean(body.paymentOption, 80) || null,
      depositAmount,
      amountOutstanding,
      payment: {
        method: paymentMethod || null,
        status: paymentStatus,
        amount: paymentAmount,
        depositAmount,
        amountOutstanding,
        confirmed: false,
      },
      attributes,
      bookingStatus: 'pending_approval',
      status: 'pending',
      syncStatus: 'not_ready',
      syncReason: null,
      syncRequestedAt: null,
      confirmedAt: null,
      confirmedBy: null,
      rescheduledAt: null,
      cancelledAt: null,
      completedAt: null,
      source: 'integration',
      sourceChannel,
      source_channel: sourceChannel,
      channel: 'BuySedifex',
      recordType: 'service_booking',
      createdAt: now,
      updatedAt: now,
    }

    await bookingRef.set(bookingRecord, { merge: true })
    await defaultDb.collection('integrationBookings').doc(bookingRef.id).set(bookingRecord, { merge: true })

    res.status(200).json({ ok: true, bookingId: bookingRef.id, reference, booking: bookingRecord })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'integration-booking-failed'
    const known = new Set(['slot-not-found', 'slot-not-open', 'slot-capacity-exceeded'])
    res.status(known.has(message) ? 400 : 500).json({ error: message })
  }
})