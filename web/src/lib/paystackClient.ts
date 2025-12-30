// web/src/lib/paystackClient.ts
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export type CreateCheckoutPayload = {
  email?: string | null
  storeId: string
  amount: number
  plan?: string
  planId?: string
  redirectUrl?: string
  metadata?: Record<string, any>
}

export type CreateCheckoutResponse = {
  ok: boolean
  authorizationUrl: string
  reference: string
  publicKey: string | null
}

function isCallableNotFound(err: unknown) {
  const code = (err as any)?.code
  const message = String((err as any)?.message ?? '')
  return (
    code === 'functions/not-found' ||
    message.toLowerCase().includes('not found') ||
    message.toLowerCase().includes('function not found')
  )
}

export async function startPaystackCheckout(
  payload: CreateCheckoutPayload,
): Promise<CreateCheckoutResponse> {
  // Prefer the stable alias name first, then fall back.
  const callableNames = ['createCheckout', 'createPaystackCheckout'] as const

  let lastErr: unknown = null

  for (const name of callableNames) {
    try {
      const callable = httpsCallable(functions, name)
      const res = await callable(payload)
      return res.data as CreateCheckoutResponse
    } catch (err) {
      lastErr = err
      if (isCallableNotFound(err)) continue
      throw err
    }
  }

  throw lastErr ?? new Error('Unable to start Paystack checkout.')
}

export type CheckSignupUnlockPayload = {
  storeId: string
}

export type CheckSignupUnlockResponse = {
  ok: boolean
  unlocked: boolean
  status: 'pending' | 'active' | string
  plan: string | null
  provider: string | null
  reference: string | null
  lastEvent: string | null
}

export async function checkSignupUnlockStatus(
  storeId: string,
): Promise<CheckSignupUnlockResponse> {
  const callable = httpsCallable(functions, 'checkSignupUnlock')
  const res = await callable({ storeId } as CheckSignupUnlockPayload)
  return res.data as CheckSignupUnlockResponse
}
