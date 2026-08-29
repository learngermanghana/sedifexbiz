import type { VercelRequest, VercelResponse } from '@vercel/node'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './_firebase-admin.js'
import { calculateCheckoutFees, toPaystackMinorAmount } from './_checkout-fees.js'
import { upsertCanonicalCustomer } from './_customer-identity.js'

type PaymentMode = 'online' | 'manual' | 'none'

function text(value: unknown, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeEmail(value: unknown) {
  return text(value, 160).toLowerCase()
}

function normalizePaymentMode(value: unknown): PaymentMode {
  const normalized = text(value, 20).toLowerCase()
  if (normalized === 'online' || normalized === 'manual' || normalized === 'none') return normalized
  return 'none'
}

function buildReference(storeId: string) {
  return `REG-${storeId.slice(0, 6).toUpperCase()}-${Date.now()}`
}

function buildStudentCode(storeId: string, docId: string) {
  const year = new Date().getFullYear()
  const prefix = text(process.env.SEDIFEX_STUDENT_ID_PREFIX, 12) || storeId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'STU'
  const shortId = docId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()
  return `${prefix}-${year}-${shortId}`
}

async function initializePaystack(input: {
  email: string
  amount: number
  currency: string
  reference: string
  callbackUrl?: string
  metadata: Record<string, unknown>
}) {
  const secret = process.env.PAYSTACK_SECRET || process.env.PAYSTACK_SECRET_KEY || ''
  if (!secret) return null

  const fees = calculateCheckoutFees({ amount: input.amount, currency: input.currency, useCase: 'student_registration' })

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email || `${input.reference.toLowerCase()}@noemail.sedifex.local`,
      amount: toPaystackMinorAmount(fees),
      reference: input.reference,
      currency: input.currency,
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      metadata: { ...input.metadata, feePolicy: fees },
    }),
  })

  const body = await response.json().catch(() => ({}))
  return {
    provider: 'paystack',
    ok: response.ok,
    reference: input.reference,
    authorizationUrl: body?.data?.authorization_url ?? null,
    accessCode: body?.data?.access_code ?? null,
    message: body?.message ?? null,
    feePolicy: fees,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  const body = (req.body ?? {}) as Record<string, unknown>
  const storeId = text(body.storeId || req.headers['x-store-id'], 120)
  const pageId = text(body.pageId, 120) || 'student-registration'
  const source = text(body.source, 120) || 'client_website'
  const customer = (body.customer ?? body.student ?? {}) as Record<string, unknown>
  const data = (body.data ?? {}) as Record<string, unknown>
  const paymentInput = (body.payment ?? {}) as Record<string, unknown>

  const studentName = text(customer.name || data.studentName || data.name, 140)
  const email = normalizeEmail(customer.email || data.email)
  const phone = text(customer.phone || data.phone, 60)
  const course = text(data.course || data.program || data.className, 160)
  const preferredClassTime = text(data.preferredClassTime || data.classTime, 120)
  const branch = text(data.branch || data.location, 120)
  const notes = text(data.notes, 1000)
  const providedPhotoUrl = text(data.studentPhotoUrl || data.photoUrl || data.imageUrl, 500)
  const providedStatus = text(data.studentStatus, 80) || 'pending'

  if (!storeId) return res.status(400).json({ error: 'storeId is required.' })
  if (!studentName) return res.status(400).json({ error: 'Student name is required.' })
  if (!email && !phone) return res.status(400).json({ error: 'Student email or phone is required.' })

  const paymentMode = normalizePaymentMode(paymentInput.mode)
  const amount = Number(paymentInput.amount)
  const currency = text(paymentInput.currency, 12) || 'GHS'
  const reference = text(paymentInput.reference, 140) || buildReference(storeId)
  const callbackUrl = text(paymentInput.callbackUrl, 500)
  const manualInstructions = text(paymentInput.manualInstructions, 1000)
  const feePolicy = Number.isFinite(amount) && amount > 0 ? calculateCheckoutFees({ amount, currency, useCase: 'student_registration' }) : null

  if (paymentMode === 'online' && (!Number.isFinite(amount) || amount <= 0)) {
    return res.status(400).json({ error: 'A valid payment.amount is required for online payment.' })
  }

  const firestore = db()
  const now = FieldValue.serverTimestamp()
  const submissionRef = firestore.collection('student_registrations').doc()
  const studentCode = text(data.studentCode, 80) || buildStudentCode(storeId, submissionRef.id)

  const canonicalCustomer = await upsertCanonicalCustomer(firestore, {
    storeId,
    name: studentName,
    email,
    phone,
    sourceChannel: 'student_registration',
    sourceTag: 'student',
    identityKey: `student-registration-${submissionRef.id}`,
  })
  if (!canonicalCustomer?.customerId) {
    return res.status(500).json({ error: 'Unable to resolve customer profile.' })
  }
  const customerId = canonicalCustomer.customerId

  const paymentStatus =
    paymentMode === 'online'
      ? 'pending'
      : paymentMode === 'manual'
        ? 'pending_manual_review'
        : 'not_required'

  await submissionRef.set({
    storeId,
    pageId,
    pageType: 'student_registration',
    source,
    status: 'new',
    studentCode,
    studentStatus: providedStatus,
    studentPhotoUrl: providedPhotoUrl || null,
    idCardIssued: false,
    idCardIssuedAt: null,
    idCardExpiresAt: text(data.idCardExpiresAt, 80) || null,
    customerId,
    customer_id: customerId,
    customerIdentity: {
      customerId,
      source: 'student_registration',
      strategy: 'canonical_customer_v1',
      linkedAt: now,
    },
    customer: {
      name: studentName,
      email: email || null,
      phone: phone || null,
    },
    data: {
      ...data,
      course: course || null,
      preferredClassTime: preferredClassTime || null,
      branch: branch || null,
      notes: notes || null,
      studentCode,
      studentStatus: providedStatus,
      studentPhotoUrl: providedPhotoUrl || null,
    },
    payment: {
      mode: paymentMode,
      status: paymentStatus,
      amount: Number.isFinite(amount) ? amount : null,
      currency,
      reference,
      feePolicy,
      customerTotal: feePolicy?.customerTotalMajor ?? null,
      sedifexCommission: feePolicy?.sedifexCommissionMajor ?? null,
      merchantNet: feePolicy?.merchantNetMajor ?? null,
      manualInstructions: paymentMode === 'manual' ? manualInstructions || null : null,
    },
    createdAt: now,
    updatedAt: now,
  })

  await firestore.collection('customers').doc(customerId).set({
    studentRegistrationId: submissionRef.id,
    lastStudentRegistrationId: submissionRef.id,
    studentCode,
    studentStatus: providedStatus,
    studentPhotoUrl: providedPhotoUrl || null,
    lastStudentCourse: course || null,
    studentRegistrationSource: source,
    updatedAt: now,
  }, { merge: true })

  let payment: Record<string, unknown> | null = null
  if (paymentMode === 'online') {
    payment = await initializePaystack({
      email,
      amount,
      currency,
      reference,
      callbackUrl,
      metadata: {
        storeId,
        pageType: 'student_registration',
        submissionId: submissionRef.id,
        studentCode,
        studentName,
        customerId,
        course,
        source,
      },
    })

    if (payment) {
      await submissionRef.set({
        payment: {
          mode: paymentMode,
          status: 'pending',
          amount,
          currency,
          reference,
          provider: 'paystack',
          authorizationUrl: payment.authorizationUrl ?? null,
          accessCode: payment.accessCode ?? null,
          feePolicy: payment.feePolicy ?? feePolicy,
          customerTotal: (payment.feePolicy as { customerTotalMajor?: number } | undefined)?.customerTotalMajor ?? feePolicy?.customerTotalMajor ?? null,
          sedifexCommission: (payment.feePolicy as { sedifexCommissionMajor?: number } | undefined)?.sedifexCommissionMajor ?? feePolicy?.sedifexCommissionMajor ?? null,
          merchantNet: (payment.feePolicy as { merchantNetMajor?: number } | undefined)?.merchantNetMajor ?? feePolicy?.merchantNetMajor ?? null,
          initializedAt: now,
        },
        updatedAt: now,
      }, { merge: true })
    }
  }

  return res.status(200).json({
    ok: true,
    submissionId: submissionRef.id,
    studentCode,
    customerId,
    reference,
    paymentMode,
    paymentStatus,
    feePolicy,
    payment,
    manualPayment: paymentMode === 'manual'
      ? {
          reference,
          instructions: manualInstructions || 'Follow the school payment instructions and use the reference above.',
        }
      : null,
  })
}