import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useMemberships } from './useMemberships'

const mockUseAuthUser = vi.fn()
vi.mock('./useAuthUser', () => ({
  useAuthUser: () => mockUseAuthUser(),
}))

describe('useMemberships', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    mockUseAuthUser.mockReset()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns an empty membership list when the user is not authenticated', async () => {
    mockUseAuthUser.mockReturnValue(null)

    const { result } = renderHook(() => useMemberships(null))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.memberships).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('loads memberships for the authenticated user and normalizes the document shape', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-123' })

    ;(global.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: 'member-doc',
          uid: 'user-123',
          role: 'staff',
          store_id: 'store-abc',
          email: 'member@example.com',
          phone: '+1234567890',
          invited_by: 'owner-1',
          first_signup_email: 'owner@example.com',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
      ],
    })

    const { result } = renderHook(() => useMemberships(null))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url] = (global.fetch as unknown as vi.Mock).mock.calls[0]
    expect(url).toContain('/rest/v1/team_memberships_view')
    expect(url).toContain('uid=eq.user-123')

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
        createdAt: expect.anything(),
        updatedAt: expect.anything(),
      },
    ])
    expect(result.current.error).toBeNull()
  })

  it('falls back to the membership id and null values when fields are missing', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-456' })

    ;(global.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: 'user-456',
          uid: null,
          role: 'unknown-role',
          store_id: null,
          email: null,
          phone: null,
          invited_by: null,
          first_signup_email: null,
          created_at: null,
          updated_at: null,
        },
      ],
    })

    const { result } = renderHook(() => useMemberships(null))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

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

  it('filters memberships by active store when provided', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-789' })

    ;(global.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [],
    })

    renderHook(() => useMemberships('active-store'))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })

    const [url] = (global.fetch as unknown as vi.Mock).mock.calls[0]
    expect(url).toContain('store_id=eq.active-store')
  })

  it('includes fallback membership documents without a uid when a store is assigned', async () => {
    mockUseAuthUser.mockReturnValue({ uid: 'user-abc' })

    ;(global.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [
        {
          id: 'member-1',
          uid: null,
          role: 'owner',
          store_id: 'store-fallback',
          email: null,
          phone: null,
          invited_by: null,
          first_signup_email: null,
          created_at: null,
          updated_at: null,
        },
      ],
    })

    const { result } = renderHook(() => useMemberships(null))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.memberships).toEqual([
      {
        id: 'member-1',
        uid: 'member-1',
        role: 'owner',
        storeId: 'store-fallback',
        email: null,
        phone: null,
        invitedBy: null,
        firstSignupEmail: null,
        createdAt: null,
        updatedAt: null,
      },
    ])
  })
})
