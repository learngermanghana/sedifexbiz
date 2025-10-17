import * as crypto from 'crypto'
import * as functions from 'firebase-functions'
import { admin, defaultDb } from './firestore'
import { mapPaystackPlanCodeToPlanId } from './plans'

type PaystackEvent = {
  event?: unknown
  data?: Record<string, unknown> | null
}

type PaystackChargeData = {
  reference?: unknown
  status?: unknown
  amount?: unknown
  currency?: unknown
  paid_at?: unknown
  paidAt?: unknown
  customer?: { email?: unknown } | null
  plan?: unknown
  plan_code?: unknown
  plan_object?: { plan_code?: unknown } | null
  metadata?: Record<string, unknown> | null
}

type SignupUnlockRecord = {
  status?: unknown
  locked?: unknown
  expiresAt?: unknown
}

const PAYSTACK_SECRET_ENV_KEYS = ['PAYSTACK_SECRET', 'PAYSTACK_WEBHOOK_SECRET'] as const

function getPaystackSecret(): string | null {
  const configSecret = functions.config()?.paystack?.secret
  if (typeof configSecret === 'string' && configSecret.trim() !== '') {
    return configSecret.trim()
  }

  for (const key of PAYSTACK_SECRET_ENV_KEYS) {
    const raw = process.env[key]
    if (typeof raw === 'string' && raw.trim() !== '') {
      return raw.trim()
    }
  }

  return null
}

function verifySignature(payload: Buffer, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex')
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length) {
    return false
  }
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
}

function extractPlanCode(data: PaystackChargeData | null | undefined): string | null {
  if (!data) return null

  const candidates: Array<unknown> = [
    data.plan_code,
    (data.plan as Record<string, unknown> | null)?.plan_code,
    (data.plan as Record<string, unknown> | null)?.planCode,
    (data.plan_object as Record<string, unknown> | null)?.plan_code,
    data.metadata?.plan_code,
    data.metadata?.planCode,
    data.metadata?.plan,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate)
    if (normalized) {
      return normalized
    }
  }

  return null
}

function toTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (value instanceof admin.firestore.Timestamp) {
    return value
  }

  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.valueOf())) {
      return admin.firestore.Timestamp.fromDate(date)
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return admin.firestore.Timestamp.fromMillis(value)
  }

  return null
}

function resolveAmountMajorUnits(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  // Paystack sends amounts in minor units. Convert to major (e.g., pesewas -> cedis).
  return Math.round((value / 100) * 100) / 100
}

function isUnlockRecordPaid(record: SignupUnlockRecord): boolean {
  const status = normalizeString(record.status)
  if (status && ['paid', 'active', 'unlocked'].includes(status.toLowerCase())) {
    return true
  }
  return false
}

export const paystackWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST')
    res.status(405).send('Method Not Allowed')
    return
  }

  const secret = getPaystackSecret()
  if (!secret) {
    functions.logger.error('Paystack webhook rejected: missing secret configuration')
    res.status(500).send('Paystack secret not configured')
    return
  }

  const signatureHeader = normalizeString(req.get('x-paystack-signature'))
  if (!signatureHeader) {
    functions.logger.warn('Paystack webhook missing signature header')
    res.status(401).send('Unauthorized')
    return
  }

  const rawBody = req.rawBody ?? Buffer.from('')

  try {
    if (!verifySignature(rawBody, signatureHeader, secret)) {
      functions.logger.warn('Paystack webhook signature mismatch')
      res.status(401).send('Unauthorized')
      return
    }
  } catch (error) {
    functions.logger.error('Paystack webhook signature verification failed', error)
    res.status(401).send('Unauthorized')
    return
  }

  let payload: PaystackEvent
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as PaystackEvent
  } catch (error) {
    functions.logger.warn('Paystack webhook received invalid JSON payload', error)
    res.status(400).send('Invalid payload')
    return
  }

  const eventType = normalizeString(payload.event)
  if (!eventType) {
    functions.logger.warn('Paystack webhook missing event type')
    res.status(400).send('Missing event type')
    return
  }

  if (eventType !== 'charge.success' && eventType !== 'invoice.payment_succeeded') {
    functions.logger.info('Paystack webhook ignored unsupported event', { eventType })
    res.status(200).json({ ok: true, ignored: true })
    return
  }

  const data = (payload.data ?? {}) as PaystackChargeData
  const reference = normalizeString(data.reference)
  if (!reference) {
    functions.logger.warn('Paystack webhook missing transaction reference', { eventType })
    res.status(400).send('Missing reference')
    return
  }

  const status = normalizeString(data.status) ?? 'pending'
  const amount = resolveAmountMajorUnits(data.amount)
  const currency = normalizeString(data.currency)
  const paidAtTimestamp = toTimestamp(data.paid_at ?? data.paidAt)
  const email = normalizeString(data.customer?.email)
  const planCode = extractPlanCode(data)
  const planId = planCode ? mapPaystackPlanCodeToPlanId(planCode) : null

  const paymentStatus = status.toLowerCase() === 'success' ? 'paid' : status

  const now = admin.firestore.FieldValue.serverTimestamp()

  const paymentDoc = {
    provider: 'paystack',
    event: eventType,
    status: paymentStatus,
    rawStatus: status,
    email,
    reference,
    planCode: planCode ?? null,
    planId: planId ?? null,
    amount,
    currency: currency ?? null,
    paidAt: paidAtTimestamp ?? null,
    updatedAt: now,
  }

  const writes: Array<Promise<unknown>> = []
  writes.push(defaultDb.collection('payments').doc(reference).set(paymentDoc, { merge: true }))

  if (email) {
    const unlockRef = defaultDb.collection('signupUnlocks').doc(email.toLowerCase())
    const unlockUpdate: Record<string, unknown> = {
      email,
      provider: 'paystack',
      status: paymentStatus,
      reference,
      planCode: planCode ?? null,
      planId: planId ?? null,
      amount,
      currency: currency ?? null,
      updatedAt: now,
    }

    if (paidAtTimestamp) {
      unlockUpdate.paidAt = paidAtTimestamp
    }

    if (paymentStatus === 'paid') {
      unlockUpdate.unlockedAt = now
      unlockUpdate.locked = false
    }

    writes.push(unlockRef.set(unlockUpdate, { merge: true }))
  }

  try {
    await Promise.all(writes)
  } catch (error) {
    functions.logger.error('Paystack webhook failed to persist payment metadata', error)
    res.status(500).send('Failed to persist payment metadata')
    return
  }

  functions.logger.info('Paystack webhook processed', {
    eventType,
    reference,
    email,
    planCode,
    planId,
    status: paymentStatus,
  })

  res.status(200).json({ ok: true })
})

export const checkSignupUnlock = functions.https.onCall(async (data: unknown) => {
  if (!data || typeof data !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'Enter the email you used during checkout.')
  }

  const payload = data as { email?: unknown }
  const email = normalizeString(payload.email)?.toLowerCase()

  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter the email you used during checkout.')
  }

  const docRef = defaultDb.collection('signupUnlocks').doc(email)
  const snapshot = await docRef.get()

  if (!snapshot.exists) {
    return { ok: false, status: 'missing', email }
  }

  const record = (snapshot.data() ?? {}) as SignupUnlockRecord & Record<string, unknown>
  const locked = record.locked === true
  if (locked) {
    return { ok: false, status: 'locked', email }
  }

  const expiresAt = toTimestamp(record.expiresAt)
  if (expiresAt && expiresAt.toMillis() < Date.now()) {
    return { ok: false, status: 'expired', email, expiresAt: expiresAt.toMillis() }
  }

  if (!isUnlockRecordPaid(record)) {
    return {
      ok: false,
      status: normalizeString(record.status) ?? 'unverified',
      email,
    }
  }

  const planCode = normalizeString((record as Record<string, unknown>).planCode)
  const planId = normalizeString((record as Record<string, unknown>).planId)
  const reference = normalizeString((record as Record<string, unknown>).reference)
  const amount = typeof (record as Record<string, unknown>).amount === 'number' ? (record as Record<string, unknown>).amount : null
  const currency = normalizeString((record as Record<string, unknown>).currency)
  const paidAt = toTimestamp((record as Record<string, unknown>).paidAt)
  const unlockedAt = toTimestamp((record as Record<string, unknown>).unlockedAt)

  await docRef.set({ lastCheckedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })

  return {
    ok: true,
    email,
    status: 'paid',
    planCode: planCode ?? null,
    planId: planId ?? null,
    reference: reference ?? null,
    amount,
    currency: currency ?? null,
    paidAt: paidAt ? paidAt.toMillis() : null,
    unlockedAt: unlockedAt ? unlockedAt.toMillis() : null,
  }
})
