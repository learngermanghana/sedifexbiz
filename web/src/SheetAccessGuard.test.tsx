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

const signOutMock = vi.fn().mockResolvedValue(undefined)

const mockRosterDb = { name: 'roster-db' }
vi.mock('./firebase', () => ({
  auth: { signOut: signOutMock },
}))

const persistActiveStoreMock = vi.fn()
const clearActiveStoreMock = vi.fn()

vi.mock('./utils/activeStoreStorage', () => ({
  persistActiveStoreIdForUser: (...args: Parameters<typeof persistActiveStoreMock>) =>
    persistActiveStoreMock(...args),
  clearActiveStoreIdForUser: (...args: Parameters<typeof clearActiveStoreMock>) =>
    clearActiveStoreMock(...args),
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
    signOutMock.mockClear()
    persistActiveStoreMock.mockClear()
    clearActiveStoreMock.mockClear()
  })

  it.each([
    {
      status: 'expired',
      expected: 'Access denied: expired. Your Sedifex workspace subscription has expired. Contact your Sedifex administrator to restore access.',
    },
    {
      status: 'payment due',
      expected: 'Access denied: payment due. Complete payment with your Sedifex administrator to restore access.',
    },
    {
      status: 'assignment mismatch',
      expected: 'Access denied: mismatch. Your Sedifex account is assigned to a different workspace. Confirm your invitation details with your Sedifex administrator.',
    },
  ])('denies access with message for %s status', async ({ status, expected }) => {
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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(expected))
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(clearActiveStoreMock).toHaveBeenCalledWith('user-1')
    expect(persistActiveStoreMock).not.toHaveBeenCalled()
  })
})
