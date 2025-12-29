import { getOptionalEnv } from './envHelpers'

export const paystackPublicKey = getOptionalEnv('VITE_PAYSTACK_PUBLIC_KEY')
export const bulkMessagingCreditsPaystackUrl = getOptionalEnv(
  'VITE_BULK_MESSAGING_CREDITS_PAYSTACK_URL',
)

export const env = {
  paystackPublicKey,
  bulkMessagingCreditsPaystackUrl,
}

export type Env = typeof env
