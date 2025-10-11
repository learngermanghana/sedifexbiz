// web/src/lib/billing.ts
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

// Keep these plan IDs in sync with functions/src/plans.ts
export type PlanId = 'starter' | 'pro' | 'enterprise'

type CreateCheckoutResponse = {
  checkoutUrl?: string
  authorization_url?: string
}

export async function startCheckout(planId: PlanId = 'starter') {
  const createCheckout = httpsCallable(functions, 'createCheckout')
  const { data } = await createCheckout({ planId })
  const payload = (data || {}) as CreateCheckoutResponse
  const url = payload.checkoutUrl || payload.authorization_url
  if (!url) throw new Error('Missing checkout URL from server')
  window.location.href = url
}
