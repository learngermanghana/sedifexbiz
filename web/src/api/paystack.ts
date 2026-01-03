// web/src/api/paystack.ts
import { getFunctions, httpsCallable } from 'firebase/functions'
import { app } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'

const functions = getFunctions(app)

type CreateCheckoutResponse = {
  ok: boolean
  authorizationUrl?: string
}

export async function startSubscriptionCheckout(
  storeId?: string,
  returnUrl?: string,
): Promise<string> {
  const callable = httpsCallable(functions, 'createPaystackCheckout')
  const result = await callable({ storeId, returnUrl })
  const data = result.data as CreateCheckoutResponse

  if (!data || !data.ok || !data.authorizationUrl) {
    throw new Error('Unable to start checkout. Please try again later.')
  }

  return data.authorizationUrl
}

// Optional hook that uses your active store hook
export function useSubscriptionCheckout() {
  const { storeId: activeStoreId } = useActiveStore()

  async function start(returnUrl?: string) {
    return startSubscriptionCheckout(activeStoreId ?? undefined, returnUrl)
  }

  return { start, activeStoreId }
}
