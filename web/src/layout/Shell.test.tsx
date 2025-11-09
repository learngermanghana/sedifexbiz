import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, fireEvent } from '@testing-library/react'

import Shell from './Shell'

const mockUseAuthUser = vi.fn()
const mockUseConnectivityStatus = vi.fn()
const mockUseActiveStore = vi.fn()
const mockUseStoreDirectory = vi.fn()

vi.mock('../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

vi.mock('../hooks/useConnectivityStatus', () => ({
  useConnectivityStatus: () => mockUseConnectivityStatus(),
}))

vi.mock('../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

vi.mock('../hooks/useStoreDirectory', () => ({
  useStoreDirectory: (storeIds: string[]) => mockUseStoreDirectory(storeIds),
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
    mockUseActiveStore.mockReset()
    mockUseStoreDirectory.mockReset()

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
      storeId: 'store-1',
      workspaceId: 'store-1',
      workspaceSlug: 'workspace-1',
      isLoading: false,
      error: null,
      memberships: [
        {
          id: 'membership-1',
          uid: 'user-1',
          role: 'owner',
          storeId: 'store-1',
          workspaceSlug: 'workspace-1',
          email: null,
          phone: null,
          invitedBy: null,
          firstSignupEmail: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      setActiveStoreId: vi.fn(),
    })

    mockUseStoreDirectory.mockReturnValue({
      options: [
        { storeId: 'store-1', slug: 'downtown-hq', company: 'Downtown HQ', label: 'Downtown HQ (downtown-hq)' },
        { storeId: 'store-2', slug: 'uptown-kiosk', company: 'Uptown Kiosk', label: 'Uptown Kiosk (uptown-kiosk)' },
      ],
      loading: false,
      error: null,
    })
  })

  it('renders the workspace selector', () => {
    renderShell()

    const selector = screen.getByRole('combobox', { name: /workspace/i })
    expect(selector).toHaveValue('downtown-hq')
    expect(screen.getByRole('option', { name: 'Downtown HQ (downtown-hq)' })).toBeInTheDocument()
  })

  it('invokes the setter when choosing another workspace', () => {
    const setActiveStoreId = vi.fn()
    mockUseActiveStore.mockReturnValue({
      storeId: 'store-1',
      workspaceId: 'store-1',
      workspaceSlug: 'workspace-1',
      isLoading: false,
      error: null,
      memberships: [
        {
          id: 'membership-1',
          uid: 'user-1',
          role: 'owner',
          storeId: 'store-1',
          workspaceSlug: 'workspace-1',
          email: null,
          phone: null,
          invitedBy: null,
          firstSignupEmail: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      setActiveStoreId,
    })

    renderShell()

    const selector = screen.getByRole('combobox', { name: /workspace/i })
    screen.getByRole('option', { name: 'Uptown Kiosk (uptown-kiosk)' })
    fireEvent.change(selector, { target: { value: 'uptown-kiosk' } })

    expect(setActiveStoreId).toHaveBeenCalledWith('store-2')
  })
})
