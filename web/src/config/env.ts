import { getOptionalEnv } from './envHelpers'

export const paystackPublicKey = getOptionalEnv('VITE_PAYSTACK_PUBLIC_KEY')

export const env = {
  paystackPublicKey,
}

export type Env = typeof env
