import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PAYSTACK_PK = 'pk_test_demo'

describe('paystack loader', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a helpful error when the public key is missing', async () => {
    vi.mock('../config/paystackEnv', () => ({ paystackEnv: { publicKey: null } }))

    const { payWithPaystack } = await import('./paystack')
    const result = await payWithPaystack(10)

    expect(result.ok).toBe(false)
    expect(result.reference).toBeNull()
    expect(result.error).toMatch(/not configured/i)
  })

  it('falls back gracefully when the Paystack script fails to load', async () => {
    vi.mock('../config/paystackEnv', () => ({ paystackEnv: { publicKey: PAYSTACK_PK } }))

    const appendSpy = vi.spyOn(document.body, 'appendChild')
    appendSpy.mockImplementation(element => {
      const script = element as HTMLScriptElement
      queueMicrotask(() => {
        script.onerror?.(new Event('error'))
      })
      return element
    })

    const { payWithPaystack } = await import('./paystack')
    const result = await payWithPaystack(20, { email: 'buyer@example.com' })

    expect(result.ok).toBe(false)
    expect(result.reference).toBeNull()
    expect(result.error).toMatch(/load Paystack checkout/i)
  })
})
