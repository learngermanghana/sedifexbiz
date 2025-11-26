import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'

import Shell from './Shell'

const mockUseAuthUser = vi.fn()
const mockUseConnectivityStatus = vi.fn()
const mockUseStoreBilling = vi.fn()
const mockUseActiveStore = vi.fn()

vi.mock('../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

vi.mock('../hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: () => mockUseConnectivityStatus(),
}))

vi.mock('../hooks/useStoreBilling', () => ({
  useStoreBilling: () => mockUseStoreBilling(),
}))

vi.mock('../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
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
    mockUseConnectivityStatus.mockReset()
    mockUseStoreBilling.mockReset()
    mockUseActiveStore.mockReset()

    mockUseAuthUser.mockReturnValue({ email: 'owner@example.com' })
    mockUseActiveStore.mockReturnValue({ storeId: 'store-123', isLoading: false, error: null })
    mockUseConnectivityStatus.mockReturnValue({
      isOnline: true,
      isReachable: true,
      isChecking: false,
      lastHeartbeatAt: null,
      heartbeatError: null,
      queue: { status: 'idle', pending: 0, lastError: null, updatedAt: null },
    })
    mockUseStoreBilling.mockReturnValue({
      loading: false,
      error: null,
      billing: {
        status: 'active',
        planKey: 'Standard',
        trialEndsAt: null,
        paymentStatus: 'active',
        contractEnd: null,
      },
    })
  })

  it('renders the workspace status', () => {
    renderShell()

    expect(screen.getByText('Standard')).toBeInTheDocument()
  })

  it('shows a billing reminder when payment is past due', () => {
    mockUseStoreBilling.mockReturnValueOnce({
      loading: false,
      error: null,
      billing: {
        status: 'active',
        planKey: 'Standard',
        trialEndsAt: null,
        paymentStatus: 'past_due',
        contractEnd: null,
      },
    })

    renderShell()

    expect(screen.getByText('Billing past due')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /update payment/i })).toHaveAttribute('href', '/account')
  })

  it('allows dismissing the billing notice for the current day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-05-05T12:00:00Z'))

    mockUseStoreBilling.mockReturnValueOnce({
      loading: false,
      error: null,
      billing: {
        status: 'active',
        planKey: 'Standard',
        trialEndsAt: null,
        paymentStatus: 'past_due',
        contractEnd: null,
      },
    })

    renderShell()

    screen.getByRole('button', { name: /dismiss reminder/i }).click()
    expect(screen.queryByText('Billing past due')).not.toBeInTheDocument()

    vi.useRealTimers()
  })
})
