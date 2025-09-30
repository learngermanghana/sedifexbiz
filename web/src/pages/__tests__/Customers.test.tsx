import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Customers from '../Customers'

const mockAddDoc = vi.fn(async () => ({ id: 'customer-123' }))
const mockUpdateDoc = vi.fn(async () => {})
const mockDeleteDoc = vi.fn(async () => {})
const mockLoadCachedCustomers = vi.fn(async () => [] as unknown[])
const mockSaveCachedCustomers = vi.fn(async () => {})
const mockLoadCachedSales = vi.fn(async () => [] as unknown[])
const mockSaveCachedSales = vi.fn(async () => {})

vi.mock('../../utils/offlineCache', () => ({
  CUSTOMER_CACHE_LIMIT: 200,
  SALES_CACHE_LIMIT: 500,
  loadCachedCustomers: (...args: Parameters<typeof mockLoadCachedCustomers>) =>
    mockLoadCachedCustomers(...args),
  saveCachedCustomers: (...args: Parameters<typeof mockSaveCachedCustomers>) =>
    mockSaveCachedCustomers(...args),
  loadCachedSales: (...args: Parameters<typeof mockLoadCachedSales>) =>
    mockLoadCachedSales(...args),
  saveCachedSales: (...args: Parameters<typeof mockSaveCachedSales>) =>
    mockSaveCachedSales(...args),
}))

vi.mock('../../firebase', () => ({
  db: {},
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const docMock = vi.fn((...args: unknown[]) => {
  if (args.length === 3) {
    const [, path, id] = args as [unknown, string, string]
    return { type: 'doc', path: `${path}/${id}` }
  }
  if (args.length === 1) {
    const ref = args[0] as { path: string }
    return { type: 'doc', path: `${ref.path}/auto-id` }
  }
  throw new Error('Unexpected doc invocation in test')
})
const queryMock = vi.fn((collectionRef: { path: string }, ...clauses: unknown[]) => ({
  collection: collectionRef,
  clauses,
}))
const orderByMock = vi.fn((field: string, direction?: string) => ({ field, direction }))
const limitMock = vi.fn((value: number) => ({ value }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }))
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
const serverTimestampMock = vi.fn(() => 'server-timestamp')

vi.mock('firebase/firestore', () => ({
  addDoc: (...args: Parameters<typeof mockAddDoc>) => mockAddDoc(...args),
  updateDoc: (...args: Parameters<typeof mockUpdateDoc>) => mockUpdateDoc(...args),
  deleteDoc: (...args: Parameters<typeof mockDeleteDoc>) => mockDeleteDoc(...args),
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  orderBy: (...args: Parameters<typeof orderByMock>) => orderByMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  onSnapshot: (...args: Parameters<typeof onSnapshotMock>) => onSnapshotMock(...args),
  serverTimestamp: () => serverTimestampMock(),
}))

const mockUseActiveStoreContext = vi.fn(() => ({
  storeId: 'store-1',
  storeChangeToken: 0,
  isLoading: false,
  error: null,
  memberships: [],
  membershipsLoading: false,
  setActiveStoreId: vi.fn(),
}))

vi.mock('../../context/ActiveStoreProvider', () => ({
  useActiveStoreContext: () => mockUseActiveStoreContext(),
}))

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  }
})

describe('Customers page loyalty scaffolding', () => {
  beforeEach(() => {
    mockAddDoc.mockClear()
    mockUpdateDoc.mockClear()
    mockDeleteDoc.mockClear()
    mockLoadCachedCustomers.mockReset()
    mockSaveCachedCustomers.mockReset()
    mockLoadCachedSales.mockReset()
    mockSaveCachedSales.mockReset()
    mockLoadCachedCustomers.mockResolvedValue([])
    mockLoadCachedSales.mockResolvedValue([])
    mockSaveCachedCustomers.mockResolvedValue(undefined)
    mockSaveCachedSales.mockResolvedValue(undefined)
    onSnapshotMock.mockClear()
    serverTimestampMock.mockClear()
    mockUseActiveStoreContext.mockClear()
    mockUseActiveStoreContext.mockReturnValue({
      storeId: 'store-1',
      storeChangeToken: 0,
      isLoading: false,
      error: null,
      memberships: [],
      membershipsLoading: false,
      setActiveStoreId: vi.fn(),
    })
  })

  it('includes default loyalty data when creating a new customer', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <Customers />
      </MemoryRouter>,
    )

    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled())

    const nameInput = screen.getByLabelText(/full name/i)
    await user.type(nameInput, 'Test Shopper')

    const saveButton = screen.getByRole('button', { name: /save customer/i })
    await user.click(saveButton)

    await waitFor(() => expect(mockAddDoc).toHaveBeenCalledTimes(1))

    const payload = mockAddDoc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload?.loyalty).toEqual({ points: 0, lastVisitAt: null })
    expect(serverTimestampMock).toHaveBeenCalled()
  })
})
