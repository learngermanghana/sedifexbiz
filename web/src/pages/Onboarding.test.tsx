import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Onboarding from './Onboarding'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  )

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const mockUseAuthUser = vi.fn()
vi.mock('../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const mockGetOnboardingStatus = vi.fn()
const mockSetOnboardingStatus = vi.fn()
vi.mock('../utils/onboarding', () => ({
  getOnboardingStatus: (
    ...args: Parameters<typeof mockGetOnboardingStatus>
  ) => mockGetOnboardingStatus(...args),
  setOnboardingStatus: (
    ...args: Parameters<typeof mockSetOnboardingStatus>
  ) => mockSetOnboardingStatus(...args),
}))

// Firestore mocks
const mockCollection = vi.fn()
const mockDoc = vi.fn()
const mockGetDoc = vi.fn()
const mockGetDocs = vi.fn()
const mockQuery = vi.fn()
const mockWhere = vi.fn()
const mockLimit = vi.fn()

// Only default DB is used now
vi.mock('../firebase', () => ({
  db: { __name: 'defaultDb' },
}))

vi.mock('firebase/firestore', () => ({
  collection: (...args: Parameters<typeof mockCollection>) =>
    mockCollection(...args),
  doc: (...args: Parameters<typeof mockDoc>) => mockDoc(...args),
  getDoc: (...args: Parameters<typeof mockGetDoc>) => mockGetDoc(...args),
  getDocs: (...args: Parameters<typeof mockGetDocs>) => mockGetDocs(...args),
  query: (...args: Parameters<typeof mockQuery>) => mockQuery(...args),
  where: (...args: Parameters<typeof mockWhere>) => mockWhere(...args),
  limit: (...args: Parameters<typeof mockLimit>) => mockLimit(...args),
  Timestamp: class {
    toDate() {
      return new Date('2024-01-01T00:00:00.000Z')
    }
  },
}))

describe('Onboarding page', () => {
  beforeEach(() => {
    mockUseAuthUser.mockReset()
    mockGetOnboardingStatus.mockReset()
    mockSetOnboardingStatus.mockReset()
    mockNavigate.mockReset()

    mockCollection.mockReset()
    mockDoc.mockReset()
    mockGetDoc.mockReset()
    mockGetDocs.mockReset()
    mockQuery.mockReset()
    mockWhere.mockReset()
    mockLimit.mockReset()

    // Logged-in owner
    mockUseAuthUser.mockReturnValue({
      uid: 'user-123',
      email: 'owner@example.com',
    })

    // Onboarding status
    mockGetOnboardingStatus.mockReturnValue('pending')

    // Firestore collection/query helpers (shape doesn’t really matter)
    mockCollection.mockImplementation((_db, collectionName) => ({
      __type: 'collection',
      collectionName,
    }))
    mockWhere.mockImplementation((...args) => ({ __type: 'where', args }))
    mockLimit.mockImplementation((...args) => ({ __type: 'limit', args }))
    mockQuery.mockImplementation((...args) => ({ __type: 'query', args }))

    // Membership query: /teamMembers where uid == 'user-123'
    const fakeMembershipDoc = {
      id: 'store-123',
      data: () => ({
        uid: 'user-123',
        email: 'owner@example.com',
        storeId: 'store-123',
        role: 'owner',
      }),
    }
    mockGetDocs.mockResolvedValue({ docs: [fakeMembershipDoc] })

    // Store lookup: /stores/store-123
    mockDoc.mockImplementation((_db, collectionName, id) => ({
      __type: 'doc',
      collectionName,
      id,
    }))
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: 'store-123',
      data: () => ({
        status: 'active',
        contractStatus: 'active',
      }),
    })
  })

  it('renders onboarding content when workspace access is ready', () => {
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: /welcome to sedifex/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /confirm your owner account/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/let's confirm your workspace details/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/review your workspace details/i),
    ).toBeInTheDocument()
  })

  it('defaults to pending status when no onboarding record exists yet', () => {
    mockGetOnboardingStatus.mockReturnValueOnce(null)

    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    )

    expect(mockSetOnboardingStatus).toHaveBeenCalledWith('user-123', 'pending')
    expect(
      screen.getByRole('heading', { name: /welcome to sedifex/i }),
    ).toBeInTheDocument()
  })

  it('links the contract step to the billing section', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    )

    await user.click(
      screen.getByRole('button', { name: /view contract & billing/i }),
    )

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/account',
      hash: '#account-overview-contract',
    })
  })
})
