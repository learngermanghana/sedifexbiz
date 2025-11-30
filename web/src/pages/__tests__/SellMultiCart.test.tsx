// tests/SellMultiCart.test.tsx
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import Sell from '../src/Sell'

// ─────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────

vi.mock('../src/hooks/useAuthUser', () => ({
  useAuthUser: () => ({ uid: 'user-1', email: 'cashier@example.com', displayName: 'Cashier' }),
}))

vi.mock('../src/hooks/useActiveStore', () => ({
  useActiveStore: () => ({ storeId: 'store-1' }),
}))

vi.mock('../src/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ isInactive: false }),
}))

// Avoid React Router complaining
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}))

// Avoid real BarcodeScanner implementation; make it trigger nothing in these tests
vi.mock('../src/components/BarcodeScanner', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-barcode-scanner" />,
}))

// Mock offline cache to preload a couple of products
const mockProducts = [
  { id: 'p1', name: 'Product One', price: 10, taxRate: 0.15, itemType: 'product', stockCount: 5 },
  { id: 'p2', name: 'Product Two', price: 20, taxRate: 0.15, itemType: 'product', stockCount: 5 },
]

vi.mock('../src/utils/offlineCache', () => ({
  PRODUCT_CACHE_LIMIT: 100,
  CUSTOMER_CACHE_LIMIT: 100,
  loadCachedProducts: vi.fn(async () => mockProducts),
  saveCachedProducts: vi.fn(async () => undefined),
  loadCachedCustomers: vi.fn(async () => []),
  saveCachedCustomers: vi.fn(async () => undefined),
}))

// Mock Firestore reads to avoid real network usage
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<any>('firebase/firestore')
  return {
    ...actual,
    collection: vi.fn(() => ({})),
    where: vi.fn(() => ({})),
    orderBy: vi.fn(() => ({})),
    limit: vi.fn(() => ({})),
    onSnapshot: vi.fn((_q, cb) => {
      // For products, simulate snapshot with our mock products
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
  }
})

// Mock functions & Paystack so Sell doesn't explode in these tests
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn(async () => ({ data: { ok: true, saleId: 'SALE1' } }))),
}))

vi.mock('../src/lib/paystack', () => ({
  payWithPaystack: vi.fn(async () => ({
    ok: true,
    reference: 'PS_REF',
    status: 'success',
  })),
}))

// Build PDF + other utilities
vi.mock('../src/utils/pdf', () => ({
  buildSimplePdf: () => new Uint8Array([1, 2, 3]),
}))

vi.mock('../src/utils/customerLoyalty', () => ({
  ensureCustomerLoyalty: (customer: any) => ({
    ...customer,
    loyalty: { points: 0 },
  }),
}))

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('Sell - multi-cart persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps separate carts per sale tab', async () => {
    render(<Sell />)

    // There should be at least one sale tab "Sale 1"
    const sale1Tab = await screen.findByRole('button', { name: /sale 1/i })
    expect(sale1Tab).toBeInTheDocument()

    // The catalog should show our products
    const productOneButton = await screen.findByRole('button', { name: /product one/i })
    const productTwoButton = await screen.findByRole('button', { name: /product two/i })

    // Add Product One to Sale 1
    fireEvent.click(productOneButton)

    // Cart should show Product One
    const cartRowForP1 = await screen.findByText(/product one/i)
    expect(cartRowForP1).toBeInTheDocument()

    // Create new sale tab
    const newSaleButton = screen.getByRole('button', { name: /\+ new sale/i })
    fireEvent.click(newSaleButton)

    // We should now see "Sale 2" tab, and it should be active
    const sale2Tab = screen.getByRole('button', { name: /sale 2/i })
    expect(sale2Tab).toBeInTheDocument()

    // Cart for Sale 2 should start empty
    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument()

    // Add Product Two to Sale 2
    fireEvent.click(productTwoButton)

    // Now cart shows Product Two but not Product One
    const rowP2 = await screen.findByText(/product two/i)
    expect(rowP2).toBeInTheDocument()
    expect(screen.queryByText(/product one/i)).not.toBeInTheDocument()

    // Switch back to Sale 1 and ensure Product One is still there
    fireEvent.click(sale1Tab)
    const rowP1Back = await screen.findByText(/product one/i)
    expect(rowP1Back).toBeInTheDocument()
    expect(screen.queryByText(/product two/i)).not.toBeInTheDocument()
  })

  it('new sale starts with an empty cart', async () => {
    render(<Sell />)

    const productOneButton = await screen.findByRole('button', { name: /product one/i })
    fireEvent.click(productOneButton)

    const firstCartRow = await screen.findByText(/product one/i)
    expect(firstCartRow).toBeInTheDocument()

    // Add a new sale
    fireEvent.click(screen.getByRole('button', { name: /\+ new sale/i }))

    // Verify cart is empty for the new sale
    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument()
  })
})
