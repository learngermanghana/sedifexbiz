import React from 'react'
import { describe, it, beforeEach, expect, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FIREBASE_CALLABLES } from '@shared/firebaseCallables'

const mocks = vi.hoisted(() => {
  const receiveStockMock = vi.fn()
  return {
    mockPublish: vi.fn(),
    queueCallableRequestMock: vi.fn(),
    loadCachedProductsMock: vi.fn(),
    saveCachedProductsMock: vi.fn(() => Promise.resolve()),
    receiveStockMock,
    httpsCallableMock: vi.fn(() => receiveStockMock),
    collectionMock: vi.fn((_db: unknown, path: string) => ({ path })),
    queryMock: vi.fn(() => ({})),
    orderByMock: vi.fn(() => ({})),
    limitFnMock: vi.fn(() => ({})),
    whereMock: vi.fn((field: string, op: string, value: unknown) => ({
      type: 'where',
      field,
      op,
      value,
    })),
    onSnapshotMock: vi.fn(),
  }
})

let snapshotListeners: Array<(snapshot: any) => void> = []

vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ publish: mocks.mockPublish }),
}))

const ACTIVE_STORE_ID = 'store-123'

vi.mock('../../context/ActiveStoreProvider', () => ({
  useActiveStoreContext: () => ({ storeId: ACTIVE_STORE_ID, storeChangeToken: 'token-abc' }),
}))

vi.mock('../../firebase', () => ({
  db: {},
  functions: {},
}))

vi.mock('firebase/functions', () => ({
  httpsCallable: mocks.httpsCallableMock,
}))

vi.mock('firebase/firestore', () => ({
  collection: mocks.collectionMock,
  query: mocks.queryMock,
  orderBy: mocks.orderByMock,
  limit: mocks.limitFnMock,
  where: mocks.whereMock,
  onSnapshot: (...args: any[]) => mocks.onSnapshotMock(...args),
}))

vi.mock('../../utils/offlineQueue', () => ({
  queueCallableRequest: mocks.queueCallableRequestMock,
}))

vi.mock('../../utils/offlineCache', () => ({
  loadCachedProducts: mocks.loadCachedProductsMock,
  saveCachedProducts: mocks.saveCachedProductsMock,
  PRODUCT_CACHE_LIMIT: 200,
}))

import Receive from '../Receive'

const {
  mockPublish,
  queueCallableRequestMock,
  loadCachedProductsMock,
  saveCachedProductsMock,
  receiveStockMock,
  httpsCallableMock,
  onSnapshotMock,
} = mocks

function expectStoreScopedQuery(
  collectionPath: string,
  storeId: string,
  additionalWhereClauses: Array<{ field: string; op: string; value: unknown }> = [],
) {
  const call = mocks.queryMock.mock.calls.find(([collectionRef]) => {
    const ref = collectionRef as { path?: string } | undefined
    return ref?.path === collectionPath
  })

  expect(call).toBeTruthy()
  const [, ...clauses] = (call ?? []) as Array<{ type?: string; field?: string; op?: string; value?: unknown }>
  const whereClauses = clauses.filter(clause => clause?.type === 'where')

  expect(whereClauses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'storeId', op: '==', value: storeId }),
      ...additionalWhereClauses.map(expected => expect.objectContaining(expected)),
    ]),
  )
  expect(whereClauses).toHaveLength(1 + additionalWhereClauses.length)
}

function createSnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    docs: docs.map(doc => ({
      id: doc.id,
      data: () => doc.data,
    })),
  }
}

async function emitSnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const listener = snapshotListeners[snapshotListeners.length - 1]
  if (!listener) throw new Error('No snapshot listener registered')
  await act(async () => {
    listener(createSnapshot(docs))
  })
}

async function setupAndRender() {
  render(<Receive />)
  await waitFor(() => {
    expectStoreScopedQuery('products', ACTIVE_STORE_ID)
  })
  await waitFor(() => {
    if (!snapshotListeners.length) {
      throw new Error('Listener not ready')
    }
  })
}

describe('Receive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    snapshotListeners = []
    loadCachedProductsMock.mockResolvedValue([])
    saveCachedProductsMock.mockResolvedValue()
    queueCallableRequestMock.mockResolvedValue(true)
    receiveStockMock.mockImplementation(() => Promise.reject(new TypeError('Network error')))
    httpsCallableMock.mockReturnValue(receiveStockMock)
    onSnapshotMock.mockImplementation((_query, callback) => {
      snapshotListeners.push(callback)
      return () => {}
    })
  })

  it('publishes a toast when receipts are queued offline', async () => {
    await setupAndRender()
    await emitSnapshot([
      {
        id: 'prod-1',
        data: { name: 'Widget', stockCount: 10 },
      },
    ])

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Product'), 'prod-1')
    await user.type(screen.getByLabelText('Quantity received'), '5')
    await user.type(screen.getByLabelText('Supplier'), 'Acme')
    await user.type(screen.getByLabelText('Reference number'), 'PO-1')
    await user.click(screen.getByRole('button', { name: 'Add stock' }))

    await waitFor(() =>
      expect(queueCallableRequestMock).toHaveBeenCalledWith(
        FIREBASE_CALLABLES.RECEIVE_STOCK,
        expect.objectContaining({ productId: 'prod-1', qty: 5, storeId: 'store-123' }),
        'receipt',
      ),
    )

    expect(mockPublish).toHaveBeenCalledWith({ message: 'Queued receipt • will sync', tone: 'success' })
    expect(screen.getByRole('status')).toHaveTextContent('Offline receipt saved.')
  })

  it('keeps optimistic stock until snapshots reconcile queued receipts', async () => {
    await setupAndRender()
    await emitSnapshot([
      {
        id: 'prod-1',
        data: { name: 'Widget', stockCount: 10 },
      },
    ])

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Product'), 'prod-1')
    await user.type(screen.getByLabelText('Quantity received'), '5')
    await user.type(screen.getByLabelText('Supplier'), 'Acme')
    await user.type(screen.getByLabelText('Reference number'), 'PO-1')
    await user.click(screen.getByRole('button', { name: 'Add stock' }))

    await waitFor(() =>
      expect(queueCallableRequestMock).toHaveBeenCalledWith(
        FIREBASE_CALLABLES.RECEIVE_STOCK,
        expect.objectContaining({ productId: 'prod-1', qty: 5, storeId: 'store-123' }),
        'receipt',
      ),
    )
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Widget (Stock 15)' })).toBeInTheDocument(),
    )

    await emitSnapshot([
      {
        id: 'prod-1',
        data: { name: 'Widget', stockCount: 12 },
      },
    ])

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Widget (Stock 15)' })).toBeInTheDocument(),
    )

    await emitSnapshot([
      {
        id: 'prod-1',
        data: { name: 'Widget', stockCount: 15 },
      },
    ])

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Widget (Stock 15)' })).toBeInTheDocument(),
    )
  })
})
