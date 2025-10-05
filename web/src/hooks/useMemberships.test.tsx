import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useMemberships } from './useMemberships'

const mockUseAuthUser = vi.fn()
vi.mock('./useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

vi.mock('../firebase', () => ({
  db: {},
}))

const collectionMock = vi.fn(() => ({ type: 'collection' }))
const docMock = vi.fn(() => ({ type: 'doc' }))
const whereMock = vi.fn(() => ({ type: 'where' }))
const queryMock = vi.fn(() => ({ type: 'query' }))
const getDocMock = vi.fn()
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  Timestamp: class MockTimestamp {},
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
}))

describe('useMemberships', () => {
  beforeEach(() => {
    mockUseAuthUser.mockReset()
    collectionMock.mockClear()
    docMock.mockClear()
    whereMock.mockClear()
    queryMock.mockClear()
    getDocMock.mockReset()
    getDocsMock.mockReset()
  })

  it('returns an empty membership list when the user is not authenticated', async () => {
    mockUseAuthUser.mockReturnValue(null)

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.memberships).toEqual([])
    expect(collectionMock).not.toHaveBeenCalled()
  })

  it('loads memberships for the authenticated user from the direct document and normalizes the shape', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-123', email: 'member@example.com' })

    const membershipDoc = {
      id: 'member-doc',
      exists: () => true,
      data: () => ({
        uid: 'user-123',
        role: 'staff',
        storeId: 'store-abc',
        email: 'member@example.com',
        phone: '+1234567890',
        invitedBy: 'owner-1',
        firstSignupEmail: 'owner@example.com',
        createdAt: null,
        updatedAt: null,
      }),
    }

    getDocMock.mockResolvedValue(membershipDoc)
    getDocsMock.mockResolvedValueOnce({ docs: [] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(docMock).toHaveBeenCalledWith({}, 'teamMembers', 'user-123')
    expect(getDocMock).toHaveBeenCalled()
    expect(collectionMock).toHaveBeenCalledWith({}, 'teamMembers')
    expect(whereMock).toHaveBeenCalledWith('uid', '==', 'user-123')
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(getDocsMock).toHaveBeenCalledTimes(1)

    expect(result.current.memberships).toEqual([
      {
        id: 'member-doc',
        uid: 'user-123',
        role: 'staff',
        storeId: 'store-abc',
        email: 'member@example.com',
        phone: '+1234567890',
        invitedBy: 'owner-1',
        firstSignupEmail: 'owner@example.com',
        createdAt: null,
        updatedAt: null,
      },
    ])
    expect(result.current.error).toBeNull()
  })

  it('falls back to querying by uid when the direct document is missing and normalizes results', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-456', email: 'fallback@example.com' })

    getDocMock.mockResolvedValue({ exists: () => false })

    const membershipDoc = {
      id: 'user-456',
      exists: () => true,
      data: () => ({
        role: 'unknown-role',
      }),
    }

    getDocsMock.mockResolvedValueOnce({ docs: [membershipDoc] })
    getDocsMock.mockResolvedValueOnce({ docs: [] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(collectionMock).toHaveBeenCalledWith({}, 'teamMembers')
    expect(whereMock).toHaveBeenNthCalledWith(1, 'uid', '==', 'user-456')
    expect(whereMock).toHaveBeenNthCalledWith(2, 'email', '==', 'fallback@example.com')

    expect(result.current.memberships).toEqual([
      {
        id: 'user-456',
        uid: 'user-456',
        role: 'staff',
        storeId: null,
        email: null,
        phone: null,
        invitedBy: null,
        firstSignupEmail: null,
        createdAt: null,
        updatedAt: null,
      },
    ])
  })

  it('falls back to querying by email when no uid-based records are found', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-789', email: 'email-match@example.com' })

    getDocMock.mockResolvedValue({ exists: () => false })
    getDocsMock.mockResolvedValueOnce({ docs: [] })

    const emailMembershipDoc = {
      id: 'email-member',
      exists: () => true,
      data: () => ({
        uid: 'user-789',
        role: 'owner',
        storeId: 'store-from-email',
        email: 'email-match@example.com',
      }),
    }

    getDocsMock.mockResolvedValueOnce({ docs: [emailMembershipDoc] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(whereMock).toHaveBeenNthCalledWith(1, 'uid', '==', 'user-789')
    expect(whereMock).toHaveBeenNthCalledWith(2, 'email', '==', 'email-match@example.com')

    expect(result.current.memberships).toEqual([
      {
        id: 'email-member',
        uid: 'user-789',
        role: 'owner',
        storeId: 'store-from-email',
        email: 'email-match@example.com',
        phone: null,
        invitedBy: null,
        firstSignupEmail: null,
        createdAt: null,
        updatedAt: null,
      },
    ])
  })

  it('deduplicates overlapping results while preserving store information from fallbacks', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-999', email: 'dup@example.com' })

    const directDoc = {
      id: 'member-1',
      exists: () => true,
      data: () => ({
        uid: 'user-999',
        role: 'staff',
        storeId: null,
        email: 'dup@example.com',
      }),
    }

    getDocMock.mockResolvedValue(directDoc)

    const uidMembershipDoc = {
      id: 'member-1',
      exists: () => true,
      data: () => ({
        uid: 'user-999',
        role: 'owner',
        storeId: 'store-from-uid',
        email: 'dup@example.com',
      }),
    }

    const anotherMembershipDoc = {
      id: 'member-2',
      exists: () => true,
      data: () => ({
        uid: 'user-999',
        role: 'staff',
        storeId: 'store-2',
        email: 'dup@example.com',
      }),
    }

    getDocsMock.mockResolvedValueOnce({ docs: [uidMembershipDoc, anotherMembershipDoc] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.memberships).toEqual([
      {
        id: 'member-1',
        uid: 'user-999',
        role: 'owner',
        storeId: 'store-from-uid',
        email: 'dup@example.com',
        phone: null,
        invitedBy: null,
        firstSignupEmail: null,
        createdAt: null,
        updatedAt: null,
      },
      {
        id: 'member-2',
        uid: 'user-999',
        role: 'staff',
        storeId: 'store-2',
        email: 'dup@example.com',
        phone: null,
        invitedBy: null,
        firstSignupEmail: null,
        createdAt: null,
        updatedAt: null,
      },
    ])
  })
})
