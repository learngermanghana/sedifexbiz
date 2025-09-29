import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import Today, { formatDateKey } from '../Today'

const mockUseActiveStoreContext = vi.fn(() => ({
  storeId: 'store-123',
  isLoading: false,
  error: null,
}))

vi.mock('../../context/ActiveStoreProvider', () => ({
  useActiveStoreContext: () => mockUseActiveStoreContext(),
}))

vi.mock('../../firebase', () => ({
  db: {},
}))

const collectionMock = vi.fn((db: unknown, path: string) => ({ type: 'collection', db, path }))
const docMock = vi.fn((db: unknown, path: string, id: string) => ({ type: 'doc', db, path, id }))
const getDocMock = vi.fn()
const getDocsMock = vi.fn()
const limitMock = vi.fn((count: number) => ({ type: 'limit', count }))
const orderByMock = vi.fn((field: string, direction: string) => ({
  type: 'orderBy',
  field,
  direction,
}))
const queryMock = vi.fn((ref: unknown, ...constraints: unknown[]) => ({
  type: 'query',
  ref,
  constraints,
}))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({
  type: 'where',
  field,
  op,
  value,
}))

vi.mock('firebase/firestore', () => ({
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  orderBy: (...args: Parameters<typeof orderByMock>) => orderByMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('Today page', () => {
  beforeEach(() => {
    mockUseActiveStoreContext.mockReset()
    mockUseActiveStoreContext.mockReturnValue({
      storeId: 'store-123',
      isLoading: false,
      error: null,
    })

    collectionMock.mockClear()
    docMock.mockClear()
    getDocMock.mockReset()
    getDocsMock.mockReset()
    limitMock.mockClear()
    orderByMock.mockClear()
    queryMock.mockClear()
    whereMock.mockClear()
  })

  it("shows loading indicators while Firestore requests are pending", async () => {
    const summaryDeferred = createDeferred<{
      exists: () => boolean
      data: () => Record<string, unknown>
    }>()
    const activitiesDeferred = createDeferred<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>()

    getDocMock.mockReturnValue(summaryDeferred.promise)
    getDocsMock.mockReturnValue(activitiesDeferred.promise)

    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    )

    expect(screen.getAllByText(/Loading today's summary/i)[0]).toBeInTheDocument()
    expect(screen.getAllByText(/Loading activity feed/i)[0]).toBeInTheDocument()

    summaryDeferred.resolve({
      exists: () => true,
      data: () => ({
        salesTotal: 420,
        salesCount: 12,
        cardTotal: 280,
        cashTotal: 140,
        receiptCount: 9,
        receiptUnits: 18,
        newCustomers: 3,
      }),
    })
    activitiesDeferred.resolve({ docs: [] })

    await waitFor(() => {
      expect(getDocMock).toHaveBeenCalledTimes(1)
      expect(getDocsMock).toHaveBeenCalledTimes(1)
    })
  })

  it('renders KPI cards and activities when data is available', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        salesTotal: 480.5,
        salesCount: 8,
        cardTotal: 320,
        cashTotal: 160.5,
        receiptCount: 6,
        receiptUnits: 18,
        newCustomers: 2,
      }),
    })

    getDocsMock.mockResolvedValue({
      docs: [
        {
          id: 'activity-1',
          data: () => ({
            message: 'Sold 3 iced coffees',
            type: 'sale',
            actor: { displayName: 'Lila' },
            at: { toDate: () => new Date('2024-02-20T08:05:00Z') },
          }),
        },
        {
          id: 'activity-2',
          data: () => ({
            message: 'Added a new customer',
            type: 'customer',
            actor: 'Marcus',
            at: { toDate: () => new Date('2024-02-20T07:45:00Z') },
          }),
        },
      ],
    })

    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    )

    const expectedKey = formatDateKey(new Date())

    await waitFor(() => {
      expect(screen.getByText('GHS 480.50')).toBeInTheDocument()
    })

    expect(screen.getByText('8 sales')).toBeInTheDocument()
    expect(screen.getByText('Card payments')).toBeInTheDocument()
    expect(screen.getByText('Cash payments')).toBeInTheDocument()
    expect(screen.getByText('New customers')).toBeInTheDocument()

    expect(screen.getByText('Sold 3 iced coffees')).toBeInTheDocument()
    expect(screen.getByText(/sale • Lila •/i)).toBeInTheDocument()
    expect(screen.getByText('Added a new customer')).toBeInTheDocument()
    expect(screen.getByText(/customer • Marcus •/i)).toBeInTheDocument()

    const [[, docCollection, docId]] = docMock.mock.calls as unknown[][]
    expect(docCollection).toBe('dailySummaries')
    expect(docId).toBe(`store-123_${expectedKey}`)
    const todayKey = docId.split('store-123_')[1]
    expect(whereMock).toHaveBeenCalledWith('storeId', '==', 'store-123')
    expect(whereMock).toHaveBeenCalledWith('dateKey', '==', todayKey)
    expect(orderByMock).toHaveBeenCalledWith('at', 'desc')
    expect(limitMock).toHaveBeenCalledWith(50)
  })
})
