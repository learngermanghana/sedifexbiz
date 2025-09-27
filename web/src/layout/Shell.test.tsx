import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'

import Shell from './Shell'

const mockUseActiveStore = vi.fn()
const mockUseAuthUser = vi.fn()
const mockUseConnectivityStatus = vi.fn()

vi.mock('../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

vi.mock('../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

vi.mock('../hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: () => mockUseConnectivityStatus(),
}))

vi.mock('../firebase', () => ({
  auth: {},
}))

vi.mock('firebase/auth', () => ({
  signOut: vi.fn(),
}))

function renderShell() {
  return render(
    <MemoryRouter>
      <Shell>
        <div>Content</div>
      </Shell>
    </MemoryRouter>,
  )
}

describe('Shell', () => {
  beforeEach(() => {
    mockUseAuthUser.mockReset()
    mockUseActiveStore.mockReset()
    mockUseConnectivityStatus.mockReset()

    mockUseAuthUser.mockReturnValue({ email: 'owner@example.com' })
    mockUseConnectivityStatus.mockReturnValue({
      isOnline: true,
      isReachable: true,
      isChecking: false,
      lastHeartbeatAt: null,
      heartbeatError: null,
      queue: { status: 'idle', pending: 0, lastError: null, updatedAt: null },
    })
  })

  it('shows the resolved store identifier', () => {
    mockUseActiveStore.mockReturnValue({
      storeId: 'store-1',
      stores: ['store-1'],
      isLoading: false,
      error: null,
      selectStore: vi.fn(),
    })

    renderShell()

    expect(screen.getByText('store-1')).toBeInTheDocument()
  })

  it('indicates when store details are loading', () => {
    mockUseActiveStore.mockReturnValue({
      storeId: null,
      stores: [],
      isLoading: true,
      error: null,
      selectStore: vi.fn(),
    })

    renderShell()

    expect(screen.getByText(/loading store/i)).toBeInTheDocument()
  })

  it('surfaces store resolution errors', () => {
    mockUseActiveStore.mockReturnValue({
      storeId: null,
      stores: [],
      isLoading: false,
      error: 'Unable to determine store access.',
      selectStore: vi.fn(),
    })

    renderShell()

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to determine store access.')
  })
})
