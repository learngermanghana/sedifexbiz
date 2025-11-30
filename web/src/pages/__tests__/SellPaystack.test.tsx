// tests/SellPaystack.test.tsx
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Sell from '../src/Sell'

// ─────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────

vi.mock('../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({
    uid: 'user-1',
    email: 'cashier@example.com',
    displayName: 'Cashier',
  }),
}))

vi.mock('../src/hooks/useActiveStore', () => ({
  useActiveStore: () => ({ storeId: 'store-1' }),
}))

vi.mock('../src/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ isInactive: false }),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}))

// Same mock products as before
const mockProducts = [
  { id: 'p1', name: 'Product One', price: 50, taxRate: 0.15, itemType: 'product', stockCount: 5 },
]

vi.mock('../src/utils/offlineCache', () => ({
  PRODUCT_CACHE_LIMIT: 100,
  CUSTOMER_CACHE_LIMIT: 100,
  loadCachedProducts: vi.fn(async () => mockProducts),
  saveCachedProducts: vi.fn(async () => undefined),
  loadCachedCustomers: vi.fn(async () => [
    {
      id: 'c1',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+233123456789',
    },
  ]),
  saveCachedCustomers: vi.fn(async () => undefined),
}))

vi.mock('../src/utils/customerLoyalty', () => ({
  ensureCustomerLoyalty: (customer: any) => ({
    ...customer,
    loyalty: { points: 100 }, // to make loyalty section sane
  }),
}))

// Firestore mocks
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<any>('firebase/firestore')
  return {
    ...actual,
    collection: vi.fn(() => ({})),
    where: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    onSnapshot: vi.fn((_q, cb) => {
      if (typeof cb === 'function') {
        const docs = mockProducts.map(p => ({
          id: p.id,
          data: () => p,
        }))
        cb({ docs })
      }
      return () => {}
    }),
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
    addDoc: vi.fn(async () => ({})),
    serverTimestamp: vi.fn(() => new Date()),
  }
})

// Capture the inner callable
const mockCallableImpl = vi.fn(async () => ({ data: { ok: true, saleId: 'SALE123' } }))

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_functions, name: string) => {
    if (name === 'commitSale') {
      return mockCallableImpl
    }
    return vi.fn()
  }),
}))

// Paystack mock
const mockPayWithPaystack = vi.fn()

vi.mock('../src/lib/paystack', () => ({
  payWithPaystack: (...args: any[]) => mockPayWithPaystack(...args),
}))

// PDF helper
vi.mock('../src/utils/pdf', () => ({
  buildSimplePdf: () => new Uint8Array([1, 2, 3]),
}))

// BarcodeScanner placeholder
vi.mock('../src/components/BarcodeScanner', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-barcode-scanner" />,
}))

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('Sell - Paystack flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // ensure navigator.onLine is true in tests
    Object.defineProperty(window.navigator, 'onLine', {
      value: true,
      configurable: true,
    })
  })

  it('uses Paystack for card/mobile payment and commits sale on success', async () => {
    mockPayWithPaystack.mockResolvedValueOnce({
      ok: true,
      reference: 'PS_OK',
      status: 'success',
    })

    render(<Sell />)

    // Add product to cart
    const productButton = await screen.findByRole('button', { name: /product one/i })
    fireEvent.click(productButton)

    // Select customer
    const customerSelect = await screen.findByLabelText(/customer/i)
    fireEvent.change(customerSelect, { target: { value: 'c1' } })

    // Change payment method to Paystack
    const paymentSelect = screen.getByLabelText(/payment method/i)
    fireEvent.change(paymentSelect, { target: { value: 'paystack' } })

    // Record sale
    const recordButton = screen.getByRole('button', { name: /record sale/i })
    fireEvent.click(recordButton)

    await waitFor(() => {
      expect(mockPayWithPaystack).toHaveBeenCalled()
      expect(mockCallableImpl).toHaveBeenCalled()
    })

    // Check Paystack call: amount should be totalDue (price + VAT)
    const [amount, buyer] = mockPayWithPaystack.mock.calls[0]
    expect(amount).toBeGreaterThan(0)
    expect(buyer).toMatchObject({
      email: 'john@example.com',
      phone: '+233123456789',
      name: 'John Doe',
    })

    // commitSale payload
    const [payload] = mockCallableImpl.mock.calls[0]
    expect(payload.payment.method).toBe('card')
    expect(payload.payment.provider).toBe('paystack')
    expect(payload.payment.providerRef).toBe('PS_OK')
    expect(payload.payment.status).toBe('success')

    // Success message appears
    const successMessage = await screen.findByText(/sale recorded #sale123/i)
    expect(successMessage).toBeInTheDocument()
  })

  it('shows error and does not commit sale when Paystack fails', async () => {
    mockPayWithPaystack.mockResolvedValueOnce({
      ok: false,
      error: 'Card/Mobile payment was cancelled.',
    })

    render(<Sell />)

    const productButton = await screen.findByRole('button', { name: /product one/i })
    fireEvent.click(productButton)

    const customerSelect = await screen.findByLabelText(/customer/i)
    fireEvent.change(customerSelect, { target: { value: 'c1' } })

    const paymentSelect = screen.getByLabelText(/payment method/i)
    fireEvent.change(paymentSelect, { target: { value: 'paystack' } })

    const recordButton = screen.getByRole('button', { name: /record sale/i })
    fireEvent.click(recordButton)

    await waitFor(() => {
      expect(mockPayWithPaystack).toHaveBeenCalled()
    })

    // commitSale should NOT be called
    expect(mockCallableImpl).not.toHaveBeenCalled()

    // Error message displayed
    const errorMessage = await screen.findByText(/card\/mobile payment was cancelled\./i)
    expect(errorMessage).toBeInTheDocument()
  })
})
