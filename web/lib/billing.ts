// web/lib/billing.ts
import { getFunctions, httpsCallable } from 'firebase/functions'
// lib -> src is one level up
import { app } from '../src/firebase'

type Plan = 'starter-monthly' | 'starter-yearly'

/**
 * Starts a Paystack checkout by calling the Cloud Function `createCheckout`.
 * On success, redirects the browser to Paystack's authorization URL.
 */
export async function startCheckout(plan: Plan) {
  const region = import.meta.env.VITE_FUNCTIONS_REGION || 'us-central1'
  const fn = httpsCallable(getFunctions(app, region), 'createCheckout')
  const res = await fn({ plan })
  const { authorizationUrl } = (res.data as any) || {}
  if (!authorizationUrl) throw new Error('No authorization URL returned from createCheckout')
  window.location.href = authorizationUrl
}
