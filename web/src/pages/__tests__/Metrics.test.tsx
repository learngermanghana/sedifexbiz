import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'

import Metrics from '../Metrics'
import Shell from '../../layout/Shell'

const mockLoadCachedSales = vi.fn()
const mockLoadCachedProducts = vi.fn()
const mockUseActiveStore = vi.fn()
const mockSignOut = vi.fn()

vi.mock('../../utils/offlineCache', () => ({
  loadCachedSales: (...args: Parameters<typeof mockLoadCachedSales>) => mockLoadCachedSales(...args),
  loadCachedProducts: (...args: Parameters<typeof mockLoadCachedProducts>) => mockLoadCachedProducts(...args),
}))

vi.mock('../../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

vi.mock('../../hooks/useAuthUser', () => ({
  useAuthUser: () => ({ email: 'owner@example.com' }),
}))

vi.mock('../../hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: () => ({
    isOnline: true,
    isReachable: true,
    isChecking: false,
    lastHeartbeatAt: null,
    heartbeatError: null,
    queue: { status: 'idle', pending: 0, lastError: null, updatedAt: null },
    checkHeartbeat: vi.fn(),
  }),
}))

vi.mock('../../firebase', () => ({
  auth: {},
}))

vi.mock('firebase/auth', () => ({
  signOut: (...args: Parameters<typeof mockSignOut>) => mockSignOut(...args),
}))

function buildSale({
  id,
  createdAt,
  items,
}: {
  id: string
  createdAt: Date
  items: Array<{ productId?: string; name?: string; qty?: number; price?: number }>
}) {
  return {
    id,
    createdAt,
    items,
  }
}

function daysAgo(base: Date, days: number) {
  const date = new Date(base)
  date.setDate(base.getDate() - days)
  return date
}

describe('Metrics page', () => {
  beforeEach(() => {
    mockLoadCachedSales.mockReset()
    mockLoadCachedProducts.mockReset()
    mockUseActiveStore.mockReset()
    mockSignOut.mockReset()

    mockUseActiveStore.mockReturnValue({ storeId: 'store-123', isLoading: false, error: null })
    mockLoadCachedSales.mockResolvedValue([])
    mockLoadCachedProducts.mockResolvedValue([])
  })

  it('renders KPI metrics and top performers from cached data', async () => {
    const now = new Date()
    mockLoadCachedSales.mockResolvedValue([
      buildSale({
        id: 'sale-1',
        createdAt: daysAgo(now, 1),
        items: [
          { productId: 'p1', qty: 2, price: 120 },
          { productId: 'p2', qty: 1, price: 180 },
        ],
      }),
      buildSale({
        id: 'sale-2',
        createdAt: daysAgo(now, 3),
        items: [
          { productId: 'p1', qty: 1, price: 110 },
          { name: 'Gift Card', qty: 1, price: 50 },
        ],
      }),
      buildSale({
        id: 'sale-3',
        createdAt: daysAgo(now, 9),
        items: [{ productId: 'p2', qty: 1, price: 200 }],
      }),
      buildSale({
        id: 'sale-older',
        createdAt: daysAgo(now, 40),
        items: [{ productId: 'p1', qty: 1, price: 90 }],
      }),
    ])

    mockLoadCachedProducts.mockResolvedValue([
      { id: 'p1', name: 'Cold Brew', stockCount: 5 },
      { id: 'p2', name: 'Chai Latte', stockCount: 3 },
    ])

    render(
      <MemoryRouter>
        <Metrics />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Total revenue')).toBeInTheDocument()
    })

    expect(screen.getByText('GHS 780.00')).toBeInTheDocument()
    expect(screen.getByText('GHS 260.00')).toBeInTheDocument()
    expect(screen.getByText('+190.0%')).toBeInTheDocument()
    expect(screen.getByText('1.20')).toBeInTheDocument()
    expect(screen.getByText('42.9%')).toBeInTheDocument()
    expect(screen.getByTestId('top-product-p1')).toHaveTextContent('Cold Brew')
    expect(screen.getByTestId('top-product-p2')).toHaveTextContent('Chai Latte')
    expect(screen.getByText('Gift Card')).toBeInTheDocument()
  })

  it('activates the metrics route within the shell navigation', async () => {
    const now = new Date()
    mockLoadCachedSales.mockResolvedValue([
      buildSale({
        id: 'sale-1',
        createdAt: daysAgo(now, 1),
        items: [{ productId: 'p1', qty: 1, price: 100 }],
      }),
    ])

    mockLoadCachedProducts.mockResolvedValue([{ id: 'p1', name: 'Cold Brew', stockCount: 5 }])

    render(
      <MemoryRouter initialEntries={['/metrics']}>
        <Routes>
          <Route path="/" element={<Shell><Outlet /></Shell>}>
            <Route index element={<div>Home</div>} />
            <Route path="metrics" element={<Metrics />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Metrics overview')).toBeInTheDocument()
    })

    const metricsLink = screen.getByRole('link', { name: 'Metrics' })
    expect(metricsLink).toHaveClass('is-active')
  })

  it('shows an empty state when no data is available', async () => {
    render(
      <MemoryRouter>
        <Metrics />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mockLoadCachedSales).toHaveBeenCalled())

    expect(await screen.findByText('No metrics yet')).toBeInTheDocument()

    expect(screen.getByText(/record sales/i)).toBeInTheDocument()
  })
})
