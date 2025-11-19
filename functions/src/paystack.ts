// functions/src/paystack.ts

import * as functions from 'firebase-functions/v1'
import * as crypto from 'crypto'
import { admin, defaultDb } from './firestore'

/**
 * Types
 */
type PlanId = string

type PaystackInitResponse = {
  status: boolean
  message?: string
  data?: {
    authorization_url: string
    access_code?: string
    reference: string
  }
}

type PaystackCustomer = {
  id?: number
  email?: string
  first_name?: string | null
  last_name?: string | null
}

type PaystackEventData = {
  reference?: string
  amount?: number
  currency?: string
  status?: string
  paid_at?: string
  channel?: string
  customer?: PaystackCustomer
  metadata?: Record<string, any>
  plan?: string | null
  subscription?: string | null
}

type PaystackEvent = {
  event: string
  data: PaystackEventData
}

/**
 * Config
 */
const CFG = functions.config() as any
const PAYSTACK_SECRET: string = CFG?.paystack?.secret || ''
const PAYSTACK_PUBLIC: string = CFG?.paystack?.public || ''
const APP_BASE_URL: string = CFG?.app?.base_url || ''

if (!PAYSTACK_SECRET) {
  functions.logger.warn(
    'Paystack secret not set. Run: firebase functions:config:set paystack.secret="sk_live_xxx"',
  )
}

/**
 * Util: kobo conversion (Paystack expects amounts in kobo)
 */
const toKobo = (amount: number) => Math.round(Math.abs(amount) * 100)

/**
 * Helper: ensure user is authenticated for callables
 */
function assertAuthenticated(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  }
}

/**
 * Callable: initialize a Paystack checkout session
 *
 * Expected data:
 * {
 *   email: string,
 *   storeId: string,
 *   amount: number,
 *   plan?: string,
 *   planId?: string,
 *   redirectUrl?: string,
 *   metadata?: Record<string, any>
 * }
 */
export const createCheckout = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context)

  if (!PAYSTACK_SECRET) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Paystack secret is not configured',
    )
  }

  const email =
    typeof data?.email === 'string' ? data.email.trim().toLowerCase() : ''
  const storeId =
    typeof data?.storeId === 'string' ? data.storeId.trim() : ''

  const rawPlan =
    (typeof data?.plan === 'string' ? data.plan.trim() : '') ||
    (typeof data?.planId === 'string' ? data.planId.trim() : '')
  const plan: PlanId | null = rawPlan || null

  const redirectUrlRaw =
    typeof data?.redirectUrl === 'string' ? data.redirectUrl.trim() : ''
  const redirectUrl =
    redirectUrlRaw || (APP_BASE_URL ? `${APP_BASE_URL}/#/billing/verify` : undefined)

  const metadataIn =
    data?.metadata && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, any>)
      : {}

  const amount = Number(data?.amount)

  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid email is required')
  }
  if (!storeId) {
    throw new functions.https.HttpsError('invalid-argument', 'storeId is required')
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Amount must be greater than zero',
    )
  }

  const reference = `${storeId}_${Date.now()}`

  const payload = {
    email,
    amount: toKobo(amount),
    reference,
    callback_url: redirectUrl,
    metadata: {
      storeId,
      plan: plan,
      createdBy: context.auth!.uid,
      ...metadataIn,
    },
  }

  const resp = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const json = (await resp.json()) as PaystackInitResponse

  if (!json?.status) {
    throw new functions.https.HttpsError(
      'internal',
      json?.message || 'Paystack init failed',
    )
  }

  const { authorization_url: authUrl } = json.data ?? {}

  try {
    await defaultDb
      .collection('subscriptions')
      .doc(storeId)
      .set(
        {
          provider: 'paystack',
          status: 'pending',
          plan,
          reference,
          amount,
          email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: context.auth!.uid,
        },
        { merge: true },
      )
  } catch (e) {
    functions.logger.warn('Failed to write pending subscription doc', { e, storeId })
  }

  return {
    ok: true,
    authorizationUrl: authUrl,
    reference,
    publicKey: PAYSTACK_PUBLIC || null,
  }
})

/**
 * Callable: check if signup/workspace is unlocked after Paystack payment
 *
 * Reads subscriptions/<storeId> and returns whether status === 'active'
 */
export const checkSignupUnlock = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context)

  const storeId =
    typeof data?.storeId === 'string' ? data.storeId.trim() : ''
  if (!storeId) {
    throw new functions.https.HttpsError('invalid-argument', 'storeId is required')
  }

  const subRef = defaultDb.collection('subscriptions').doc(storeId)
  const snap = await subRef.get()

  if (!snap.exists) {
    return {
      ok: true,
      unlocked: false,
      status: 'pending' as const,
    }
  }

  const sub = snap.data() as any
  const status = typeof sub.status === 'string'
    ? sub.status.toLowerCase()
    : 'pending'
  const unlocked = status === 'active'

  return {
    ok: true,
    unlocked,
    status,
    plan: sub.plan ?? null,
    provider: sub.provider ?? 'paystack',
    reference: sub.reference ?? null,
    lastEvent: sub.lastEvent ?? null,
  }
})

/**
 * HTTP Webhook: Paystack event receiver (authoritative status)
 *
 * Verifies x-paystack-signature using HMAC SHA512.
 */
export const paystackWebhook = functions.https.onRequest(
  async (req, res): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed')
        return
      }

      const signature = req.get('x-paystack-signature') || ''
      const secret = PAYSTACK_SECRET
      if (!secret) {
        res.status(500).send('Paystack secret not configured')
        return
      }

      const computed = crypto
        .createHmac('sha512', secret)
        .update(req.rawBody)
        .digest('hex')

      const safeEqual =
        signature.length === computed.length &&
        crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(computed),
        )

      if (!safeEqual) {
        res.status(401).send('Invalid signature')
        return
      }

      const event = req.body as PaystackEvent
      const evtType = event?.event || 'unknown'
      const data = event?.data || {}

      functions.logger.info('Paystack webhook received', {
        event: evtType,
        reference: data.reference,
        email: data.customer?.email,
        amount: data.amount,
        metadata: data.metadata,
      })

      switch (evtType) {
        case 'charge.success': {
          const storeId: string | undefined = data.metadata?.storeId
          if (!storeId) break

          const rawPlan: string | undefined =
            data.metadata?.plan || data.plan || undefined
          const plan: PlanId | null = rawPlan || null
          const email = data.customer?.email || null
          const amount =
            typeof data.amount === 'number' ? data.amount / 100 : null
          const paidAt = data.paid_at || null
          const reference = data.reference || null

          await defaultDb
            .collection('subscriptions')
            .doc(storeId)
            .set(
              {
                provider: 'paystack',
                status: 'active',
                plan,
                customerEmail: email,
                reference,
                amount,
                currency: data.currency || 'NGN',
                channel: data.channel || null,
                paidAt,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastEvent: evtType,
              },
              { merge: true },
            )
          break
        }

        case 'charge.failed': {
          const storeId: string | undefined = data.metadata?.storeId
          const reference = data.reference || null

          if (storeId) {
            await defaultDb
              .collection('subscriptions')
              .doc(storeId)
              .set(
                {
                  provider: 'paystack',
                  status: 'failed',
                  plan: (data.metadata?.plan as PlanId | undefined) ?? null,
                  reference,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  lastEvent: evtType,
                },
                { merge: true },
              )
          }
          break
        }

        default: {
          try {
            const storeId: string | undefined = data.metadata?.storeId
            if (storeId) {
              await defaultDb
                .collection('subscriptions')
                .doc(storeId)
                .collection('events')
                .doc(String(Date.now()))
                .set({
                  event: evtType,
                  data,
                  receivedAt: admin.firestore.FieldValue.serverTimestamp(),
                })
            }
          } catch (e) {
            functions.logger.warn('Failed to store Paystack audit event', {
              e,
              evtType,
            })
          }
          break
        }
      }

      res.status(200).send('ok')
    } catch (err) {
      functions.logger.error('paystackWebhook error', { err })
      res.status(500).send('error')
    }
  },
)
