// web/src/pages/__tests__/SellPaystack.test.tsx
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Sell from '../Sell'

// ─────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────

const mockUseAuthUser = vi.fn()
vi.mock('../../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const mockUseActiveStore = vi.fn()
vi.mock('../../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

const mockUseSubscriptionStatus = vi.fn()
vi.mock('../../hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => mockUseSubscriptionStatus(),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('../../components/BarcodeScanner', () => ({
  __esModule: true,
  default: (props: { className?: string }) => (
    <div data-testid="mock-barcode-scanner" className={props.className} />
  ),
}))

// Offline cache / customers
const loadCachedProductsMock = vi.fn()
const saveCachedProductsMock = vi.fn()
const loadCachedCustomersMock = vi.fn()
const saveCachedCustomersMock = vi.fn()

// One product, simple VAT
const mockProducts = [
  { id: 'p1', name: 'Product One', price: 50, taxRate: 0.15, itemType: 'product', stockCount: 5 },
]

vi.mock('../../utils/offlineCache', () => ({
  PRODUCT_CACHE_LIMIT: 100,
  CUSTOMER_CACHE_LIMIT: 100,
  loadCachedProducts: (...args: unknown[]) => loadCachedProductsMock(...args),
  saveCachedProducts: (...args: unknown[]) => saveCachedProductsMock(...args),
  loadCachedCustomers: (...args: unknown[]) => loadCachedCustomersMock(...args),
  saveCachedCustomers: (...args: unknown[]) => saveCachedCustomersMock(...args),
}))

vi.mock('../../utils/customerLoyalty', () => ({
  ensureCustomerLoyalty: (customer: any) => ({
    ...customer,
    loyalty: { points: 100 },
  }),
}))

// Firestore
const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }))
const orderByMock = vi.fn((field: string, direction: string) => ({ field, direction }))
const limitMock = vi.fn((n: number) => ({ n }))
const onSnapshotMock = vi.fn()
const docMock = vi.fn((_db: unknown, path: string, id?: string) => ({
  path: id ? `${path}/${id}` : path,
}))
const getDocMock = vi.fn()
const addDocMock = vi.fn()
const serverTimestampMock = vi.fn(() => new Date())

vi.mock('firebase/firestore', () => ({
  Timestamp: class {},
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  orderBy: (...args: Parameters<typeof orderByMock>) => orderByMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  onSnapshot: (...args: Parameters<typeof onSnapshotMock>) => onSnapshotMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
  addDoc: (...args: Parameters<typeof addDocMock>) => addDocMock(...args),
  serverTimestamp: (...args: Parameters<typeof serverTimestampMock>) =>
    serverTimestampMock(...args),
}))

vi.mock('../../firebase', () => ({
  db: {},
  functions: {},
}))

// Capture commitSale callable
const mockCommitSaleCallable = vi.fn()

vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => {
    if (name === 'commitSale') {
      return mockCommitSaleCallable
    }
    // other functions (like logReceiptShare) can just be no-ops
    return vi.fn()
  },
}))

// capture Paystack usage
const mockPayWithPaystack = vi.fn()

vi.mock('../../lib/paystack', () => ({
  payWithPaystack: (...args: unknown[]) => mockPayWithPaystack(...args),
}))

vi.mock('../../utils/pdf', () => ({
  buildSimplePdf: () => new Uint8Array([1, 2, 3]),
}))

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const setupFirestoreForSell = () => {
  // store profile – not essential for these tests
  getDocMock.mockResolvedValue({ exists: () => false })

  loadCachedProductsMock.mockResolvedValue(mockProducts)
  loadCachedCustomersMock.mockResolvedValue([
    {
      id: 'c1',
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+233201234567',
    },
  ])

  onSnapshotMock.mockImplementation((queryRef, cb) => {
    const path = (queryRef as { ref?: { path?: string } } | undefined)?.ref?.path
    if (path === 'products') {
      const docs = mockProducts.map(p => ({
        id: p.id,
        data: () => p,
      }))
      cb({ docs })
    }
    if (path === 'customers') {
      cb({
        docs: [
          {
            id: 'c1',
            data: () => ({
              id: 'c1',
              name: 'John Doe',
              email: 'john@example.com',
              phone: '+233201234567',
            }),
          },
        ],
      })
    }
    return () => {}
  })
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('Sell – Paystack flows', () => {
  beforeEach(() => {
    loadCachedProductsMock.mockReset()
    saveCachedProductsMock.mockReset()
    loadCachedCustomersMock.mockReset()
    saveCachedCustomersMock.mockReset()
    collectionMock.mockClear()
    whereMock.mockClear()
    orderByMock.mockClear()
    limitMock.mockClear()
    onSnapshotMock.mockClear()
    docMock.mockClear()
    getDocMock.mockReset()
    addDocMock.mockReset()
    serverTimestampMock.mockReset()
    mockCommitSaleCallable.mockReset()
    mockPayWithPaystack.mockReset()

    mockUseAuthUser.mockReturnValue({
      uid: 'user-1',
      email: 'cashier@example.com',
      displayName: 'Cashier',
    })
    mockUseActiveStore.mockReturnValue({ storeId: 'store-1', isLoading: false, error: null })
    mockUseSubscriptionStatus.mockReturnValue({ isInactive: false })

    setupFirestoreForSell()

    Object.defineProperty(window.navigator, 'onLine', {
      value: true,
      configurable: true,
    })
  })

  it('uses Paystack for card/mobile payment and commits sale on success', async () => {
    mockPayWithPaystack.mockResolvedValueOnce({
      ok: true,
      reference: 'PS-OK',
      status: 'success',
    })

    mockCommitSaleCallable.mockResolvedValueOnce({
      data: { ok: true, saleId: 'SALE123' },
    })

    render(<Sell />)

    // Add product to cart
    const productButton = await screen.findByRole('button', { name: /product one/i })
    fireEvent.click(productButton)

    // Select customer
    const customerSelect = await screen.findByLabelText(/customer/i)
    fireEvent.change(customerSelect, { target: { value: 'c1' } })

    // Choose Paystack as payment method
    const paymentMethodSelect = screen.getByLabelText(/payment method/i)
    fireEvent.change(paymentMethodSelect, { target: { value: 'paystack' } })

    // Record the sale
    const recordButton = screen.getByRole('button', { name: /record sale/i })
    fireEvent.click(recordButton)

    await waitFor(() => {
      expect(mockPayWithPaystack).toHaveBeenCalledTimes(1)
      expect(mockCommitSaleCallable).toHaveBeenCalledTimes(1)
    })

    // Paystack call: first arg is amount (incl. VAT), second is buyer info
    const [amount, buyerInfo] = mockPayWithPaystack.mock.calls[0]
    expect(typeof amount).toBe('number')
    expect(amount).toBeGreaterThan(0)
    expect(buyerInfo).toMatchObject({
      email: 'john@example.com',
      phone: '+233201234567',
      name: 'John Doe',
    })

    // commitSale payload should carry Paystack provider info
    const [payload] = mockCommitSaleCallable.mock.calls[0]
    expect(payload.payment.method).toBe('card')
    expect(payload.payment.provider).toBe('paystack')
    expect(payload.payment.providerRef).toBe('PS-OK')
    expect(payload.payment.status).toBe('success')

    // Success UI
    expect(await screen.findByText(/sale recorded #sale123/i)).toBeInTheDocument()
  })

  it('shows an error and does not commit sale when Paystack fails', async () => {
    mockPayWithPaystack.mockResolvedValueOnce({
      ok: false,
      error: 'Card/Mobile payment was cancelled.',
    })

    render(<Sell />)

    const productButton = await screen.findByRole('button', { name: /product one/i })
    fireEvent.click(productButton)

    const customerSelect = await screen.findByLabelText(/customer/i)
    fireEvent.change(customerSelect, { target: { value: 'c1' } })

    const paymentMethodSelect = screen.getByLabelText(/payment method/i)
    fireEvent.change(paymentMethodSelect, { target: { value: 'paystack' } })

    const recordButton = screen.getByRole('button', { name: /record sale/i })
    fireEvent.click(recordButton)

    await waitFor(() => {
      expect(mockPayWithPaystack).toHaveBeenCalledTimes(1)
    })

    // Should not attempt to commit sale
    expect(mockCommitSaleCallable).not.toHaveBeenCalled()

    // Error message from Sell page
    expect(
      await screen.findByText(/card\/mobile payment was cancelled\./i),
    ).toBeInTheDocument()
  })
})
