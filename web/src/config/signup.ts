const DEFAULT_SALES_EMAIL = 'sales@sedifex.com'

const DEFAULT_PAYMENT_URL = 'https://paystack.shop/pay/pgsf1kucjw'
const DEFAULT_SALES_BOOKING_URL = 'https://calendly.com/sedifex/demo'


function getPaymentUrl(): string | null {
  const raw = import.meta.env.VITE_SIGNUP_PAYMENT_URL
  if (typeof raw !== 'string') {

    return DEFAULT_PAYMENT_URL

  }

  const trimmed = raw.trim()
  if (!trimmed) {

    return DEFAULT_PAYMENT_URL

  }

  return trimmed
}

function getSalesBookingUrl(): string {
  const raw = import.meta.env.VITE_SALES_BOOKING_URL
  if (typeof raw !== 'string') {
    return DEFAULT_SALES_BOOKING_URL
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return DEFAULT_SALES_BOOKING_URL
  }

  return trimmed
}

export const signupConfig = {
  paymentUrl: getPaymentUrl(),
  salesEmail: DEFAULT_SALES_EMAIL,
  salesBookingUrl: getSalesBookingUrl(),
}

export type SignupConfig = typeof signupConfig
