import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Shell from './Shell'
import { ToastProvider } from '../components/ToastProvider'

const mockUseAuthUser = vi.fn()
const mockUseConnectivityStatus = vi.fn()
const mockUseStoreBilling = vi.fn()
const mockUseActiveStore = vi.fn()
const mockUseWorkspaceIdentity = vi.fn()
const mockUseMemberships = vi.fn()

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

vi.mock('../hooks/useWorkspaceIdentity', () => ({
  useWorkspaceIdentity: () => mockUseWorkspaceIdentity(),
}))

vi.mock('../hooks/useMemberships', () => ({
  useMemberships: () => mockUseMemberships(),
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
      <ToastProvider>
        <Shell>
          <div>Content</div>
        </Shell>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Shell', () => {
  beforeEach(() => {
    localStorage.clear()

    mockUseAuthUser.mockReset()
    mockUseConnectivityStatus.mockReset()
    mockUseStoreBilling.mockReset()
    mockUseActiveStore.mockReset()
    mockUseWorkspaceIdentity.mockReset()
    mockUseMemberships.mockReset()

    mockUseAuthUser.mockReturnValue({ email: 'owner@example.com' })
    mockUseActiveStore.mockReturnValue({ storeId: 'store-123', isLoading: false, error: null })
    mockUseWorkspaceIdentity.mockReturnValue({ name: 'Demo Store', loading: false })
    mockUseMemberships.mockReturnValue({ memberships: [], loading: false, error: null })
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
    mockUseStoreBilling.mockReturnValue({
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

  it('allows dismissing the billing notice for the current day', async () => {
    mockUseStoreBilling.mockReturnValue({
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

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /dismiss reminder/i }))
    expect(screen.queryByText('Billing past due')).not.toBeInTheDocument()
  })

  it('locks navigation and surfaces a notice when the trial has ended', () => {
    mockUseStoreBilling.mockReturnValue({
      loading: false,
      error: null,
      billing: {
        status: 'trial',
        planKey: 'Trial',
        trialEndsAt: { toDate: () => new Date('2024-01-01T00:00:00Z') } as any,
        paymentStatus: 'trial',
        contractEnd: null,
      },
    })

    renderShell()

    expect(
      screen.getByText(
        'Your Sedifex trial has ended. Update payment to continue using the app.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })
})
