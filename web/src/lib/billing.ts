// web/src/lib/billing.ts
import { getFunctions, httpsCallable } from 'firebase/functions'

// Region for your callable functions (change if needed)
const REGION = import.meta.env.VITE_FUNCTIONS_REGION || 'us-central1'

type PlanId = 'starter' | 'pro' | 'enterprise'

/**
 * Ask Firebase Callable Function `createCheckout` for a Paystack checkout URL,
 * then redirect there. Falls back to your Paystack Shop link if the call fails.
 */
export async function startCheckout(planId: PlanId) {
  const functions = getFunctions(undefined, REGION)
  const createCheckout = httpsCallable(functions, 'createCheckout')

  try {
    const res = await createCheckout({ planId })
    const url = (res?.data as any)?.url as string | undefined
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('No checkout URL returned from createCheckout.')
    }
    window.location.assign(url)
  } catch (err) {
    // Fallback: static Paystack Shop link
    const fallbackUrl = 'https://paystack.shop/pay/pgsf1kucjw'
    window.open(fallbackUrl, '_blank', 'noopener,noreferrer')
    throw err
  }
}
