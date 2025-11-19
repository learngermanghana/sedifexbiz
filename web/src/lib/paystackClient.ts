import { getFunctions, httpsCallable } from 'firebase/functions'
import { app } from '../firebase'

const functions = getFunctions(app)

export type CreateCheckoutPayload = {
  email: string
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

export async function startPaystackCheckout(
  payload: CreateCheckoutPayload,
): Promise<CreateCheckoutResponse> {
  const callable = httpsCallable(functions, 'createCheckout')
  const res = await callable(payload)
  return res.data as CreateCheckoutResponse
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
  const res = await callable({ storeId })
  return res.data as CheckSignupUnlockResponse
}
