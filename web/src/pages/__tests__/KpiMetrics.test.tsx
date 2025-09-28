import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import KpiMetrics from '../KpiMetrics'
import Shell from '../../layout/Shell'

const mockLoadCachedSales = vi.fn(async () => [] as unknown[])
const mockSaveCachedSales = vi.fn(async () => {})
const mockLoadCachedProducts = vi.fn(async () => [] as unknown[])
const mockSaveCachedProducts = vi.fn(async () => {})
const mockLoadCachedCustomers = vi.fn(async () => [] as unknown[])
const mockSaveCachedCustomers = vi.fn(async () => {})

vi.mock('../../utils/offlineCache', () => ({
  SALES_CACHE_LIMIT: 200,
  PRODUCT_CACHE_LIMIT: 200,
  CUSTOMER_CACHE_LIMIT: 200,
  loadCachedSales: (...args: Parameters<typeof mockLoadCachedSales>) => mockLoadCachedSales(...args),
  saveCachedSales: (...args: Parameters<typeof mockSaveCachedSales>) => mockSaveCachedSales(...args),
  loadCachedProducts: (...args: Parameters<typeof mockLoadCachedProducts>) => mockLoadCachedProducts(...args),
  saveCachedProducts: (...args: Parameters<typeof mockSaveCachedProducts>) => mockSaveCachedProducts(...args),
  loadCachedCustomers: (...args: Parameters<typeof mockLoadCachedCustomers>) => mockLoadCachedCustomers(...args),
  saveCachedCustomers: (...args: Parameters<typeof mockSaveCachedCustomers>) => mockSaveCachedCustomers(...args),
}))

const mockUseAuthUser = vi.fn(() => ({ uid: 'user-1', email: 'manager@example.com' }))
vi.mock('../../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const mockUseActiveStore = vi.fn(() => ({ storeId: 'store-1', isLoading: false, error: null }))
vi.mock('../../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

const mockPublish = vi.fn()
vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ publish: mockPublish }),
}))

vi.mock('../../firebase', () => ({
  db: {},
  auth: {},
}))

vi.mock('firebase/auth', () => ({
  signOut: vi.fn(),
}))

vi.mock('../../hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: () => ({
    isOnline: true,
    isReachable: true,
    isChecking: false,
    lastHeartbeatAt: null,
    heartbeatError: null,
    queue: { status: 'idle', pending: 0, lastError: null, updatedAt: null },
  }),
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }))
const orderByMock = vi.fn((field: string, direction?: string) => ({ type: 'orderBy', field, direction }))
const limitMock = vi.fn((value: number) => ({ type: 'limit', value }))
const queryMock = vi.fn((collectionRef: { path: string }, ...clauses: unknown[]) => ({
  type: 'query',
  collection: collectionRef,
  clauses,
}))

const docMock = vi.fn((dbRef: unknown, path: string, id?: string) => ({
  type: 'doc',
  path: id ? `${path}/${id}` : path,
}))

const setDocMock = vi.fn(async () => {})

const onSnapshotMock = vi.fn(
  (
    ref: { type: 'collection'; collection?: { path: string } } | { type: 'query'; collection: { path: string } } | { type: 'doc'; path: string },
    onNext: (snapshot: any) => void,
  ) => {
    queueMicrotask(() => {
      if (ref.type === 'doc') {
        const now = new Date()
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        onNext({
          data: () => ({
            monthly: {
              [monthKey]: { revenueTarget: 1000, customerTarget: 20 },
            },
          }),
        })
        return
      }

      const path = ref.type === 'query' ? ref.collection.path : ref.collection?.path
      if (path === 'sales') {
        onNext({
          docs: [
            {
              id: 'sale-1',
              data: () => ({
                total: 120,
                createdAt: new Date(),
                items: [
                  { productId: 'product-1', name: 'T-Shirt', qty: 3, price: 40 },
                ],
              }),
            },
          ],
        })
        return
      }

      if (path === 'products') {
        onNext({
          docs: [
            {
              id: 'product-1',
              data: () => ({ name: 'T-Shirt', price: 40, stockCount: 2, minStock: 5 }),
            },
          ],
        })
        return
      }

      if (path === 'customers') {
        onNext({
          docs: [
            {
              id: 'customer-1',
              data: () => ({ name: 'Akwasi', createdAt: new Date() }),
            },
          ],
        })
      }
    })
    return () => {}
  },
)

vi.mock('firebase/firestore', () => ({
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  orderBy: (...args: Parameters<typeof orderByMock>) => orderByMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  onSnapshot: (...args: Parameters<typeof onSnapshotMock>) => onSnapshotMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  setDoc: (...args: Parameters<typeof setDocMock>) => setDocMock(...args),
}))

describe('KPI & Metrics page', () => {
  beforeEach(() => {
    mockLoadCachedSales.mockReset()
    mockSaveCachedSales.mockReset()
    mockLoadCachedProducts.mockReset()
    mockSaveCachedProducts.mockReset()
    mockLoadCachedCustomers.mockReset()
    mockSaveCachedCustomers.mockReset()
    collectionMock.mockClear()
    whereMock.mockClear()
    orderByMock.mockClear()
    limitMock.mockClear()
    queryMock.mockClear()
    docMock.mockClear()
    setDocMock.mockClear()
    onSnapshotMock.mockClear()
    mockPublish.mockReset()
    mockUseAuthUser.mockReset()
    mockUseAuthUser.mockReturnValue({ uid: 'user-1', email: 'manager@example.com' })
    mockUseActiveStore.mockReset()
    mockUseActiveStore.mockReturnValue({ storeId: 'store-1', isLoading: false, error: null })

    mockLoadCachedSales.mockResolvedValue([])
    mockLoadCachedProducts.mockResolvedValue([])
    mockLoadCachedCustomers.mockResolvedValue([])
    mockSaveCachedSales.mockResolvedValue(undefined)
    mockSaveCachedProducts.mockResolvedValue(undefined)
    mockSaveCachedCustomers.mockResolvedValue(undefined)
  })

  it('renders revenue KPI for the metrics route', async () => {
    render(
      <MemoryRouter initialEntries={['/metrics']}>
        <Routes>
          <Route path="/metrics" element={<Shell><KpiMetrics /></Shell>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled())

    const revenueValues = await screen.findAllByText(/GHS 120\.00/)
    expect(revenueValues.length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Inventory alerts/i)[0]).toBeInTheDocument()
    expect(screen.getAllByText(/Team callouts/i)[0]).toBeInTheDocument()
  })
})
