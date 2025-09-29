import { describe, beforeEach, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useActiveStore } from './useActiveStore'
import { getActiveStoreStorageKey } from '../utils/activeStoreStorage'

const mockUseMemberships = vi.fn()
const mockUseAuthUser = vi.fn()

vi.mock('./useMemberships', () => ({
  useMemberships: (storeId?: string | null) => mockUseMemberships(storeId),
}))

vi.mock('./useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

describe('useActiveStore', () => {
  beforeEach(() => {
    mockUseMemberships.mockReset()
    mockUseAuthUser.mockReset()
    window.localStorage.clear()
    mockUseAuthUser.mockReturnValue({ uid: 'user-1' })
  })

  it('prefers the persisted store id when it matches the membership store', async () => {
    mockUseMemberships.mockImplementation(storeId =>
      storeId === undefined
        ? { memberships: [], loading: true, error: null }
        : {
            memberships: [{ id: 'member-1', storeId: 'matching-store' }],
            loading: false,
            error: null,
          },
    )

    const storageKey = getActiveStoreStorageKey('user-1')
    window.localStorage.setItem(storageKey, 'matching-store')

    const { result } = renderHook(() => useActiveStore())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.storeId).toBe('matching-store')
    expect(result.current.error).toBeNull()
  })

  it('updates the persisted store id when membership store differs', async () => {
    mockUseMemberships.mockImplementation(storeId =>
      storeId === undefined
        ? { memberships: [], loading: true, error: null }
        : {
            memberships: [{ id: 'member-1', storeId: 'membership-store' }],
            loading: false,
            error: null,
          },
    )

    const storageKey = getActiveStoreStorageKey('user-1')
    window.localStorage.setItem(storageKey, 'persisted-store')

    const { result } = renderHook(() => useActiveStore())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.storeId).toBe('membership-store')
    })

    expect(window.localStorage.getItem(storageKey)).toBe('membership-store')
  })

  it('falls back to the membership store id when nothing is persisted', async () => {
    mockUseMemberships.mockImplementation(storeId =>
      storeId === undefined
        ? { memberships: [], loading: true, error: null }
        : {
            memberships: [
              { id: 'member-1', storeId: 'membership-store' },
              { id: 'member-2', storeId: 'membership-store-2' },
            ],
            loading: false,
            error: null,
          },
    )

    const { result } = renderHook(() => useActiveStore())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.storeId).toBe('membership-store')
  })

  it('resets the active store when switching to a different user', async () => {
    let currentUser: { uid: string } = { uid: 'user-1' }
    mockUseAuthUser.mockImplementation(() => currentUser)

    mockUseMemberships.mockImplementation(storeId => {
      if (storeId === undefined) {
        return { memberships: [], loading: true, error: null }
      }

      if (currentUser.uid === 'user-1') {
        return {
          memberships: [{ id: 'member-1', storeId: 'user-1-store' }],
          loading: false,
          error: null,
        }
      }

      return {
        memberships: [{ id: 'member-2', storeId: 'user-2-store' }],
        loading: false,
        error: null,
      }
    })

    const user1Key = getActiveStoreStorageKey('user-1')
    window.localStorage.setItem(user1Key, 'user-1-store')

    const { result, rerender } = renderHook(() => useActiveStore())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.storeId).toBe('user-1-store')
    })

    currentUser = { uid: 'user-2' }
    const user2Key = getActiveStoreStorageKey('user-2')
    window.localStorage.setItem(user2Key, 'user-2-store')
    rerender()

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.storeId).toBe('user-2-store')
    })

    expect(window.localStorage.getItem(user1Key)).toBe('user-1-store')
    expect(window.localStorage.getItem(user2Key)).toBe('user-2-store')
  })
})
