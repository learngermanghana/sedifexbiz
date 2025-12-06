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


const collectionMock = vi.fn((_db: unknown, path: string) => ({ type: 'collection', path }))
const docMock = vi.fn((_db: unknown, path: string, id?: string) => ({
  type: 'doc',
  path: id ? `${path}/${id}` : path,
}))
const getDocMock = vi.fn()
const getDocsMock = vi.fn()
const queryMock = vi.fn((ref: unknown, ...clauses: unknown[]) => ({ ref, clauses }))
const whereMock = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }))
const setDocMock = vi.fn()
const serverTimestampMock = vi.fn(() => 'server-timestamp')

vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    static now() {
      return { toDate: () => new Date('2024-01-01T00:00:00Z') }
    }
  },
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  setDoc: (...args: Parameters<typeof setDocMock>) => setDocMock(...args),
  serverTimestamp: serverTimestampMock,
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
    collectionMock.mockClear()
    docMock.mockClear()
    getDocMock.mockReset()
    getDocsMock.mockReset()
    queryMock.mockClear()
    whereMock.mockClear()
    setDocMock.mockReset()
    serverTimestampMock.mockReset()

    mockUseActiveStore.mockReturnValue({ storeId: 'store-123', isLoading: false, error: null })
    getDocMock.mockImplementation(async ref => {
      const path = (ref as { path?: string } | undefined)?.path
      if (path === 'stores/store-123') {
        return {
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

      if (path === 'subscriptions/store-123') {
        return {
          exists: () => true,
          data: () => ({
            status: 'active',
            plan: 'starter-monthly',
            provider: 'paystack',
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

  it('shows an edit control for owners when roster data is available', async () => {
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

    await waitFor(() => expect(getDocMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(1))

    const rosterRow = await screen.findByTestId('account-roster-member-1')
    expect(rosterRow).toHaveAttribute('data-uid', 'uid-member-1')
    expect(rosterRow).toHaveAttribute('data-store-id', 'store-123')
    expect(rosterRow).toHaveAttribute('data-phone', '+233201234567')
    expect(rosterRow).toHaveAttribute('data-first-signup-email', 'owner-invite@example.com')

    expect(await screen.findByTestId('account-edit-team')).toBeInTheDocument()
    expect(screen.queryByTestId('account-invite-form')).not.toBeInTheDocument()
  })

  it('lets owners edit workspace details from the account page', async () => {
    setDocMock.mockResolvedValueOnce(undefined)
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

    const nameInput = await screen.findByTestId('account-profile-name')
    const emailInput = await screen.findByTestId('account-profile-email')
    expect(nameInput).toHaveValue('Sedifex Coffee')
    expect(emailInput).toHaveValue('')

    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Sedifex Coffee Ltd')
    await userEvent.type(emailInput, 'hello@sedifex.com')
    await userEvent.type(
      screen.getByTestId('account-profile-phone'),
      '+254712345678',
    )
    await userEvent.type(
      screen.getByTestId('account-profile-address1'),
      '123 Market Street',
    )
    await userEvent.type(
      screen.getByTestId('account-profile-address2'),
      'Suite 4',
    )
    await userEvent.type(screen.getByTestId('account-profile-city'), 'Nairobi')
    await userEvent.type(
      screen.getByTestId('account-profile-region'),
      'Nairobi County',
    )
    await userEvent.type(
      screen.getByTestId('account-profile-postal'),
      '00100',
    )
    await userEvent.type(
      screen.getByTestId('account-profile-country'),
      'Kenya',
    )

    await userEvent.click(screen.getByRole('button', { name: /save workspace details/i }))

    await waitFor(() => expect(setDocMock).toHaveBeenCalled())
    const [, payload, options] = setDocMock.mock.calls[0]
    expect(payload).toMatchObject({
      displayName: 'Sedifex Coffee Ltd',
      name: 'Sedifex Coffee Ltd',
      email: 'hello@sedifex.com',
      phone: '+254712345678',
      addressLine1: '123 Market Street',
      addressLine2: 'Suite 4',
      city: 'Nairobi',
      region: 'Nairobi County',
      postalCode: '00100',
      country: 'Kenya',
    })
    expect(payload.updatedAt?.toDate).toBeInstanceOf(Function)
    expect(options).toEqual({ merge: true })
    expect(mockPublish).toHaveBeenCalledWith({
      message: 'Workspace details updated.',
      tone: 'success',
    })
  })

  it('hides team editing until roster data is available', async () => {
    getDocsMock.mockResolvedValueOnce({ docs: [] })
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

    expect(await screen.findByText(/Team members will appear here once they are available/i)).toBeInTheDocument()
    expect(screen.queryByTestId('account-edit-team')).not.toBeInTheDocument()
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

    await waitFor(() => expect(getDocMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getDocsMock).toHaveBeenCalledTimes(1))

    expect(screen.queryByTestId('account-invite-form')).not.toBeInTheDocument()
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument()
    expect(screen.queryByTestId('account-edit-team')).not.toBeInTheDocument()
  })

  it('lets owners approve pending staff signups that used the Store ID', async () => {
    const user = userEvent.setup()

    mockUseMemberships.mockReturnValue({
      memberships: [
        {
          id: 'm-4',
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

    getDocsMock.mockResolvedValueOnce({
      docs: [
        {
          id: 'member-pending',
          data: () => ({
            uid: 'uid-member-pending',
            storeId: 'store-123',
            email: 'pending@example.com',
            role: 'staff',
            status: 'pending',
            invitedBy: null,
            updatedAt: { toDate: () => new Date('2023-04-01T00:00:00Z') },
          }),
        },
      ],
    })

    render(<AccountOverview />)

    expect(await screen.findByTestId('account-pending-approvals')).toBeInTheDocument()
    const approveButton = screen.getByRole('button', { name: /approve/i })

    await user.click(approveButton)

    await waitFor(() => {
      expect(setDocMock).toHaveBeenCalledWith(
        { type: 'doc', path: 'teamMembers/member-pending' },
        { status: 'active', updatedAt: 'server-timestamp' },
        { merge: true },
      )
    })
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

    getDocMock.mockResolvedValueOnce({
      exists: () => false,
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
