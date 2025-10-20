import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

import { useMemberships } from './useMemberships'

const mockUseAuthUser = vi.fn()
vi.mock('./useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

const collectionMock = vi.fn(() => ({ type: 'collection' }))
const whereMock = vi.fn(() => ({ type: 'where' }))
const queryMock = vi.fn(() => ({ type: 'query' }))
const getDocsMock = vi.fn()

vi.mock('../lib/db', () => ({
  Timestamp: class MockTimestamp {},
  db: { name: 'primary-db' },
  rosterDb: { name: 'roster-db' },
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
}))

describe('useMemberships', () => {
  beforeEach(() => {
    mockUseAuthUser.mockReset()
    collectionMock.mockClear()
    whereMock.mockClear()
    queryMock.mockClear()
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

  it('loads memberships for the authenticated user and normalizes the document shape', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-123' })

    const membershipDoc = {
      id: 'member-doc',
      data: () => ({
        uid: 'user-123',
        role: 'staff',
        storeId: 'store-abc',
        workspaceSlug: 'store-abc-slug',
        email: 'member@example.com',
        phone: '+1234567890',
        invitedBy: 'owner-1',
        firstSignupEmail: 'owner@example.com',
        createdAt: null,
        updatedAt: null,
      }),
    }

    getDocsMock.mockResolvedValueOnce({ docs: [membershipDoc] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(collectionMock).toHaveBeenCalledWith(expect.anything(), 'teamMembers')
    expect(whereMock).toHaveBeenCalledWith('uid', '==', 'user-123')
    expect(queryMock).toHaveBeenCalled()
    expect(getDocsMock).toHaveBeenCalled()

    expect(result.current.memberships).toEqual([
      {
        id: 'member-doc',
        uid: 'user-123',
        role: 'staff',
        storeId: 'store-abc',
        workspaceSlug: 'store-abc-slug',
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

  it('falls back to the document id and null values when fields are missing', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-456' })

    const membershipDoc = {
      id: 'user-456',
      data: () => ({
        role: 'unknown-role',
      }),
    }

    getDocsMock.mockResolvedValueOnce({ docs: [membershipDoc] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.memberships).toEqual([
      {
        id: 'user-456',
        uid: 'user-456',
        role: 'staff',
        storeId: null,
        workspaceSlug: null,
        email: null,
        phone: null,
        invitedBy: null,
        firstSignupEmail: null,
        createdAt: null,
        updatedAt: null,
      },
    ])
  })

  it('treats owner roles with whitespace or casing variations as owner', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-000' })

    const membershipDoc = {
      id: 'member-owner',
      data: () => ({
        uid: 'user-000',
        role: ' Owner ',
        storeId: 'store-123',
        slug: 'workspace-123',
        email: 'owner@example.com',
      }),
    }

    getDocsMock.mockResolvedValueOnce({ docs: [membershipDoc] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.memberships).toEqual([
      {
        id: 'member-owner',
        uid: 'user-000',
        role: 'owner',
        storeId: 'store-123',
        workspaceSlug: 'workspace-123',
        email: 'owner@example.com',
        phone: null,
        invitedBy: null,
        firstSignupEmail: null,
        createdAt: null,
        updatedAt: null,
      },
    ])
  })

  it('automatically retries when connectivity returns', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-789' })

    const membershipDoc = {
      id: 'member-doc',
      data: () => ({
        uid: 'user-789',
        role: 'owner',
        storeId: 'store-xyz',
        workspaceSlug: 'store-xyz',
        email: 'owner@example.com',
        phone: '+233555000',
        invitedBy: 'founder-1',
        firstSignupEmail: 'owner@example.com',
        createdAt: null,
        updatedAt: null,
      }),
    }

    getDocsMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ docs: [membershipDoc] })

    const { result } = renderHook(() => useMemberships())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.memberships).toEqual([])
      expect(result.current.error).toBeInstanceOf(Error)
    })

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.error).toBeNull()
      expect(result.current.memberships).toEqual([
        {
          id: 'member-doc',
          uid: 'user-789',
          role: 'owner',
          storeId: 'store-xyz',
          workspaceSlug: 'store-xyz',
          email: 'owner@example.com',
          phone: '+233555000',
          invitedBy: 'founder-1',
          firstSignupEmail: 'owner@example.com',
          createdAt: null,
          updatedAt: null,
        },
      ])
    })

    expect(getDocsMock).toHaveBeenCalledTimes(2)
  })

})
