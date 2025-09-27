import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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

describe('Shell manual store recovery', () => {
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

    mockUseActiveStore.mockReturnValue({
      storeId: null,
      stores: [],
      isLoading: false,
      error: 'We could not find any stores linked to your account. Enter your store code to restore access.',
      selectStore: vi.fn(),
      needsStoreResolution: true,
      resolveStoreAccess: vi.fn().mockResolvedValue({ ok: false, error: null }),
      isResolvingStoreAccess: false,
      resolutionError: null,
    })
  })

  it('shows a manual store code form when no stores are linked', () => {
    renderShell()

    expect(screen.getByLabelText(/store code/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /link store/i })).toBeInTheDocument()
  })

  it('validates six-letter codes before submitting to the backend', async () => {
    const resolveMock = vi.fn().mockResolvedValue({ ok: false, error: null })
    mockUseActiveStore.mockReturnValue({
      storeId: null,
      stores: [],
      isLoading: false,
      error: 'Missing store',
      selectStore: vi.fn(),
      needsStoreResolution: true,
      resolveStoreAccess: resolveMock,
      isResolvingStoreAccess: false,
      resolutionError: null,
    })

    renderShell()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/store code/i), 'abc')
    await user.click(screen.getByRole('button', { name: /link store/i }))

    expect(resolveMock).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/enter a valid six-letter store code/i),
    ).toBeInTheDocument()
  })

  it('submits a normalized code and surfaces backend errors', async () => {
    const resolveMock = vi.fn(async () => ({
      ok: false,
      error: 'We could not find a store with that code.',
    }))

    mockUseActiveStore.mockReturnValue({
      storeId: null,
      stores: [],
      isLoading: false,
      error: 'Missing store',
      selectStore: vi.fn(),
      needsStoreResolution: true,
      resolveStoreAccess: resolveMock,
      isResolvingStoreAccess: false,
      resolutionError: null,
    })

    renderShell()

    const user = userEvent.setup()
    const input = screen.getByLabelText(/store code/i)
    await user.clear(input)
    await user.type(input, 'abcxyz')
    await user.click(screen.getByRole('button', { name: /link store/i }))

    await waitFor(() => {
      expect(resolveMock).toHaveBeenCalledWith('ABCXYZ')
    })

    expect(
      await screen.findByText(/we could not find a store with that code/i),
    ).toBeInTheDocument()
  })
})
