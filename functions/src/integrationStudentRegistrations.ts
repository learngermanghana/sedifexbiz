import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { admin, defaultDb } from './firestore'
import { upsertStoreCustomerIdentity } from './customerUpsert'

const INTEGRATION_CONTRACT_VERSION = defineString('INTEGRATION_CONTRACT_VERSION', { default: '2026-04-13' })
const SEDIFEX_INTEGRATION_API_KEY = defineString('SEDIFEX_INTEGRATION_API_KEY', { default: '' })

type AnyRecord = Record<string, unknown>

function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function asObject(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {}
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function setCors(res: functions.Response) {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, X-Sedifex-Contract-Version')
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

function recordContainsKey(record: AnyRecord, apiKey: string) {
  return [record.integrationApiKey, record.integrationKey, record.integrationToken, record.apiKey, record.token, record.key]
    .some(value => clean(value, 1000) === apiKey)
}

async function queryHasMatch(collectionPath: FirebaseFirestore.CollectionReference, field: string, apiKey: string) {
  const snapshot = await collectionPath.where(field, '==', apiKey).limit(1).get()
  return !snapshot.empty
}

async function isAuthorized(req: functions.https.Request, storeId: string) {
  const bearer = clean(req.get('authorization'), 1000).replace(/^Bearer\s+/i, '')
  const apiKey = clean(req.get('x-api-key'), 1000) || bearer
  if (!apiKey) return false

  const master = SEDIFEX_INTEGRATION_API_KEY.value()?.trim() || process.env.SEDIFEX_INTEGRATION_API_KEY?.trim() || ''
  if (master && apiKey === master) return true

  try {
    const storeSnap = await defaultDb.collection('stores').doc(storeId).get()
    const storeData = (storeSnap.data() ?? {}) as AnyRecord
    if (recordContainsKey(storeData, apiKey)) return true

    const settingsSnap = await defaultDb.collection('storeSettings').doc(storeId).get()
    const settingsData = (settingsSnap.data() ?? {}) as AnyRecord
    if (recordContainsKey(settingsData, apiKey)) return true

    const collections = [
      defaultDb.collection('stores').doc(storeId).collection('integrationApiKeys'),
      defaultDb.collection('storeSettings').doc(storeId).collection('integrationApiKeys'),
    ]
    for (const keyCollection of collections) {
      for (const field of ['token', 'key', 'apiKey', 'value']) {
        if (await queryHasMatch(keyCollection, field, apiKey)) return true
      }
    }

    for (const field of ['token', 'key', 'apiKey', 'value']) {
      const snapshot = await defaultDb.collection('integrationApiKeys').where('storeId', '==', storeId).where(field, '==', apiKey).limit(1).get()
      if (!snapshot.empty) return true
    }
  } catch (error) {
    functions.logger.warn('student registration auth lookup failed', { storeId, error })
  }

  return false
}

export const v1IntegrationStudentRegistrations = functions.https.onRequest(async (req, res): Promise<void> => {
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
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  try {
    if (req.method === 'GET') {
      const snapshot = await defaultDb.collection('student_registrations').where('storeId', '==', storeId).limit(200).get()
      res.status(200).json({ ok: true, storeId, registrations: snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as AnyRecord) })) })
      return
    }

    const body = asObject(req.body)
    const customer = asObject(body.customer)
    const data = asObject(body.data)
    const payment = asObject(body.payment)
    const attributes = asObject(body.attributes)

    const studentName = clean(customer.name ?? body.customerName ?? body.name, 240)
    const phone = clean(customer.phone ?? body.customerPhone ?? body.phone, 80)
    const email = clean(customer.email ?? body.customerEmail ?? body.email, 240).toLowerCase()
    const course = clean(data.course ?? body.course, 240)
    const amount = toNumber(payment.amount ?? body.paymentAmount ?? body.amount, 0)

    if (!studentName) {
      res.status(400).json({ error: 'missing-student-name' })
      return
    }
    if (!phone && !email) {
      res.status(400).json({ error: 'missing-student-contact' })
      return
    }
    if (!course) {
      res.status(400).json({ error: 'missing-course' })
      return
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    const registrationRef = defaultDb.collection('student_registrations').doc()
    const reference = clean(payment.reference ?? body.reference, 160) || `REG-${registrationRef.id.slice(0, 8).toUpperCase()}`
    const paymentStatus = clean(payment.status ?? body.paymentStatus, 80) || 'checkout_created'
    const paymentMode = clean(payment.mode ?? body.paymentMode, 80) || 'online_checkout'
    const sourceChannel = clean(body.sourceChannel, 120) || 'client_website'

    const canonicalCustomer = await upsertStoreCustomerIdentity({
      storeId,
      customer: { name: studentName, phone, email },
      sourceChannel: 'student_registration',
      sourceTag: 'student',
      identityKey: `student-registration-${registrationRef.id}`,
    })
    if (!canonicalCustomer?.customerId) {
      throw new Error('customer-identity-resolution-failed')
    }
    const customerId = canonicalCustomer.customerId

    await defaultDb.collection('customers').doc(customerId).set({
      studentRegistrationId: registrationRef.id,
      lastStudentRegistrationId: registrationRef.id,
      lastStudentCourse: course,
      studentRegistrationSource: sourceChannel,
      updatedAt: now,
    }, { merge: true })

    const registrationRecord: AnyRecord = {
      id: registrationRef.id,
      registrationId: registrationRef.id,
      storeId,
      pageId: 'student-registration',
      pageType: 'student_registration',
      source: clean(body.source ?? body.sourceChannel, 120) || 'website_registration_form',
      sourceChannel,
      status: clean(body.status, 80) || 'new',
      customerId,
      customer_id: customerId,
      customerIdentity: {
        customerId,
        source: 'student_registration',
        strategy: 'canonical_customer_v1',
        linkedAt: now,
      },
      customer: { name: studentName, phone: phone || null, email: email || null },
      data: {
        course,
        preferredClassTime: clean(data.preferredClassTime ?? body.preferredClassTime, 160) || null,
        branch: clean(data.branch ?? body.branch, 160) || null,
        notes: clean(data.notes ?? body.notes, 2000) || null,
        healthComplications: Array.isArray(data.healthComplications) ? data.healthComplications.filter(item => typeof item === 'string') : [],
        guarantor: asObject(data.guarantor),
        apprentice: asObject(data.apprentice),
      },
      payment: { mode: paymentMode, status: paymentStatus, amount: amount || null, currency: clean(payment.currency ?? body.currency, 10) || 'GHS', reference },
      attributes,
      syncStatus: 'pending',
      syncReason: 'student_registration_created',
      syncRequestedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    await registrationRef.set(registrationRecord, { merge: true })
    await defaultDb.collection('stores').doc(storeId).collection('student_registrations').doc(registrationRef.id).set(registrationRecord, { merge: true })

    res.status(200).json({ ok: true, storeId, registrationId: registrationRef.id, reference, customerId, registration: registrationRecord })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'student-registration-failed'
    functions.logger.error('student registration integration failed', { storeId, message })
    res.status(500).json({ error: message })
  }
})