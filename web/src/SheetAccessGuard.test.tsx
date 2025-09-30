import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { User } from 'firebase/auth'

import SheetAccessGuard from './SheetAccessGuard'
import { useMemberships } from './hooks/useMemberships'

const authMocks = vi.hoisted(() => {
  const state = {
    listeners: [] as Array<(user: User | null) => void>,
    auth: { currentUser: null as User | null },
    signOut: vi.fn(async () => {}),
  }
  return state
})

const firestoreMocks = vi.hoisted(() => {
  const dataByPath = new Map<string, Record<string, unknown>>()

  const docMock = vi.fn((_: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  }))

  const getDocMock = vi.fn(async (ref: { path: string }) => {
    const data = dataByPath.get(ref.path)
    return {
      exists: () => data !== undefined,
      data: () => (data ? { ...data } : undefined),
    }
  })

  return {
    docMock,
    getDocMock,
    dataByPath,
    reset() {
      docMock.mockClear()
      getDocMock.mockClear()
      dataByPath.clear()
    },
  }
})

const activeStoreMocks = vi.hoisted(() => ({
  persistActiveStoreIdForUser: vi.fn(),
  clearActiveStoreIdForUser: vi.fn(),
}))

const membershipHookMocks = vi.hoisted(() => {
  const state = {
    response: { loading: false, error: null as unknown, memberships: [] as unknown[] },
    useMemberships: vi.fn((_: string | null | undefined) => state.response),
    setResponse(response: { loading: boolean; error: unknown; memberships: unknown[] }) {
      state.response = response
    },
    reset() {
      state.response = { loading: false, error: null, memberships: [] }
      state.useMemberships.mockClear()
    },
  }
  return state
})

vi.mock('./firebase', () => ({
  auth: authMocks.auth,
  db: {},
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: User | null) => void) => {
    authMocks.listeners.push(callback)
    callback(authMocks.auth.currentUser)
    return () => {}
  },
  signOut: (...args: unknown[]) => authMocks.signOut(...args),
}))

vi.mock('firebase/firestore', () => ({
  doc: (...args: Parameters<typeof firestoreMocks.docMock>) =>
    firestoreMocks.docMock(...args),
  getDoc: (...args: Parameters<typeof firestoreMocks.getDocMock>) =>
    firestoreMocks.getDocMock(...args),
  collection: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [] })),
  query: vi.fn(),
  where: vi.fn(),
}))

vi.mock('./utils/activeStoreStorage', () => ({
  persistActiveStoreIdForUser: (...args: unknown[]) =>
    activeStoreMocks.persistActiveStoreIdForUser(...args),
  clearActiveStoreIdForUser: (...args: unknown[]) =>
    activeStoreMocks.clearActiveStoreIdForUser(...args),
}))

vi.mock('./hooks/useMemberships', () => ({
  useMemberships: (...args: Parameters<typeof membershipHookMocks.useMemberships>) =>
    membershipHookMocks.useMemberships(...args),
}))

function createUser(): User {
  return {
    uid: 'test-user',
    email: 'user@example.com',
  } as unknown as User
}

function MembershipProbe() {
  useMemberships(null)
  return <p>Child content</p>
}

describe('SheetAccessGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.listeners.splice(0, authMocks.listeners.length)
    firestoreMocks.reset()
    membershipHookMocks.reset()
    authMocks.auth.currentUser = null
  })

  it('persists the active store when a membership assignment exists', async () => {
    const user = createUser()
    authMocks.auth.currentUser = user

    membershipHookMocks.setResponse({
      loading: false,
      error: null,
      memberships: [
        {
          id: 'membership-1',
          uid: user.uid,
          storeId: 'store-123',
          role: 'owner',
        },
      ],
    })

    firestoreMocks.dataByPath.set(`teamMembers/${user.uid}`, {
      storeId: 'store-123',
      status: 'active',
      contractStatus: 'signed',
    })

    render(
      <SheetAccessGuard>
        <MembershipProbe />
      </SheetAccessGuard>,
    )

    await waitFor(() =>
      expect(screen.queryByText('Checking workspace access…')).not.toBeInTheDocument(),
    )

    expect(screen.getByText('Child content')).toBeInTheDocument()
    expect(authMocks.signOut).not.toHaveBeenCalled()
    expect(activeStoreMocks.clearActiveStoreIdForUser).not.toHaveBeenCalled()
    expect(activeStoreMocks.persistActiveStoreIdForUser).toHaveBeenCalledWith(
      user.uid,
      'store-123',
    )
  })

  it('clears the active store and signs out when no membership assignment is found', async () => {
    const user = createUser()
    authMocks.auth.currentUser = user

    membershipHookMocks.setResponse({ loading: false, error: null, memberships: [] })

    render(
      <SheetAccessGuard>
        <MembershipProbe />
      </SheetAccessGuard>,
    )

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'We could not find a workspace assignment for this account.',
      ),
    )

    expect(authMocks.signOut).toHaveBeenCalledWith(authMocks.auth)
    expect(activeStoreMocks.persistActiveStoreIdForUser).not.toHaveBeenCalled()
    expect(activeStoreMocks.clearActiveStoreIdForUser).toHaveBeenCalledWith(user.uid)
  })
})
