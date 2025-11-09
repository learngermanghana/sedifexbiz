import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccountOverview from '../AccountOverview'
import type { WorkspaceAccountProfile } from '../../data/loadWorkspace'

const mockPublish = vi.fn()

vi.mock('../../components/ToastProvider', () => ({
  useToast: () => ({ publish: mockPublish }),
}))

const mockUseActiveStore = vi.fn()
vi.mock('../../hooks/useActiveStore', () => ({
  useActiveStore: () => mockUseActiveStore(),
}))

const mockUseMemberships = vi.fn()
vi.mock('../../hooks/useMemberships', () => ({
  useMemberships: () => mockUseMemberships(),
}))

const mockUseAuthUser = vi.fn()
vi.mock('../../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const mockUseAutoRerun = vi.fn()
vi.mock('../../hooks/useAutoRerun', () => ({
  useAutoRerun: (...args: Parameters<typeof mockUseAutoRerun>) => mockUseAutoRerun(...args),
}))

const mockManageStaffAccount = vi.fn()
vi.mock('../../controllers/storeController', () => ({
  manageStaffAccount: (...args: Parameters<typeof mockManageStaffAccount>) =>
    mockManageStaffAccount(...args),
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const getDocsMock = vi.fn()
const queryMock = vi.fn((ref: unknown, ...clauses: unknown[]) => ({ ref, clauses }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }))

vi.mock('../../lib/db', () => ({
  Timestamp: class {},
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  rosterDb: { name: 'roster-db' },
}))

const mockGetActiveStoreId = vi.fn()
const mockLoadWorkspaceProfile = vi.fn()
const mockMapAccount = vi.fn()

vi.mock('../../data/loadWorkspace', () => ({
  getActiveStoreId: (...args: Parameters<typeof mockGetActiveStoreId>) => mockGetActiveStoreId(...args),
  loadWorkspaceProfile: (...args: Parameters<typeof mockLoadWorkspaceProfile>) =>
    mockLoadWorkspaceProfile(...args),
  mapAccount: (...args: Parameters<typeof mockMapAccount>) => mockMapAccount(...args),
}))

const clipboardMock = {
  writeText: vi.fn<[], Promise<void>>().mockResolvedValue(),
}

function createProfile(overrides: Partial<WorkspaceAccountProfile> = {}): WorkspaceAccountProfile {
  return {
    id: 'workspace-coffee',
    slug: 'sedifex-coffee',
    storeId: 'store-123',
    company: 'Sedifex Coffee',
    name: 'Sedifex Coffee',
    displayName: 'Sedifex Coffee',
    email: 'hello@sedifex.com',
    phone: '+233201234567',
    status: 'Active',
    plan: 'Monthly',
    paymentStatus: 'Paid',
    contractStart: new Date('2023-01-01T00:00:00Z'),
    contractEnd: new Date('2023-12-31T00:00:00Z'),
    amountPaid: 12.5,
    currency: 'GHS',
    timezone: 'Africa/Accra',
    addressLine1: '123 Coffee St',
    addressLine2: null,
    city: 'Accra',
    region: 'Greater Accra',
    postalCode: '00233',
    country: 'GH',
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-02-01T00:00:00Z'),
    ...overrides,
  }
}

beforeAll(() => {
  Object.assign(navigator as Navigator & { clipboard: typeof clipboardMock }, { clipboard: clipboardMock })
})

afterAll(() => {
  delete (navigator as Record<string, unknown>).clipboard
})

describe('AccountOverview', () => {
  let autoRerunTrigger: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPublish.mockReset()
    mockUseActiveStore.mockReset()
    mockUseMemberships.mockReset()
    mockUseAuthUser.mockReset()
    mockUseAutoRerun.mockReset()
    mockManageStaffAccount.mockReset()
    mockGetActiveStoreId.mockReset()
    mockLoadWorkspaceProfile.mockReset()
    mockMapAccount.mockReset()
    collectionMock.mockClear()
    getDocsMock.mockReset()
    queryMock.mockClear()
    whereMock.mockClear()
    clipboardMock.writeText.mockClear()

    autoRerunTrigger = vi.fn()
    mockUseAutoRerun.mockReturnValue({ token: 0, trigger: autoRerunTrigger })

    mockUseActiveStore.mockReturnValue({
      storeId: 'store-123',
      workspaceId: 'store-123',
      workspaceSlug: 'workspace-123',
      isLoading: false,
      error: null,
    })
    mockUseAuthUser.mockReturnValue({ uid: 'user-1', email: 'owner@example.com' })
    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-1',
          uid: 'owner-1',
          role: 'owner',
          storeId: 'store-123',
          workspaceSlug: 'sedifex-coffee',
          email: 'owner@example.com',
          phone: null,
          invitedBy: null,
          firstSignupEmail: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      loading: false,
      error: null,
    })

    mockGetActiveStoreId.mockResolvedValue('store-123')
    mockLoadWorkspaceProfile.mockResolvedValue({ id: 'workspace-coffee' })
    mockMapAccount.mockReturnValue(createProfile())

    getDocsMock.mockResolvedValue({
      docs: [
        {
          id: 'member-1',
          data: () => ({
            uid: 'uid-member-1',
            storeId: 'store-123',
            email: 'owner@example.com',
            role: 'owner',
            invitedBy: 'admin@example.com',
            phone: '+233201234567',
            firstSignupEmail: 'owner-invite@example.com',
            updatedAt: { toDate: () => new Date('2023-02-01T00:00:00Z') },
          }),
        },
      ],
    })
  })

  it('loads workspace profile using the membership slug when available', async () => {
    render(<AccountOverview />)
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(mockLoadWorkspaceProfile).toHaveBeenCalledTimes(1))
    expect(mockLoadWorkspaceProfile).toHaveBeenCalledWith({ slug: 'sedifex-coffee', storeId: 'store-123' })

    expect(await screen.findByText('Sedifex Coffee')).toBeInTheDocument()
    expect(screen.getByText('Contract status').nextElementSibling).toHaveTextContent('Active')
    expect(screen.getByText('Plan').nextElementSibling).toHaveTextContent('Monthly')
    expect(screen.getByText('Payment status').nextElementSibling).toHaveTextContent('Paid')
    expect(screen.getByText('Amount paid').nextElementSibling).toHaveTextContent('GHS 12.50')
  })

  it('falls back to storeId when the membership slug is missing', async () => {
    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-2',
          uid: 'owner-1',
          role: 'owner',
          storeId: 'store-123',
          workspaceSlug: null,
          email: 'owner@example.com',
          phone: null,
          invitedBy: null,
          firstSignupEmail: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      loading: false,
      error: null,
    })

    render(<AccountOverview />)
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(mockLoadWorkspaceProfile).toHaveBeenCalledTimes(1))
    expect(mockLoadWorkspaceProfile).toHaveBeenCalledWith({ slug: null, storeId: 'store-123' })
  })

  it('fetches the active storeId from roster when no store is selected', async () => {
    mockUseActiveStore.mockReturnValue({
      storeId: null,
      workspaceId: null,
      workspaceSlug: null,
      isLoading: false,
      error: null,
    })
    mockGetActiveStoreId.mockResolvedValue('store-456')

    render(<AccountOverview />)
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(mockGetActiveStoreId).toHaveBeenCalledWith('user-1'))
    await waitFor(() => expect(mockLoadWorkspaceProfile).toHaveBeenCalledWith({ slug: 'sedifex-coffee', storeId: 'store-456' }))
  })

  it.each([
    { value: 0, expected: '0.00' },
    { value: 20, expected: '0.20' },
    { value: 1250, expected: '12.50' },
  ])('formats amountPaid=%s as %s', async ({ value, expected }) => {
    mockMapAccount.mockReturnValue(createProfile({ amountPaid: value / 100, currency: null }))

    render(<AccountOverview />)
    await act(async () => {
      await Promise.resolve()
    })

    const amountDd = await screen.findByText('Amount paid')
    expect(amountDd.nextElementSibling).toHaveTextContent(expected)
  })

  it('renders a read-only roster for staff members', async () => {
    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-3',
          uid: 'staff-1',
          role: 'staff',
          storeId: 'store-123',
          workspaceSlug: 'sedifex-coffee',
          email: 'staff@example.com',
          phone: null,
          invitedBy: null,
          firstSignupEmail: null,
          createdAt: null,
          updatedAt: null,
        },
      ],
      loading: false,
      error: null,
    })

    render(<AccountOverview />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.queryByTestId('account-invite-form')).not.toBeInTheDocument()
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument()
  })

  it('allows owners to manage team invitations', async () => {
    render(<AccountOverview />)
    await act(async () => {
      await Promise.resolve()
    })

    const rosterRow = await screen.findByTestId('account-roster-member-1')
    expect(rosterRow).toHaveAttribute('data-uid', 'uid-member-1')
    expect(rosterRow).toHaveAttribute('data-store-id', 'store-123')

    const inviteLinkField = screen.getByTestId('account-invite-link') as HTMLInputElement
    expect(inviteLinkField.value).toBe('http://localhost/#/')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('account-copy-invite-link'))
    await waitFor(() => expect(clipboardMock.writeText).toHaveBeenCalledWith('http://localhost/#/'))

    await user.type(screen.getByLabelText(/email/i), 'new-user@example.com')
    await user.selectOptions(screen.getByLabelText(/role/i), 'staff')
    await user.type(screen.getByLabelText(/password/i), 'Secret123!')
    await user.click(screen.getByRole('button', { name: /send invite/i }))

    await waitFor(() => {
      expect(mockManageStaffAccount).toHaveBeenCalledWith({
        storeId: 'store-123',
        email: 'new-user@example.com',
        role: 'staff',
        password: 'Secret123!',
      })
    })

    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(2))
    expect(mockPublish).toHaveBeenCalledWith({ message: 'Team member updated.', tone: 'success' })
    expect(autoRerunTrigger).toHaveBeenCalled()
  })
})
