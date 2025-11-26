import { getOptionalEnv } from './envHelpers'

const PAYSTACK_PUBLIC_KEY = 'VITE_PAYSTACK_PUBLIC_KEY'

type PaystackEnv = {
  publicKey: string | null
}

export const paystackEnv: PaystackEnv = {
  publicKey: getOptionalEnv(PAYSTACK_PUBLIC_KEY),
}

export type { PaystackEnv }
