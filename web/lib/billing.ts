// web/lib/billing.ts
export interface StartCheckoutOptions {
  /**
   * Overrides the default billing endpoint. If omitted, `/api/billing/checkout`
   * will be used.
   */
  endpoint?: string
  /**
   * Explicit redirect URL for the billing provider to send the customer back
   * to once payment completes.
   */
  returnUrl?: string
  /**
   * Additional metadata that should be forwarded to the billing service.
   */
  metadata?: Record<string, string>
}

const DEFAULT_ENDPOINT = '/api/billing/checkout'

function resolveEndpoint(explicit?: string) {
  if (explicit) return explicit
  const envEndpoint = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_BILLING_CHECKOUT_ENDPOINT : null
  if (typeof envEndpoint === 'string' && envEndpoint.trim()) {
    return envEndpoint.trim()
  }
  return DEFAULT_ENDPOINT
}

function buildReturnUrl(planId: string, override?: string) {
  if (override) return override

  if (typeof window === 'undefined') {
    return `/billing/thanks?plan=${encodeURIComponent(planId)}`
  }

  const origin = window.location?.origin ?? ''
  return `${origin}/billing/thanks?plan=${encodeURIComponent(planId)}`
}

function ensureWindow() {
  if (typeof window === 'undefined') {
    throw new Error('Billing checkout requires a browser environment')
  }
}

function toError(message: string, cause?: unknown) {
  const error = new Error(message)
  if (cause instanceof Error && 'cause' in error) {
    ;(error as Error & { cause?: Error }).cause = cause
  }
  return error
}

export async function startCheckout(planId: string, options: StartCheckoutOptions = {}) {
  const trimmedPlan = planId.trim()
  if (!trimmedPlan) {
    throw new Error('A plan identifier is required to start checkout')
  }

  const endpoint = resolveEndpoint(options.endpoint)
  const payload = {
    planId: trimmedPlan,
    returnUrl: buildReturnUrl(trimmedPlan, options.returnUrl),
    metadata: options.metadata ?? {},
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include',
    })
  } catch (error) {
    throw toError('Unable to reach the billing service. Please try again.', error)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    throw toError('Received an invalid response from the billing service.', error)
  }

  if (!response.ok) {
    const message = typeof (data as { message?: string })?.message === 'string'
      ? (data as { message: string }).message
      : 'The billing service rejected the request.'
    throw new Error(message)
  }

  const redirectUrl = typeof (data as { url?: string })?.url === 'string' ? (data as { url: string }).url : null
  if (!redirectUrl) {
    throw new Error('Billing service did not return a checkout URL.')
  }

  ensureWindow()
  window.location.assign(redirectUrl)
}
