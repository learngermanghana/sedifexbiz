import { describe, expect, it, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import Sell from './Sell'

const mockUseAuthUser = vi.fn()
vi.mock('../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const mockUseActiveStoreContext = vi.fn()
vi.mock('../context/ActiveStoreProvider', () => ({
  useActiveStoreContext: () => mockUseActiveStoreContext(),
}))

const mockLoadCachedProducts = vi.fn(async () => [] as unknown[])
const mockSaveCachedProducts = vi.fn(async () => {})
const mockLoadCachedCustomers = vi.fn(async () => [] as unknown[])
const mockSaveCachedCustomers = vi.fn(async () => {})

vi.mock('../utils/offlineCache', () => ({
  PRODUCT_CACHE_LIMIT: 200,
  CUSTOMER_CACHE_LIMIT: 200,
  loadCachedProducts: (
    ...args: Parameters<typeof mockLoadCachedProducts>
  ) => mockLoadCachedProducts(...args),
  saveCachedProducts: (
    ...args: Parameters<typeof mockSaveCachedProducts>
  ) => mockSaveCachedProducts(...args),
  loadCachedCustomers: (
    ...args: Parameters<typeof mockLoadCachedCustomers>
  ) => mockLoadCachedCustomers(...args),
  saveCachedCustomers: (
    ...args: Parameters<typeof mockSaveCachedCustomers>
  ) => mockSaveCachedCustomers(...args),
}))

const mockPublish = vi.fn()
vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ publish: mockPublish }),
}))

const mockQueueCallableRequest = vi.fn(async () => false)
vi.mock('../utils/offlineQueue', () => ({
  queueCallableRequest: (
    ...args: Parameters<typeof mockQueueCallableRequest>
  ) => mockQueueCallableRequest(...args),
}))

vi.mock('../firebase', () => ({
  db: {},
  functions: {},
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const queryMock = vi.fn((collectionRef: { path: string }, ...clauses: unknown[]) => ({
  type: 'query',
  collection: collectionRef,
  clauses,
}))
const orderByMock = vi.fn((field: string, direction?: string) => ({ type: 'orderBy', field, direction }))
const limitMock = vi.fn((value: number) => ({ type: 'limit', value }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }))

let snapshotListeners: Record<string, ((snap: any) => void)[]> = {}

function emitSnapshot(path: string, docs: Array<{ id: string; data: () => unknown }>) {
  const listeners = snapshotListeners[path] ?? []
  const snapshot = {
    docs: docs.map(doc => ({ id: doc.id, data: doc.data })),
  }
  listeners.forEach(listener => listener(snapshot))
}

const onSnapshotMock = vi.fn((queryRef: { collection: { path: string } }, callback: (snap: unknown) => void) => {
  const path = queryRef.collection.path
  snapshotListeners[path] = snapshotListeners[path] ?? []
  snapshotListeners[path].push(callback)
  queueMicrotask(() => {
    if (path === 'products') {
      emitSnapshot('products', productDocs)
    }
    if (path === 'customers') {
      emitSnapshot('customers', customerDocs)
    }
  })
  return () => {
    snapshotListeners[path] = (snapshotListeners[path] ?? []).filter(listener => listener !== callback)
  }
})

let autoCounters: Record<string, number> = {}
const docMock = vi.fn((...args: unknown[]) => {
  if (args.length === 1) {
    const collectionRef = args[0] as { path: string }
    const collectionPath = collectionRef.path
    if (collectionPath === 'sales') {
      return { type: 'doc', path: 'sales/sale-42', id: 'sale-42', collectionPath }
    }
    autoCounters[collectionPath] = (autoCounters[collectionPath] ?? 0) + 1
    const prefixMap: Record<string, string> = {
      saleItems: 'sale-item',
      stock: 'stock-entry',
      ledger: 'ledger-entry',
    }
    const prefix = prefixMap[collectionPath] ?? `${collectionPath}-auto`
    const id = `${prefix}-${autoCounters[collectionPath]}`
    return { type: 'doc', path: `${collectionPath}/${id}`, id, collectionPath }
  }

  if (args.length === 3) {
    const [, collectionPath, id] = args as [unknown, string, string]
    return { type: 'doc', path: `${collectionPath}/${id}`, id, collectionPath }
  }

  throw new Error('Unsupported doc invocation in test mock')
})

vi.mock('firebase/firestore', () => ({
  collection: (
    ...args: Parameters<typeof collectionMock>
  ) => collectionMock(...args),
  query: (
    ...args: Parameters<typeof queryMock>
  ) => queryMock(...args),
  orderBy: (
    ...args: Parameters<typeof orderByMock>
  ) => orderByMock(...args),
  limit: (
    ...args: Parameters<typeof limitMock>
  ) => limitMock(...args),
  where: (
    ...args: Parameters<typeof whereMock>
  ) => whereMock(...args),
  doc: (
    ...args: Parameters<typeof docMock>
  ) => docMock(...args),
  onSnapshot: (
    ...args: Parameters<typeof onSnapshotMock>
  ) => onSnapshotMock(...args),
}))

const mockCallable = vi.fn(async () => ({ data: { ok: true } }))
const mockHttpsCallable = vi.fn(() => mockCallable)

vi.mock('firebase/functions', () => ({
  httpsCallable: (
    ...args: Parameters<typeof mockHttpsCallable>
  ) => mockHttpsCallable(...args),
}))

function renderWithProviders(ui: ReactElement) {
  return render(ui, { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> })
}

let productDocs: Array<{ id: string; data: () => unknown }> = []
let customerDocs: Array<{ id: string; data: () => unknown }> = []

const originalCreateObjectURL = globalThis.URL.createObjectURL
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL

beforeAll(() => {
  ;(globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock-url')
  ;(globalThis.URL as any).revokeObjectURL = vi.fn()
})

afterAll(() => {
  ;(globalThis.URL as any).createObjectURL = originalCreateObjectURL
  ;(globalThis.URL as any).revokeObjectURL = originalRevokeObjectURL
})

afterEach(() => {
  if (typeof window !== 'undefined') {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  }
})

describe('Sell page', () => {
  beforeEach(() => {
    mockUseAuthUser.mockReset()
    mockUseActiveStoreContext.mockReset()
    mockUseAuthUser.mockReturnValue({
      uid: 'cashier-123',
      email: 'cashier@example.com',
    })
    mockUseActiveStoreContext.mockReturnValue({
      storeId: 'store-1',
      isLoading: false,
      error: null,
      memberships: [],
      membershipsLoading: false,
      setActiveStoreId: vi.fn(),
      storeChangeToken: 0,
    })

    productDocs = [
      {
        id: 'product-1',
        data: () => ({ id: 'product-1', name: 'Iced Coffee', price: 12, stockCount: 5 }),
      },
      {
        id: 'product-2',
        data: () => ({ id: 'product-2', name: 'Mystery Item' }),
      },
    ]

    customerDocs = [
      {
        id: 'customer-1',
        data: () => ({ id: 'customer-1', name: 'Ada Lovelace', phone: '+233200000000' }),
      },
    ]

    snapshotListeners = {}
    autoCounters = {}
    mockLoadCachedProducts.mockReset()
    mockLoadCachedCustomers.mockReset()
    mockSaveCachedProducts.mockReset()
    mockSaveCachedCustomers.mockReset()
    mockLoadCachedProducts.mockResolvedValue([])
    mockLoadCachedCustomers.mockResolvedValue([])
    mockSaveCachedProducts.mockResolvedValue(undefined)
    mockSaveCachedCustomers.mockResolvedValue(undefined)

    collectionMock.mockClear()
    queryMock.mockClear()
    orderByMock.mockClear()
    limitMock.mockClear()
    whereMock.mockClear()
    docMock.mockClear()
    onSnapshotMock.mockClear()
    mockCallable.mockClear()
    mockHttpsCallable.mockClear()
    mockHttpsCallable.mockReturnValue(mockCallable)
    mockCallable.mockResolvedValue({ data: { ok: true } })
    mockQueueCallableRequest.mockReset()
    mockQueueCallableRequest.mockResolvedValue(false)
    mockPublish.mockReset()
  })

  it('records a cash sale via callable and updates stock optimistically', async () => {
    const user = userEvent.setup()

    renderWithProviders(<Sell />)

    const productButton = await screen.findByRole('button', { name: /iced coffee/i })
    await user.click(productButton)

    const cashInput = screen.getByLabelText(/cash received/i)
    await user.clear(cashInput)
    await user.type(cashInput, '15')

    const recordButton = screen.getByRole('button', { name: /record sale/i })
    await user.click(recordButton)

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledTimes(1)
    })

    const payload = mockCallable.mock.calls[0][0]
    expect(payload.storeId).toBe('store-1')
    expect(payload.saleId).toBe('sale-42')
    expect(payload.tenders).toEqual({ cash: 15 })
    expect(payload.items).toEqual([
      expect.objectContaining({ productId: 'product-1', qty: 1, price: 12 }),
    ])

    expect(await screen.findByText(/Sale #\s*sale-42/i)).toBeInTheDocument()
    expect(await screen.findByText(/Cart is empty/i)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(await screen.findByText(/Stock 4/)).toBeInTheDocument()
  })

  it('shows a friendly error when the callable rejects', async () => {
    mockCallable.mockRejectedValueOnce(new Error('Validation failed'))
    const user = userEvent.setup()

    renderWithProviders(<Sell />)

    const productButton = await screen.findByRole('button', { name: /iced coffee/i })
    await user.click(productButton)

    const cashInput = screen.getByLabelText(/cash received/i)
    await user.clear(cashInput)
    await user.type(cashInput, '12')

    const recordButton = screen.getByRole('button', { name: /record sale/i })
    await user.click(recordButton)

    expect(await screen.findByText(/Validation failed/i)).toBeInTheDocument()
    expect(mockQueueCallableRequest).not.toHaveBeenCalled()
  })

  it('queues the sale when offline and notifies the user', async () => {
    mockCallable.mockRejectedValueOnce(new Error('Network error'))
    mockQueueCallableRequest.mockResolvedValueOnce(true)
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    const user = userEvent.setup()

    renderWithProviders(<Sell />)

    const productButton = await screen.findByRole('button', { name: /iced coffee/i })
    await user.click(productButton)

    const cashInput = screen.getByLabelText(/cash received/i)
    await user.clear(cashInput)
    await user.type(cashInput, '12')

    const recordButton = screen.getByRole('button', { name: /record sale/i })
    await user.click(recordButton)

    await waitFor(() => {
      expect(mockQueueCallableRequest).toHaveBeenCalledWith('recordSale', expect.any(Object), 'sale')
    })

    expect(mockPublish).toHaveBeenCalledWith({ message: 'Queued sale • will sync' })
    expect(await screen.findByText(/Sale #\s*sale-42/i)).toBeInTheDocument()
    expect(await screen.findByText(/Cart is empty/i)).toBeInTheDocument()
    expect(await screen.findByText(/Stock 4/)).toBeInTheDocument()
  })

  it('clears optimistic stock deltas when product snapshots update', async () => {
    const user = userEvent.setup()

    renderWithProviders(<Sell />)

    const productButton = await screen.findByRole('button', { name: /iced coffee/i })
    await user.click(productButton)

    const cashInput = screen.getByLabelText(/cash received/i)
    await user.clear(cashInput)
    await user.type(cashInput, '12')

    const recordButton = screen.getByRole('button', { name: /record sale/i })
    await user.click(recordButton)

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledTimes(1)
    })

    expect(await screen.findByText(/Stock 4/)).toBeInTheDocument()

    productDocs = [
      {
        id: 'product-1',
        data: () => ({ id: 'product-1', name: 'Iced Coffee', price: 12, stockCount: 4 }),
      },
    ]
    emitSnapshot('products', productDocs)

    expect(await screen.findByText(/Stock 4/)).toBeInTheDocument()
    expect(mockQueueCallableRequest).not.toHaveBeenCalled()
  })
})
