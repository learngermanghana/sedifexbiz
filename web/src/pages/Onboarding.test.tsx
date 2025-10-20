import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'

import Onboarding from './Onboarding'

const mockUseAuthUser = vi.fn()
vi.mock('../hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const mockGetOnboardingStatus = vi.fn()
const mockSetOnboardingStatus = vi.fn()
vi.mock('../utils/onboarding', () => ({
  getOnboardingStatus: (...args: Parameters<typeof mockGetOnboardingStatus>) =>
    mockGetOnboardingStatus(...args),
  setOnboardingStatus: (...args: Parameters<typeof mockSetOnboardingStatus>) =>
    mockSetOnboardingStatus(...args),
}))

const mockDoc = vi.fn()
const mockGetDoc = vi.fn()

vi.mock('../lib/db', () => ({
  db: { __name: 'defaultDb' },
  rosterDb: { __name: 'rosterDb' },
  doc: (...args: Parameters<typeof mockDoc>) => mockDoc(...args),
  getDoc: (...args: Parameters<typeof mockGetDoc>) => mockGetDoc(...args),
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
    mockDoc.mockReset()
    mockGetDoc.mockReset()

    mockUseAuthUser.mockReturnValue({
      uid: 'user-123',
      email: 'owner@example.com',
    })

    mockGetOnboardingStatus.mockReturnValue('pending')
    mockDoc.mockImplementation((_db, collection, id) => ({ collection, id }))
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      id: 'user-123',
      data: () => ({
        uid: 'user-123',
        email: 'owner@example.com',
        storeId: 'store-123',
        role: 'owner',
      }),
    })
  })

  it('renders onboarding content when workspace access is ready', () => {
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /welcome to sedifex/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /confirm your owner account/i })).toBeInTheDocument()
    expect(screen.getByText(/need to update access later/i)).toBeInTheDocument()
    expect(screen.getByText(/let's get your workspace ready/i)).toBeInTheDocument()
    expect(screen.getByText(/review your workspace details/i)).toBeInTheDocument()
  })
})
