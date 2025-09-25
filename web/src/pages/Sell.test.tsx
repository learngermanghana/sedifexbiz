import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import Sell from './Sell'

const mockUseAuthUser = vi.fn()
vi.mock('../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const mockUseActiveStore = vi.fn()
vi.mock('../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

const mockQueueCallableRequest = vi.fn()
vi.mock('../utils/offlineQueue', () => ({
  queueCallableRequest: (...args: unknown[]) => mockQueueCallableRequest(...args),
}))

vi.mock('../firebase', () => ({
  db: {},
  functions: {},
}))

const mockCommitSale = vi.fn()
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCommitSale,
}))

const productSnapshot = {
  docs: [
    {
      id: 'product-1',
      data: () => ({ id: 'product-1', name: 'Iced Coffee', price: 12, storeId: 'store-1' }),
    },
  ],
}

const customerSnapshot = {
  docs: [
    {
      id: 'customer-1',
      data: () => ({ id: 'customer-1', name: 'Ada Lovelace', phone: '+233200000000' }),
    },
  ],
}

const collection = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const query = vi.fn((collectionRef: { path: string }, ...clauses: unknown[]) => ({
  type: 'query',
  collection: collectionRef,
  clauses,
}))
const where = vi.fn((...args: unknown[]) => ({ type: 'where', args }))
const orderBy = vi.fn((field: string) => ({ type: 'orderBy', field }))
const doc = vi.fn(() => ({ id: 'generated-sale-id' }))

const onSnapshot = vi.fn((queryRef: { collection: { path: string } }, callback: (snap: unknown) => void) => {
  if (queryRef.collection.path === 'products') {
    callback(productSnapshot)
  }
  if (queryRef.collection.path === 'customers') {
    callback(customerSnapshot)
  }
  return () => {
    /* noop */
  }
})

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => collection(...args),
  query: (...args: unknown[]) => query(...args as [any, ...unknown[]]),
  where: (...args: unknown[]) => where(...args),
  orderBy: (...args: unknown[]) => orderBy(...args as [string]),
  doc: (...args: unknown[]) => doc(...args),
  onSnapshot: (...args: unknown[]) => onSnapshot(...args as [any, any]),
}))

function renderWithProviders(ui: ReactElement) {
  return render(ui, { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> })
}

describe('Sell page', () => {
  beforeEach(() => {
    mockUseAuthUser.mockReset()
    mockUseActiveStore.mockReset()
    mockCommitSale.mockReset()
    mockUseAuthUser.mockReturnValue({
      uid: 'cashier-123',
      email: 'cashier@example.com',
    })
    const selectStoreMock = vi.fn()
    mockUseActiveStore.mockReturnValue({
      storeId: 'store-1',
      role: 'cashier',
      stores: ['store-1'],
      isLoading: false,
      error: null,
      selectStore: selectStoreMock,
    })
    mockCommitSale.mockResolvedValue({
      data: {
        ok: true,
        saleId: 'sale-42',
      },
    })
    mockQueueCallableRequest.mockReset()
    collection.mockClear()
    query.mockClear()
    where.mockClear()
    orderBy.mockClear()
    doc.mockClear()
    onSnapshot.mockClear()
  })

  it('records a cash sale and shows a success message', async () => {
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
      expect(mockCommitSale).toHaveBeenCalledTimes(1)
    })

    expect(mockCommitSale).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        totals: expect.objectContaining({ total: 12 }),
        payment: expect.objectContaining({ method: 'cash', amountPaid: 15, changeDue: 3 }),
        items: [
          expect.objectContaining({ productId: 'product-1', qty: 1, price: 12 }),
        ],
      }),
    )

    expect(await screen.findByText(/Sale recorded #sale-42/i)).toBeInTheDocument()
  })
})
