const PAYSTACK_PUBLIC_KEY = 'VITE_PAYSTACK_PUBLIC_KEY'

type PaystackEnv = {
  publicKey: string | null
}

function getOptionalEnv(key: string): string | null {
  const value = import.meta.env[key]
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }

  return null
}

export const paystackEnv: PaystackEnv = {
  publicKey: getOptionalEnv(PAYSTACK_PUBLIC_KEY),
}

export type { PaystackEnv }
