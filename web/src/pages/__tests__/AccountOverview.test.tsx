import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccountOverview from '../AccountOverview'

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

const mockManageStaffAccount = vi.fn()
vi.mock('../../controllers/storeController', () => ({
  manageStaffAccount: (...args: Parameters<typeof mockManageStaffAccount>) =>
    mockManageStaffAccount(...args),
}))

const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const docMock = vi.fn((_db: unknown, path: string, id?: string) => ({
  type: 'doc',
  path: id ? `${path}/${id}` : path,
}))
const getDocMock = vi.fn()
const getDocsMock = vi.fn()
const queryMock = vi.fn((ref: unknown, ...clauses: unknown[]) => ({ ref, clauses }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }))

vi.mock('firebase/firestore', () => ({
  Timestamp: class {},
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
}))

vi.mock('../../firebase', () => ({
  db: {},
}))

const originalConsoleError = console.error
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const [first] = args
    if (typeof first === 'string' && first.includes('act(...)')) {
      return
    }

    originalConsoleError(...(args as Parameters<typeof console.error>))
  })
})

afterAll(() => {
  consoleErrorSpy?.mockRestore()
})

describe('AccountOverview', () => {
  beforeEach(() => {
    mockPublish.mockReset()
    mockUseActiveStore.mockReset()
    mockUseMemberships.mockReset()
    mockManageStaffAccount.mockReset()
    collectionMock.mockClear()
    docMock.mockClear()
    getDocMock.mockReset()
    getDocsMock.mockReset()
    queryMock.mockClear()
    whereMock.mockClear()

    mockUseActiveStore.mockReturnValue({ storeId: 'store-123', isLoading: false, error: null })
    getDocMock.mockImplementation(async request => {
      const path = (request as { path?: string } | undefined)?.path ?? ''

      if (path === 'default/store/store-123') {
        return {
          id: 'store-123',
          exists: () => true,
          data: () => ({
            displayName: 'Sedifex Coffee',
            status: 'Active',
            currency: 'GHS',
            billingPlan: 'Monthly',
            paymentProvider: 'Stripe',
            createdAt: { toDate: () => new Date('2023-01-01T00:00:00Z') },
            updatedAt: { toDate: () => new Date('2023-02-01T00:00:00Z') },
          }),
        }
      }

      return { exists: () => false }
    })
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

  it('allows owners to manage team invitations', async () => {
    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-1',
          uid: 'owner-1',
          role: 'owner',
          storeId: 'store-123',
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

    await waitFor(() => expect(getDocMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(1))

    const rosterRow = await screen.findByTestId('account-roster-member-1')
    expect(rosterRow).toHaveAttribute('data-uid', 'uid-member-1')
    expect(rosterRow).toHaveAttribute('data-store-id', 'store-123')
    expect(rosterRow).toHaveAttribute('data-phone', '+233201234567')
    expect(rosterRow).toHaveAttribute('data-first-signup-email', 'owner-invite@example.com')

    const form = await screen.findByTestId('account-invite-form')
    expect(form).toBeInTheDocument()

    const user = userEvent.setup()
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
  })

  it('renders a read-only roster for staff members', async () => {
    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-2',
          uid: 'staff-1',
          role: 'staff',
          storeId: 'store-123',
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

    await waitFor(() => expect(getDocMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(1))

    expect(screen.queryByTestId('account-invite-form')).not.toBeInTheDocument()
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument()
  })

  it('falls back to ownerId lookup when the store document id differs from the storeId', async () => {
    mockUseActiveStore.mockReturnValue({ storeId: 'owner-1', isLoading: false, error: null })
    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-3',
          uid: 'owner-1',
          role: 'owner',
          storeId: 'owner-1',
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

    getDocMock.mockImplementation(request => {
      const path = (request as { path?: string } | undefined)?.path ?? ''
      if (path === 'default/store/owner-1') return { exists: () => false }
      if (path === 'stores/owner-1') return { exists: () => false }
      return { exists: () => false }
    })

    getDocsMock.mockImplementation(async request => {
      const ref = (request as { ref?: { path?: string } } | undefined)?.ref
      if (ref?.path === 'stores') {
        return {
          docs: [
            {
              id: 'store-document-id',
              data: () => ({
                displayName: 'Fallback Coffee',
                status: 'Active',
                currency: 'USD',
                billingPlan: 'Annual',
                paymentProvider: 'Stripe',
                createdAt: { toDate: () => new Date('2023-03-01T00:00:00Z') },
                updatedAt: { toDate: () => new Date('2023-03-02T00:00:00Z') },
              }),
            },
          ],
        }
      }

      if (ref?.path === 'teamMembers') {
        return {
          docs: [
            {
              id: 'member-owner',
              data: () => ({
                uid: 'owner-1',
                storeId: 'owner-1',
                email: 'owner@example.com',
                role: 'owner',
                invitedBy: null,
                phone: '+1-555-0000',
                firstSignupEmail: null,
                updatedAt: { toDate: () => new Date('2023-03-02T00:00:00Z') },
              }),
            },
          ],
        }
      }

      return { docs: [] }
    })

    render(<AccountOverview />)
    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(getDocMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(2))

    expect(queryMock).toHaveBeenCalledWith(
      { type: 'collection', path: 'stores' },
      { field: 'ownerId', op: '==', value: 'owner-1' },
    )

    expect(await screen.findByText('Fallback Coffee')).toBeInTheDocument()
    const rosterRow = await screen.findByTestId('account-roster-member-owner')
    expect(rosterRow).toHaveAttribute('data-uid', 'owner-1')
  })

  it('falls back to the document ID when a team member is missing a uid', async () => {
    getDocsMock.mockResolvedValueOnce({
      docs: [
        {
          id: 'member-2',
          data: () => ({
            storeId: 'store-456',
            email: 'staff2@example.com',
            role: 'staff',
            invitedBy: 'owner@example.com',
          }),
        },
      ],
    })

    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-3',
          uid: 'owner-1',
          role: 'owner',
          storeId: 'store-123',
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

    const rosterRow = await screen.findByTestId('account-roster-member-2')
    expect(rosterRow).toHaveAttribute('data-uid', 'member-2')
    expect(rosterRow).toHaveAttribute('data-store-id', 'store-456')
    expect(rosterRow).not.toHaveAttribute('data-first-signup-email')
  })
})
