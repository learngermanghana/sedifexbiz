import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

import SheetAccessGuard from './SheetAccessGuard'

const mockUseAuthUser = vi.fn()
vi.mock('./hooks/useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const docMock = vi.fn()
const getDocMock = vi.fn()
const collectionMock = vi.fn()
const getDocsMock = vi.fn()
const queryMock = vi.fn()
const whereMock = vi.fn()

vi.mock('./lib/db', () => ({
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  rosterDb: mockRosterDb,
}))

const mockRosterDb = { name: 'roster-db' }
const persistActiveStoreMock = vi.fn()

vi.mock('./utils/activeStoreStorage', () => ({
  persistActiveStoreIdForUser: (...args: Parameters<typeof persistActiveStoreMock>) =>
    persistActiveStoreMock(...args),
}))

describe('SheetAccessGuard', () => {
  beforeEach(() => {
    mockUseAuthUser.mockReset()
    docMock.mockReset()
    getDocMock.mockReset()
    collectionMock.mockReset()
    getDocsMock.mockReset()
    queryMock.mockReset()
    whereMock.mockReset()
    persistActiveStoreMock.mockClear()
  })

  it.each([
    {
      status: 'expired',
    },
    {
      status: 'payment due',
    },
    {
      status: 'assignment mismatch',
    },
  ])('allows access for %s status', async ({ status }) => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-1', email: 'user@example.com' })
    docMock.mockReturnValue({ type: 'doc', path: 'teamMembers/user-1' })
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ storeId: 'store-123', status }),
    })

    render(
      <SheetAccessGuard>
        <p>Protected content</p>
      </SheetAccessGuard>,
    )

    await waitFor(() => expect(screen.getByText('Protected content')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(persistActiveStoreMock).toHaveBeenCalledWith('user-1', 'store-123')
  })
})
