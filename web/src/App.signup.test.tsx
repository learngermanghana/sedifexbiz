import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { MemoryRouter } from 'react-router-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => {
  const state = {
    listeners: [] as Array<(user: User | null) => void>,
    auth: {
      currentUser: null as User | null,
      signOut: vi.fn(async () => {
        state.auth.currentUser = null
        state.listeners.forEach(listener => listener(state.auth.currentUser))
      }),
    },
    createUserWithEmailAndPassword: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    configureAuthPersistence: vi.fn(async () => {}),
    persistSession: vi.fn(async () => {}),
    refreshSessionHeartbeat: vi.fn(async () => {}),
    publish: vi.fn(),
    initializeStore: vi.fn(),
    resolveStoreAccess: vi.fn(),
  }
  return state
})

const firestore = vi.hoisted(() => {
  const docRefByPath = new Map<string, { path: string }>()
  let timestampCallCount = 0

  const docMock = vi.fn((_: unknown, ...segments: string[]) => {
    const key = segments.join('/')
    if (!docRefByPath.has(key)) {
      docRefByPath.set(key, { path: key })
    }
    return docRefByPath.get(key)!
  })

  const setDocMock = vi.fn(async () => {})
  const updateDocMock = vi.fn(async () => {})

  const serverTimestampMock = vi.fn(() => {
    timestampCallCount += 1
    return { __type: 'serverTimestamp', order: timestampCallCount }
  })

  return {
    docMock,
    setDocMock,
    updateDocMock,
    serverTimestampMock,
    docRefByPath,
    reset() {
      docMock.mockClear()
      setDocMock.mockClear()
      updateDocMock.mockClear()
      serverTimestampMock.mockClear()
      docRefByPath.clear()
      timestampCallCount = 0
    },
  }
})

vi.mock('./firebase', () => ({
  auth: mocks.auth,
  db: {},
}))

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    mocks.createUserWithEmailAndPassword(...args),
  signInWithEmailAndPassword: (...args: unknown[]) =>
    mocks.signInWithEmailAndPassword(...args),
  onAuthStateChanged: (_auth: unknown, callback: (user: User | null) => void) => {
    mocks.listeners.push(callback)
    callback(mocks.auth.currentUser)
    return () => {}
  },
}))

vi.mock('firebase/firestore', () => ({
  doc: (...args: Parameters<typeof firestore.docMock>) => firestore.docMock(...args),
  setDoc: (...args: Parameters<typeof firestore.setDocMock>) => firestore.setDocMock(...args),
  updateDoc: (...args: Parameters<typeof firestore.updateDocMock>) => firestore.updateDocMock(...args),
  serverTimestamp: (
    ...args: Parameters<typeof firestore.serverTimestampMock>
  ) => firestore.serverTimestampMock(...args),
  Timestamp: class MockTimestamp {
    static fromMillis(value: number) {
      return { __type: 'timestamp', millis: value }
    }
  },
}))

vi.mock('./controllers/sessionController', async () => {
  const actual = await vi.importActual<typeof import('./controllers/sessionController')>(
    './controllers/sessionController',
  )

  return {
    ...actual,
    configureAuthPersistence: (...args: unknown[]) => mocks.configureAuthPersistence(...args),
    persistSession: async (...args: Parameters<typeof actual.persistSession>) => {
      await mocks.persistSession(...args)
      return actual.persistSession(...args)
    },
    refreshSessionHeartbeat: (...args: unknown[]) => mocks.refreshSessionHeartbeat(...args),
  }
})

vi.mock('./components/ToastProvider', () => ({
  useToast: () => ({ publish: mocks.publish }),
}))

vi.mock('./controllers/accessController', () => ({
  initializeStore: (...args: unknown[]) => mocks.initializeStore(...args),
  resolveStoreAccess: (...args: unknown[]) => mocks.resolveStoreAccess(...args),
}))

import App from './App'

function createTestUser() {
  const deleteFn = vi.fn(async () => {})
  const testUser = {
    uid: 'test-user',
    email: 'owner@example.com',
    delete: deleteFn,
    getIdToken: vi.fn(async () => 'token'),
  } as unknown as User
  return { user: testUser, deleteFn }
}

describe('App signup cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.currentUser = null
    mocks.listeners.splice(0, mocks.listeners.length)
    firestore.reset()
    mocks.initializeStore.mockReset()
    mocks.resolveStoreAccess.mockReset()
  })

  it('surfaces signup errors without deleting the new account', async () => {
    const user = userEvent.setup()
    const { user: createdUser, deleteFn } = createTestUser()

    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = createdUser
      mocks.listeners.forEach(listener => listener(createdUser))
      return { user: createdUser }
    })

    mocks.persistSession.mockRejectedValueOnce(new Error('Unable to persist session'))

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.configureAuthPersistence).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByText(/Checking your session/i)).not.toBeInTheDocument(),
    )

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: /Sign up/i }))
      await user.type(screen.getByLabelText(/Email/i), 'owner@example.com')
      await user.type(screen.getByLabelText(/Full name/i), 'Morgan Owner')
      await user.type(screen.getByLabelText(/Business name/i), 'Morgan Retail Co')
      await user.type(screen.getByLabelText(/Phone/i), '5551234567')
      await user.type(screen.getByLabelText(/Country/i), 'Canada')
      await user.type(screen.getByLabelText(/Town or city/i), 'Toronto')
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')

      await user.click(screen.getByRole('button', { name: /Create account/i }))
    })

    await waitFor(() => expect(mocks.persistSession).toHaveBeenCalled())

    expect(deleteFn).not.toHaveBeenCalled()
    expect(mocks.auth.signOut).not.toHaveBeenCalled()
    expect(mocks.auth.currentUser).toBe(createdUser)
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', message: 'Unable to persist session' }),
    )
  })

  it('persists workspace metadata without seeding store/team/product docs on signup success', async () => {
    const user = userEvent.setup()
    const { user: createdUser } = createTestUser()

    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = createdUser
      mocks.listeners.forEach(listener => listener(createdUser))
      return { user: createdUser }
    })

    mocks.initializeStore.mockResolvedValueOnce({ storeId: 'workspace-store-id', claims: {} })
    mocks.resolveStoreAccess.mockResolvedValueOnce({
      ok: true,
      storeId: 'workspace-store-id',
      workspaceSlug: 'workspace-store-id',
      role: 'staff',
      claims: {},
    })

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.configureAuthPersistence).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByText(/Checking your session/i)).not.toBeInTheDocument(),
    )

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: /Sign up/i }))
      await user.type(screen.getByLabelText(/Email/i), 'owner@example.com')
      await user.type(screen.getByLabelText(/Full name/i), 'Morgan Owner')
      await user.type(screen.getByLabelText(/Business name/i), 'Morgan Retail Co')
      await user.type(screen.getByLabelText(/Phone/i), ' (555) 123-4567 ')
      await user.type(screen.getByLabelText(/Country/i), 'United States')
      await user.type(screen.getByLabelText(/Town or city/i), 'Seattle')
      await user.click(screen.getByLabelText(/team member/i))
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')

      await user.click(screen.getByRole('button', { name: /Create account/i }))
    })

    await waitFor(() => expect(mocks.persistSession).toHaveBeenCalledTimes(2))
    const firstPersistCall = mocks.persistSession.mock.calls[0]
    expect(firstPersistCall?.[0]).toBe(createdUser)
    expect(firstPersistCall?.[1]).toBeUndefined()

    const secondPersistCall = mocks.persistSession.mock.calls[1]
    expect(secondPersistCall?.[0]).toBe(createdUser)
    expect(secondPersistCall?.[1]).toEqual({
      storeId: 'workspace-store-id',
      workspaceSlug: 'workspace-store-id',
      role: 'staff',
    })
    await waitFor(() =>
      expect(mocks.initializeStore).toHaveBeenCalledWith({
        phone: '5551234567',
        firstSignupEmail: 'owner@example.com',
        ownerName: 'Morgan Owner',
        businessName: 'Morgan Retail Co',
        country: 'United States',
        town: 'Seattle',
        signupRole: 'team-member',
      }),
    )
    await waitFor(() =>
      expect(mocks.resolveStoreAccess).toHaveBeenCalledWith('workspace-store-id'),
    )

    const ownerDocKey = `teamMembers/${createdUser.uid}`
    const customerDocKey = `customers/${createdUser.uid}`
    const ownerDocRef = firestore.docRefByPath.get(ownerDocKey)
    const customerDocRef = firestore.docRefByPath.get(customerDocKey)

    // Signup should only persist user metadata for the customer profile. All store/team/product
    // documents are created later by backend workspace resolution, not seeded from the client.
    expect(ownerDocRef).toBeUndefined()
    expect(customerDocRef).toBeDefined()

    const setDocCalls = firestore.setDocMock.mock.calls
    const customerCall = setDocCalls.find(([ref]) => ref === customerDocRef)
    expect(customerCall).toBeDefined()

    const unrelatedWrites = setDocCalls.filter(([ref]) => {
      const path = ref?.path ?? ''
      return path.startsWith('teamMembers/') || path.startsWith('stores/') || path.startsWith('products/')
    })
    expect(unrelatedWrites).toHaveLength(0)

    await waitFor(() => expect(mocks.auth.signOut).toHaveBeenCalled())
    expect(mocks.auth.currentUser).toBeNull()

    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'success',
        message: 'Account created! You can now sign in.',
      }),
    )
  })

  it('signs the user out without deleting the account when store access resolution fails', async () => {
    const user = userEvent.setup()
    const { user: createdUser, deleteFn } = createTestUser()

    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = createdUser
      mocks.listeners.forEach(listener => listener(createdUser))
      return { user: createdUser }
    })

    mocks.initializeStore.mockResolvedValueOnce({ storeId: 'store-001', claims: {} })
    mocks.resolveStoreAccess.mockRejectedValueOnce(
      new Error(
        'We could not confirm the store ID assigned to your Sedifex workspace. Reach out to your Sedifex administrator.',
      ),
    )

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.configureAuthPersistence).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByText(/Checking your session/i)).not.toBeInTheDocument(),
    )

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: /Sign up/i }))
      await user.type(screen.getByLabelText(/Email/i), 'owner@example.com')
      await user.type(screen.getByLabelText(/Full name/i), 'Morgan Owner')
      await user.type(screen.getByLabelText(/Business name/i), 'Morgan Retail Co')
      await user.type(screen.getByLabelText(/Phone/i), '5551234567')
      await user.type(screen.getByLabelText(/Country/i), 'Kenya')
      await user.type(screen.getByLabelText(/Town or city/i), 'Nairobi')
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')

      await user.click(screen.getByRole('button', { name: /Create account/i }))
    })

    await waitFor(() =>
      expect(mocks.initializeStore).toHaveBeenCalledWith({
        phone: '5551234567',
        firstSignupEmail: 'owner@example.com',
        ownerName: 'Morgan Owner',
        businessName: 'Morgan Retail Co',
        country: 'Kenya',
        town: 'Nairobi',
        signupRole: 'owner',
      }),
    )
    await waitFor(() => expect(mocks.resolveStoreAccess).toHaveBeenCalledWith('store-001'))

    await waitFor(() => expect(mocks.auth.signOut).toHaveBeenCalled())
    expect(deleteFn).not.toHaveBeenCalled()
    expect(mocks.auth.currentUser).toBeNull()

    const seededWrites = firestore.setDocMock.mock.calls.filter(([ref]) => {
      const path = ref?.path ?? ''
      return (
        path.startsWith('teamMembers/') ||
        path.startsWith('customers/') ||
        path.startsWith('stores/') ||
        path.startsWith('products/')
      )
    })
    expect(seededWrites).toHaveLength(0)
    expect(firestore.docRefByPath.has(`teamMembers/${createdUser.uid}`)).toBe(false)
    expect(firestore.docRefByPath.has(`customers/${createdUser.uid}`)).toBe(false)

    await waitFor(() =>
      expect(mocks.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          message:
            'We could not confirm the store ID assigned to your Sedifex workspace. Reach out to your Sedifex administrator.',
        }),
      ),
    )
  })
})

describe('App login store metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.currentUser = null
    mocks.listeners.splice(0, mocks.listeners.length)
    firestore.reset()
    mocks.resolveStoreAccess.mockReset()
  })

  it('does not create store documents during login workspace resolution', async () => {
    const user = userEvent.setup()
    const { user: existingUser } = createTestUser()

    mocks.signInWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = existingUser
      mocks.listeners.forEach(listener => listener(existingUser))
      return { user: existingUser }
    })

    mocks.resolveStoreAccess.mockResolvedValueOnce({
      ok: true,
      storeId: 'workspace-store-id',
      workspaceSlug: 'workspace-store-id',
      role: 'staff',
      claims: {},
    })

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.configureAuthPersistence).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByText(/Checking your session/i)).not.toBeInTheDocument(),
    )

    await act(async () => {
      await user.type(screen.getByLabelText(/Email/i), 'owner@example.com')
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.click(screen.getByRole('button', { name: /Log in/i }))
    })

    await waitFor(() => expect(mocks.signInWithEmailAndPassword).toHaveBeenCalled())
    await waitFor(() => expect(mocks.resolveStoreAccess).toHaveBeenCalled())

    expect(firestore.docRefByPath.has(`stores/${existingUser.uid}`)).toBe(false)

    const storeWrites = firestore.setDocMock.mock.calls.filter(([ref]) =>
      (ref?.path ?? '').startsWith('stores/'),
    )
    expect(storeWrites).toHaveLength(0)
  })
})
