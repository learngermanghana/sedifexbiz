import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Products from '../Products'

const mockLoadCachedProducts = vi.fn(async () => [] as unknown[])
const mockSaveCachedProducts = vi.fn(async () => {})
const mockQueuePendingProductCreate = vi.fn(async () => {})
const mockQueuePendingProductUpdate = vi.fn(async () => {})
const mockListPendingProductOperations = vi.fn(async () => [] as unknown[])
const mockRemovePendingProductCreate = vi.fn(async () => {})
const mockRemovePendingProductUpdate = vi.fn(async () => {})
const mockReplacePendingProductUpdateId = vi.fn(async () => {})

vi.mock('../../utils/offlineCache', () => ({
  PRODUCT_CACHE_LIMIT: 200,
  loadCachedProducts: (...args: Parameters<typeof mockLoadCachedProducts>) =>
    mockLoadCachedProducts(...args),
  saveCachedProducts: (...args: Parameters<typeof mockSaveCachedProducts>) =>
    mockSaveCachedProducts(...args),
}))

vi.mock('../../utils/pendingProductQueue', () => ({
  listPendingProductOperations: (
    ...args: Parameters<typeof mockListPendingProductOperations>
  ) => mockListPendingProductOperations(...args),
  queuePendingProductCreate: (
    ...args: Parameters<typeof mockQueuePendingProductCreate>
  ) => mockQueuePendingProductCreate(...args),
  queuePendingProductUpdate: (
    ...args: Parameters<typeof mockQueuePendingProductUpdate>
  ) => mockQueuePendingProductUpdate(...args),
  removePendingProductCreate: (
    ...args: Parameters<typeof mockRemovePendingProductCreate>
  ) => mockRemovePendingProductCreate(...args),
  removePendingProductUpdate: (
    ...args: Parameters<typeof mockRemovePendingProductUpdate>
  ) => mockRemovePendingProductUpdate(...args),
  replacePendingProductUpdateId: (
    ...args: Parameters<typeof mockReplacePendingProductUpdateId>
  ) => mockReplacePendingProductUpdateId(...args),
}))

const mockUseActiveStore = vi.fn(() => ({
  storeId: 'store-1',
  workspaceId: 'store-1',
  workspaceSlug: 'workspace-1',
  isLoading: false,
  error: null,
}))
vi.mock('../../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const queryMock = vi.fn((collectionRef: { path: string }, ...clauses: unknown[]) => ({
  collection: collectionRef,
  clauses,
}))
const orderByMock = vi.fn((field: string, direction?: string) => ({ type: 'orderBy', field, direction }))
const limitMock = vi.fn((value: number) => ({ type: 'limit', value }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({
  type: 'where',
  field,
  op,
  value,
}))
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
const deleteDocMock = vi.fn(async () => {})
const serverTimestampMock = vi.fn(() => 'server-timestamp')
const setDocMock = vi.fn(async () => {})
const docMock = vi.fn((...args: unknown[]) => {
  if (args.length === 2) {
    const [collectionRef, id] = args as [{ path: string }, string]
    return { type: 'doc', path: `${collectionRef.path}/${id}` }
  }
  if (args.length === 3) {
    const [, collectionPath, id] = args as [unknown, string, string]
    return { type: 'doc', path: `${collectionPath}/${id}` }
  }
  return { type: 'doc', path: 'unknown' }
})

vi.mock('../../lib/db', () => ({
  db: {},
  rosterDb: { name: 'roster-db' },
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  orderBy: (...args: Parameters<typeof orderByMock>) => orderByMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  onSnapshot: (
    ...args: Parameters<typeof onSnapshotMock>
  ) => onSnapshotMock(...args),
  addDoc: (...args: Parameters<typeof addDocMock>) => addDocMock(...args),
  updateDoc: (...args: Parameters<typeof updateDocMock>) => updateDocMock(...args),
  deleteDoc: (...args: Parameters<typeof deleteDocMock>) => deleteDocMock(...args),
  serverTimestamp: (...args: Parameters<typeof serverTimestampMock>) => serverTimestampMock(...args),
  setDoc: (...args: Parameters<typeof setDocMock>) => setDocMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
}))

describe('Products page', () => {
  beforeEach(() => {
    mockLoadCachedProducts.mockReset()
    mockSaveCachedProducts.mockReset()
    mockQueuePendingProductCreate.mockReset()
    mockQueuePendingProductUpdate.mockReset()
    mockListPendingProductOperations.mockReset()
    mockRemovePendingProductCreate.mockReset()
    mockRemovePendingProductUpdate.mockReset()
    mockReplacePendingProductUpdateId.mockReset()
    collectionMock.mockClear()
    queryMock.mockClear()
    orderByMock.mockClear()
    limitMock.mockClear()
    onSnapshotMock.mockClear()
    addDocMock.mockClear()
    updateDocMock.mockClear()
    deleteDocMock.mockClear()
    serverTimestampMock.mockClear()
    setDocMock.mockClear()
    docMock.mockClear()
    whereMock.mockClear()
    mockUseActiveStore.mockReset()
    mockUseActiveStore.mockReturnValue({
      storeId: 'store-1',
      workspaceId: 'store-1',
      workspaceSlug: 'workspace-1',
      isLoading: false,
      error: null,
    })



    mockLoadCachedProducts.mockResolvedValue([])
    mockSaveCachedProducts.mockResolvedValue(undefined)
    mockListPendingProductOperations.mockResolvedValue([])
    mockRemovePendingProductCreate.mockResolvedValue(undefined)
    mockRemovePendingProductUpdate.mockResolvedValue(undefined)
    mockReplacePendingProductUpdateId.mockResolvedValue(undefined)
    onSnapshotMock.mockImplementation((queryRef, onNext) => {
      queueMicrotask(() => {
        onNext({ docs: [] })
      })
      return () => {}
    })
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

  it('focuses the search field when the user presses Ctrl+F', async () => {
    render(
      <MemoryRouter>
        <Products />
      </MemoryRouter>,
    )

    const searchInput = await screen.findByPlaceholderText(/search by product or sku/i)
    expect(searchInput).not.toHaveFocus()

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    expect(searchInput).toHaveFocus()
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
              price: 12,
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
    expect(within(productRow).getByText(/GHS 12\.00/)).toBeInTheDocument()
    expect(mockSaveCachedProducts).toHaveBeenCalled()
    await waitFor(() => expect(setDocMock).toHaveBeenCalled())
  })

  it('shows a placeholder when a product is missing a price', async () => {
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
            id: 'product-3',
            data: () => ({
              name: 'Unpriced Item',
              sku: 'UNP-01',
            }),
          },
        ],
      })
    })

    const productRow = await screen.findByTestId('product-row-product-3')
    const cells = within(productRow).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('—')
  })

  it('requires a valid price when creating a product', async () => {
    const user = userEvent.setup()
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
      snapshotHandler?.({ docs: [] })
    })

    await user.type(screen.getByLabelText('Name'), 'Incomplete Product')
    await user.type(screen.getByLabelText('SKU'), 'INC-01')
    await user.type(screen.getByLabelText('Price'), '-5')

    await user.click(screen.getByRole('button', { name: /add product/i }))

    expect(addDocMock).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/enter a valid price that is zero or greater/i),
    ).toBeInTheDocument()
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
    await user.type(screen.getByLabelText('Price'), '18')
    await user.type(screen.getByLabelText('Reorder point'), '4')
    await user.type(screen.getByLabelText('Opening stock'), '10')

    await user.click(screen.getByRole('button', { name: /add product/i }))

    expect(addDocMock).toHaveBeenCalled()
    expect(addDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'products' }),
      expect.objectContaining({
        name: 'New Blend',
        sku: 'NB-01',
        price: 18,
        reorderThreshold: 4,
        stockCount: 10,
        workspaceId: 'store-123',
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
              price: 18,
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

  it('saves price updates when editing a product', async () => {
    const user = userEvent.setup()
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
            id: 'product-9',
            data: () => ({
              name: 'Legacy Item',
              sku: 'LEG-01',
              price: 10,
              stockCount: 5,
            }),
          },
        ],
      })
    })

    const editButton = await screen.findByRole('button', { name: /edit/i })
    await user.click(editButton)

    const dialog = await screen.findByRole('dialog')
    const priceInput = within(dialog).getByLabelText('Price')
    await user.clear(priceInput)
    await user.type(priceInput, '20')

    const saveButton = within(dialog).getByRole('button', { name: /save changes/i })
    await user.click(saveButton)

    await waitFor(() => expect(updateDocMock).toHaveBeenCalledTimes(1))

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'products/product-9' }),
      expect.objectContaining({ price: 20 }),
    )
  })

  it('shows an error when an offline create cannot be queued', async () => {
    const user = userEvent.setup()
    let snapshotHandler: ((snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null
    onSnapshotMock.mockImplementation((queryRef, onNext) => {
      snapshotHandler = onNext
      return () => {}
    })

    const originalOnline = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    try {
      addDocMock.mockRejectedValueOnce(new TypeError('Network request failed'))
      mockQueuePendingProductCreate.mockRejectedValueOnce(new Error('queue failed'))

      render(
        <MemoryRouter>
          <Products />
        </MemoryRouter>,
      )

      await waitFor(() => expect(onSnapshotMock).toHaveBeenCalledTimes(1))

      await act(async () => {
        snapshotHandler?.({ docs: [] })
      })

      await user.type(screen.getByLabelText('Name'), 'Offline Only')
      await user.type(screen.getByLabelText('SKU'), 'OFF-01')
      await user.type(screen.getByLabelText('Price'), '12')

      await user.click(screen.getByRole('button', { name: /add product/i }))

      expect(addDocMock).toHaveBeenCalled()
      expect(mockQueuePendingProductCreate).toHaveBeenCalled()

      await waitFor(() => {
        expect(
          screen.getByText(
            /unable to create product while offline\. please try again when you reconnect\./i,
          ),
        ).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.queryByText('Syncing…')).not.toBeInTheDocument()
      })
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: originalOnline })
    }
  })

  it('restores previous values when an offline update cannot be queued', async () => {
    const user = userEvent.setup()
    let snapshotHandler: ((snap: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void) | null = null
    onSnapshotMock.mockImplementation((queryRef, onNext) => {
      snapshotHandler = onNext
      return () => {}
    })

    const originalOnline = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    try {
      updateDocMock.mockRejectedValueOnce(new TypeError('Network request failed'))
      mockQueuePendingProductUpdate.mockRejectedValueOnce(new Error('queue failed'))

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
              id: 'product-27',
              data: () => ({
                name: 'Queued Item',
                sku: 'QUE-01',
                price: 10,
                stockCount: 4,
              }),
            },
          ],
        })
      })

      const row = await screen.findByTestId('product-row-product-27')
      const editButton = within(row).getByRole('button', { name: /edit/i })
      await user.click(editButton)

      const dialog = await screen.findByRole('dialog')
      const priceInput = within(dialog).getByLabelText('Price')
      await user.clear(priceInput)
      await user.type(priceInput, '25')

      const saveButton = within(dialog).getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      expect(updateDocMock).toHaveBeenCalled()
      expect(mockQueuePendingProductUpdate).toHaveBeenCalled()

      await waitFor(() => {
        expect(
          screen.getByText(
            /unable to update product while offline\. please try again when you reconnect\./i,
          ),
        ).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(within(dialog).getByLabelText('Price')).toHaveValue('10')
      })
      expect(screen.queryByText('Syncing…')).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: originalOnline })
    }
  })

  it('deletes a product from the edit dialog when confirmed', async () => {
    const user = userEvent.setup()
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
            id: 'product-42',
            data: () => ({
              name: 'Disposable Item',
              sku: 'DISP-01',
              price: 8,
              stockCount: 3,
            }),
          },
        ],
      })
    })

    const editButton = await screen.findByRole('button', { name: /edit/i })
    await user.click(editButton)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const deleteButton = await screen.findByRole('button', { name: /delete product/i })
    await user.click(deleteButton)

    await waitFor(() => expect(deleteDocMock).toHaveBeenCalledTimes(1))
    expect(deleteDocMock).toHaveBeenCalledWith(expect.objectContaining({ path: 'products/product-42' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('product-row-product-42')).not.toBeInTheDocument())

    confirmSpy.mockRestore()
  })
})

