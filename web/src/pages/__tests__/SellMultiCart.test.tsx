// web/src/pages/__tests__/SellMultiCart.test.tsx
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

// Avoid React Router issues
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

// Replace BarcodeScanner with a simple stub
vi.mock('../../components/BarcodeScanner', () => ({
  __esModule: true,
  default: (props: { className?: string }) => (
    <div data-testid="mock-barcode-scanner" className={props.className} />
  ),
}))

// Seed some products via offline cache + live snapshot mocks
const mockProducts = [
  { id: 'p1', name: 'Product One', price: 10, taxRate: 0.15, itemType: 'product', stockCount: 5 },
  { id: 'p2', name: 'Product Two', price: 20, taxRate: 0.15, itemType: 'product', stockCount: 5 },
]

const loadCachedProductsMock = vi.fn()
const saveCachedProductsMock = vi.fn()
const loadCachedCustomersMock = vi.fn()
const saveCachedCustomersMock = vi.fn()

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
    loyalty: { points: 0 },
  }),
}))

// Firestore mocks – enough to support Sell page queries
const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }))
const orderByMock = vi.fn((field: string, direction: string) => ({ field, direction }))
const limitMock = vi.fn((n: number) => ({ n }))
const onSnapshotMock = vi.fn()
const docMock = vi.fn((_db: unknown, path: string, id?: string) => ({
  path: id ? `${path}/${id}` : path,
}))
const getDocMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  Timestamp: class {},
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  orderBy: (...args: Parameters<typeof orderByMock>) => orderByMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  onSnapshot: (...args: Parameters<typeof onSnapshotMock>) => onSnapshotMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
}))

vi.mock('../../firebase', () => ({
  db: {},
  functions: {},
}))

// No-op callables / pdf in these tests
vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(async () => ({ data: { ok: true, saleId: 'SALE-1' } })),
}))

vi.mock('../../utils/pdf', () => ({
  buildSimplePdf: () => new Uint8Array([1, 2, 3]),
}))

// ─────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────

const setupFirestoreSnapshots = () => {
  // store profile – just return "no store profile"
  getDocMock.mockResolvedValue({ exists: () => false })

  // products + customers from offline cache and snapshot
  loadCachedProductsMock.mockResolvedValue(mockProducts)
  loadCachedCustomersMock.mockResolvedValue([])

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
      cb({ docs: [] })
    }
    return () => {}
  })
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('Sell – multi-cart persistence', () => {
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

    mockUseAuthUser.mockReturnValue({
      uid: 'user-1',
      email: 'cashier@example.com',
      displayName: 'Cashier',
    })
    mockUseActiveStore.mockReturnValue({ storeId: 'store-1', isLoading: false, error: null })
    mockUseSubscriptionStatus.mockReturnValue({ isInactive: false })

    setupFirestoreSnapshots()
  })

  it('keeps separate carts for each sale tab', async () => {
    render(<Sell />)

    // We expect at least one tab for Sale 1
    const sale1Tab = await screen.findByRole('button', { name: /sale 1/i })
    expect(sale1Tab).toBeInTheDocument()

    // Products should be visible
    const product1Button = await screen.findByRole('button', { name: /product one/i })
    const product2Button = await screen.findByRole('button', { name: /product two/i })

    // Add Product One to Sale 1
    fireEvent.click(product1Button)
    expect(await screen.findByText(/product one/i)).toBeInTheDocument()

    // Create Sale 2
    const newSaleButton = screen.getByRole('button', { name: /new sale/i })
    fireEvent.click(newSaleButton)

    const sale2Tab = screen.getByRole('button', { name: /sale 2/i })
    expect(sale2Tab).toBeInTheDocument()

    // Cart for Sale 2 should start empty
    expect(await screen.findByText(/cart is empty/i)).toBeInTheDocument()

    // Add Product Two to Sale 2
    fireEvent.click(product2Button)
    expect(await screen.findByText(/product two/i)).toBeInTheDocument()
    expect(screen.queryByText(/product one/i)).not.toBeInTheDocument()

    // Switch back to Sale 1 – Product One should still be there, Product Two not
    fireEvent.click(sale1Tab)

    await waitFor(() => {
      expect(screen.getByText(/product one/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/product two/i)).not.toBeInTheDocument()
  })

  it('starts each new sale with an empty cart', async () => {
    render(<Sell />)

    const product1Button = await screen.findByRole('button', { name: /product one/i })
    fireEvent.click(product1Button)
    expect(await screen.findByText(/product one/i)).toBeInTheDocument()

    // Add a new sale
    const newSaleButton = screen.getByRole('button', { name: /new sale/i })
    fireEvent.click(newSaleButton)

    // New sale cart is empty
    expect(await screen.findByText(/cart is empty/i)).toBeInTheDocument()
  })
})
