import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

type PaystackCheckoutPayload = {
  email: string
  storeId: string
  amount: number
  plan: string
  redirectUrl?: string
  returnUrl?: string
  metadata?: Record<string, unknown>
}

type PaystackCheckoutResponse = {
  ok: boolean
  authorizationUrl?: string | null
  reference?: string | null
  publicKey?: string | null
}

type SignupUnlockResponse = {
  ok: boolean
  unlocked: boolean
  status: string
  plan?: string | null
  provider?: string | null
  reference?: string | null
  lastEvent?: unknown
}

export async function startPaystackCheckout(
  payload: PaystackCheckoutPayload,
): Promise<PaystackCheckoutResponse> {
  const callable = httpsCallable(functions, 'createPaystackCheckout')
  const result = await callable(payload)
  const data = result.data as PaystackCheckoutResponse | undefined

  if (!data) {
    throw new Error('Unable to start checkout. Please try again later.')
  }

  return data
}

export async function checkSignupUnlockStatus(storeId: string): Promise<SignupUnlockResponse> {
  const callable = httpsCallable(functions, 'checkSignupUnlock')
  const result = await callable({ storeId })
  const data = result.data as SignupUnlockResponse | undefined

  if (!data) {
    throw new Error('Unable to verify subscription. Please try again later.')
  }

  return data
}
