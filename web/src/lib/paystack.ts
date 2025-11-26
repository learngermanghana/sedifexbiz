import { paystackEnv } from '../config/paystackEnv'

declare global {
  interface Window {
    PaystackPop?: PaystackPop
  }
}

interface PaystackPop {
  setup(options: PaystackSetupOptions): PaystackHandler
}

interface PaystackHandler {
  openIframe(): void
}

interface PaystackSetupOptions {
  key: string
  email: string
  amount: number
  currency?: string
  ref?: string
  metadata?: Record<string, unknown>
  callback: (response: PaystackCallbackResponse) => void
  onClose: () => void
}

interface PaystackCallbackResponse {
  reference: string
  status?: string
}

export interface PaystackBuyer {
  email?: string
  phone?: string
  name?: string
}

export interface PaystackResult {
  ok: boolean
  reference: string | null
  status?: string | null
  error?: string
}

const PAYSTACK_SCRIPT_URL = 'https://js.paystack.co/v1/inline.js'

let paystackLoader: Promise<PaystackPop | null> | null = null

function toMinorUnits(ghs: number) {
  return Math.round(ghs * 100)
}

export async function loadPaystackScript(): Promise<PaystackPop | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  if (window.PaystackPop) {
    return window.PaystackPop
  }

  if (!paystackLoader) {
    paystackLoader = new Promise(resolve => {
      const existingScript = document.querySelector(
        `script[src="${PAYSTACK_SCRIPT_URL}"]`,
      ) as HTMLScriptElement | null

      const script = existingScript ?? document.createElement('script')
      script.src = PAYSTACK_SCRIPT_URL
      script.async = true
      script.onload = () => resolve(window.PaystackPop ?? null)
      script.onerror = () => {
        paystackLoader = null
        script.remove()
        resolve(null)
      }

      if (!existingScript) {
        document.body.appendChild(script)
      }
    })
  }

  return paystackLoader
}

export async function payWithPaystack(
  amountGhs: number,
  buyer?: PaystackBuyer,
): Promise<PaystackResult> {
  if (!paystackEnv.publicKey) {
    return {
      ok: false,
      reference: null,
      error: 'Paystack is not configured. Please try again later.',
    }
  }

  const paystackPop = await loadPaystackScript()
  if (!paystackPop) {
    return {
      ok: false,
      reference: null,
      error: 'Unable to load Paystack checkout. Please refresh and try again.',
    }
  }

  const email = buyer?.email?.trim() || 'testbuyer@example.com'
  const phone = buyer?.phone?.trim()
  const name = buyer?.name?.trim()

  return new Promise(resolve => {
    const handler = paystackPop.setup({
      key: paystackEnv.publicKey!,
      email,
      amount: toMinorUnits(amountGhs),
      currency: 'GHS',
      ref: `SFX_${Date.now()}`,
      metadata: { phone, name },
      callback: resp =>
        resolve({ ok: true, reference: resp.reference, status: resp.status ?? 'success' }),
      onClose: () => resolve({ ok: false, reference: null, status: 'cancelled' }),
    })

    handler.openIframe()
  })
}
