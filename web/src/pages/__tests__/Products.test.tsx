import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Products from '../Products'

const mockUseActiveStore = vi.fn()
vi.mock('../../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

const mockLoadCachedProducts = vi.fn(async () => [] as unknown[])
const mockSaveCachedProducts = vi.fn(async () => {})

vi.mock('../../utils/offlineCache', () => ({
  PRODUCT_CACHE_LIMIT: 200,
  loadCachedProducts: (...args: Parameters<typeof mockLoadCachedProducts>) =>
    mockLoadCachedProducts(...args),
  saveCachedProducts: (...args: Parameters<typeof mockSaveCachedProducts>) =>
    mockSaveCachedProducts(...args),
}))

vi.mock('../../firebase', () => ({
  db: {},
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const queryMock = vi.fn((collectionRef: { path: string }, ...clauses: unknown[]) => ({
  collection: collectionRef,
  clauses,
}))
const whereMock = vi.fn((...args: unknown[]) => ({ type: 'where', args }))
const orderByMock = vi.fn((field: string, direction?: string) => ({ type: 'orderBy', field, direction }))
const limitMock = vi.fn((value: number) => ({ type: 'limit', value }))
const onSnapshotMock = vi.fn(
  (
    queryRef: { collection: { path: string } },
    onNext: (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
  ) => {
    queueMicrotask(() => {
      onNext({ docs: [] })
    })
    return () => {}
  },
)
const addDocMock = vi.fn()
const updateDocMock = vi.fn(async () => {})
const serverTimestampMock = vi.fn(() => 'server-timestamp')
const docMock = vi.fn((collectionRef: { path: string }, id: string) => ({
  type: 'doc',
  path: `${collectionRef.path}/${id}`,
}))

vi.mock('firebase/firestore', () => ({
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  orderBy: (...args: Parameters<typeof orderByMock>) => orderByMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  onSnapshot: (
    ...args: Parameters<typeof onSnapshotMock>
  ) => onSnapshotMock(...args),
  addDoc: (...args: Parameters<typeof addDocMock>) => addDocMock(...args),
  updateDoc: (...args: Parameters<typeof updateDocMock>) => updateDocMock(...args),
  serverTimestamp: (...args: Parameters<typeof serverTimestampMock>) => serverTimestampMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
}))

describe('Products page', () => {
  beforeEach(() => {
    mockUseActiveStore.mockReset()
    mockLoadCachedProducts.mockReset()
    mockSaveCachedProducts.mockReset()
    collectionMock.mockClear()
    queryMock.mockClear()
    whereMock.mockClear()
    orderByMock.mockClear()
    limitMock.mockClear()
    onSnapshotMock.mockClear()
    addDocMock.mockClear()
    updateDocMock.mockClear()
    serverTimestampMock.mockClear()
    docMock.mockClear()

    mockUseActiveStore.mockReturnValue({
      storeId: 'store-1',
      stores: ['store-1'],
      isLoading: false,
      error: null,
      selectStore: vi.fn(),
      resolveStoreAccess: vi.fn().mockResolvedValue({ ok: false, error: null }),
      needsStoreResolution: false,
      isResolvingStoreAccess: false,
      resolutionError: null,
    })

    mockLoadCachedProducts.mockResolvedValue([])
    mockSaveCachedProducts.mockResolvedValue(undefined)
    onSnapshotMock.mockImplementation((queryRef, onNext) => {
      queueMicrotask(() => {
        onNext({ docs: [] })
      })
      return () => {}
    })
  })

  it('renders store loading state', () => {
    mockUseActiveStore.mockReturnValue({
      storeId: null,
      stores: [],
      isLoading: true,
      error: null,
      selectStore: vi.fn(),
      resolveStoreAccess: vi.fn().mockResolvedValue({ ok: false, error: null }),
      needsStoreResolution: false,
      isResolvingStoreAccess: false,
      resolutionError: null,
    })

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an empty state when no products are available', async () => {
    let snapshotHandler: ((snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null
    onSnapshotMock.mockImplementation((queryRef, onNext) => {
      snapshotHandler = onNext
      return () => {}
    })

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(onSnapshotMock).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      snapshotHandler?.({ docs: [] })
    })

    await waitFor(() => {
      expect(screen.getByText(/no products found/i)).toBeInTheDocument()
    })
  })

  it('renders inventory details from the subscription', async () => {
    let snapshotHandler: ((snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null
    onSnapshotMock.mockImplementation((queryRef, onNext) => {
      snapshotHandler = onNext
      return () => {}
    })

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>,
    )

    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      snapshotHandler?.({
        docs: [
          {
            id: 'product-1',
            data: () => ({
              name: 'Iced Coffee',
              sku: 'COF-01',
              stockCount: 2,
              reorderThreshold: 5,
              lastReceipt: { qty: 12, supplier: 'ACME' },
            }),
          },
        ],
      })
    })

    const productRow = await screen.findByTestId('product-row-product-1')
    expect(productRow).toHaveTextContent('Iced Coffee')
    expect(within(productRow).getByText(/low stock/i)).toBeInTheDocument()
    expect(mockSaveCachedProducts).toHaveBeenCalled()
  })

  it('optimistically renders a newly created product', async () => {
    const user = userEvent.setup()
    let snapshotHandler: ((snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null
    onSnapshotMock.mockImplementation((queryRef, onNext) => {
      snapshotHandler = onNext
      return () => {}
    })

    let resolveAddDoc: ((value: { id: string }) => void) | null = null
    addDocMock.mockImplementation(async (...args: unknown[]) => {
      return new Promise<{ id: string }>(resolve => {
        resolveAddDoc = resolve
      })
    })

    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>,
    )

    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      snapshotHandler?.({ docs: [] })
    })

    await user.type(screen.getByLabelText('Name'), 'New Blend')
    await user.type(screen.getByLabelText('SKU'), 'NB-01')
    await user.type(screen.getByLabelText('Reorder point'), '4')
    await user.type(screen.getByLabelText('Opening stock'), '10')

    await user.click(screen.getByRole('button', { name: /add product/i }))

    expect(addDocMock).toHaveBeenCalled()
    expect(addDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'products' }),
      expect.objectContaining({
        storeId: 'store-1',
        name: 'New Blend',
        sku: 'NB-01',
        reorderThreshold: 4,
        stockCount: 10,
      }),
    )
    expect(screen.getByText('Syncing…')).toBeInTheDocument()

    await act(async () => {
      resolveAddDoc?.({ id: 'product-2' })
    })

    await waitFor(() => {
      expect(screen.getByText('Product created successfully.')).toBeInTheDocument()
    })

    await act(async () => {
      snapshotHandler?.({
        docs: [
          {
            id: 'product-2',
            data: () => ({
              name: 'New Blend',
              sku: 'NB-01',
              stockCount: 10,
              reorderThreshold: 4,
            }),
          },
        ],
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('Syncing…')).not.toBeInTheDocument()
      expect(screen.getByText('New Blend')).toBeInTheDocument()
    })
  })
})

