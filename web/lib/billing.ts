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

  // Use any-cast so TypeScript doesn't complain about the env property
  const envEndpoint =
    typeof import.meta !== 'undefined'
      ? (import.meta as any).env?.VITE_BILLING_CHECKOUT_ENDPOINT
      : null

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

  const url = new URL(window.location.origin + '/billing/thanks')
  url.searchParams.set('plan', planId)
  return url.toString()
}

function ensureWindow() {
  if (typeof window === 'undefined') {
    throw new Error('Billing checkout requires a browser environment')
  }
}

function toError(message: string, cause: unknown) {
  const error = new Error(message)
  ;(error as any).cause = cause
  return error
}

export async function startCheckout(
  planId: string,
  options: StartCheckoutOptions = {},
): Promise<void> {
  const endpoint = resolveEndpoint(options.endpoint)
  const returnUrl = buildReturnUrl(planId, options.returnUrl)

  const payload = {
    planId,
    returnUrl,
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

  let data: any
  try {
    data = await response.json()
  } catch (error) {
    throw toError('Billing service returned an invalid response.', error)
  }

  if (!response.ok) {
    const message =
      (data && typeof data.message === 'string' && data.message) ||
      'The billing service rejected the request.'
    throw new Error(message)
  }

  const redirectUrl =
    data && typeof data.url === 'string' ? (data.url as string) : null
  if (!redirectUrl) {
    throw new Error('Billing service did not return a checkout URL.')
  }

  ensureWindow()
  window.location.assign(redirectUrl)
}
