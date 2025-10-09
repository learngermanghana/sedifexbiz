const DEFAULT_SALES_EMAIL = 'sales@sedifex.com'

function getPaymentUrl(): string | null {
  const raw = import.meta.env.VITE_SIGNUP_PAYMENT_URL
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  return trimmed
}

export const signupConfig = {
  paymentUrl: getPaymentUrl(),
  salesEmail: DEFAULT_SALES_EMAIL,
}

export type SignupConfig = typeof signupConfig
