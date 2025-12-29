import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    bootstrapStoreContext: vi.fn(async () => state.resolveStoreAccess()),
    resolveStoreAccess: vi.fn(async () => ({
      ok: true,
      storeId: 'store-123',
      workspaceSlug: 'workspace-123',
      role: 'owner',
    })),
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
  signOut: (...args: unknown[]) => mocks.auth.signOut(...args),
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
  collection: (_db: unknown, path: string) => ({ __type: 'collection', path }),
  query: (collectionRef: unknown, ...constraints: unknown[]) => ({
    __type: 'query',
    collectionRef,
    constraints,
  }),
  where: (fieldPath: string, opStr: string, value: unknown) => ({
    __type: 'where',
    fieldPath,
    opStr,
    value,
  }),
  onSnapshot: (_ref: unknown, callback: (snapshot: unknown) => void) => {
    callback({ docs: [], exists: () => false, data: () => ({}) })
    return () => {}
  },
  limit: (count: number) => ({ __type: 'limit', count }),
  getDocs: async (_query: unknown) => ({ docs: [] }),
  getDoc: async (_ref: unknown) => ({ exists: () => false, id: 'mock-doc', data: () => ({}) }),
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
  bootstrapStoreContext: (...args: unknown[]) => mocks.bootstrapStoreContext(...args),
  resolveStoreAccess: (...args: unknown[]) => mocks.resolveStoreAccess(...args),
}))

import App from './App'
import Onboarding from './pages/Onboarding'

function renderApp() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <App />,
      children: [
        { index: true, element: <div>Home</div> },
        { path: 'onboarding', element: <Onboarding /> },
      ],
    },
  ])

  return render(<RouterProvider router={router} />)
}

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

  it('prevents signup when passwords do not match', async () => {
    const user = userEvent.setup()

    renderApp()

    await waitFor(() => expect(mocks.configureAuthPersistence).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Checking your session/i)).not.toBeInTheDocument())

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: /Sign up/i }))
      await user.type(screen.getByLabelText(/Email/i), 'owner@example.com')
      await user.type(screen.getByLabelText(/Full name/i), 'Morgan Owner')
      await user.type(screen.getByLabelText(/Business name/i), 'Morgan Retail Co')
      await user.type(screen.getByLabelText(/Phone/i), '5551234567')
      await user.type(screen.getByLabelText(/Country/i), 'Canada')
      await user.type(screen.getByLabelText(/Town or city/i), 'Toronto')
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password2!')
    })

    await act(async () => {
      fireEvent.submit(screen.getByLabelText(/Sign up form/i))
    })

    expect(mocks.createUserWithEmailAndPassword).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match. Please re-enter them.'),
    )
  })

  it('disables signup until passwords match and meet strength requirements', async () => {
    const user = userEvent.setup()

    renderApp()

    await waitFor(() => expect(mocks.configureAuthPersistence).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Checking your session/i)).not.toBeInTheDocument())

    await act(async () => {
      await user.click(screen.getByRole('tab', { name: /Sign up/i }))
      await user.type(screen.getByLabelText(/Email/i), 'owner@example.com')
      await user.type(screen.getByLabelText(/Full name/i), 'Morgan Owner')
      await user.type(screen.getByLabelText(/Business name/i), 'Morgan Retail Co')
      await user.type(screen.getByLabelText(/Phone/i), '5551234567')
      await user.type(screen.getByLabelText(/Country/i), 'Canada')
      await user.type(screen.getByLabelText(/Town or city/i), 'Toronto')
      await user.type(screen.getByLabelText(/^Password$/i), 'weak')
      await user.type(screen.getByLabelText(/Confirm password/i), 'weak')
    })

    const submitButton = screen.getByRole('button', { name: /Start free trial/i })
    expect(submitButton).toBeDisabled()

    await act(async () => {
      await user.clear(screen.getByLabelText(/^Password$/i))
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.clear(screen.getByLabelText(/Confirm password/i))
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')
    })

    expect(submitButton).not.toBeDisabled()

    await act(async () => {
      await user.clear(screen.getByLabelText(/Confirm password/i))
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1')
    })

    expect(submitButton).toBeDisabled()
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

    renderApp()

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

      await user.click(screen.getByRole('button', { name: /Start free trial/i }))
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

    renderApp()

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
      await user.type(screen.getByLabelText(/Store ID/i), 'workspace-store-id')
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')

      await user.click(screen.getByRole('button', { name: /Start free trial/i }))
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
      expect(mocks.initializeStore).toHaveBeenCalledWith(
        {
          phone: '5551234567',
          firstSignupEmail: 'owner@example.com',
          ownerName: 'Morgan Owner',
          businessName: 'Morgan Retail Co',
          country: 'United States',
          town: 'Seattle',
          signupRole: 'team-member',
        },
        'workspace-store-id',
      ),
    )
    await waitFor(() =>
      expect(mocks.resolveStoreAccess).toHaveBeenCalledWith('workspace-store-id'),
    )

    const ownerDocKey = `teamMembers/${createdUser.uid}`
    const customerDocKey = `customers/${createdUser.uid}`
    const ownerDocRef = firestore.docRefByPath.get(ownerDocKey)
    const customerDocRef = firestore.docRefByPath.get(customerDocKey)

    expect(ownerDocRef).toBeDefined()
    expect(customerDocRef).toBeDefined()

    const setDocCalls = firestore.setDocMock.mock.calls
    const customerCall = setDocCalls.find(([ref]) => ref === customerDocRef)
    expect(customerCall).toBeDefined()

    const pendingStaffCall = setDocCalls.find(([ref]) => ref === ownerDocRef)
    expect(pendingStaffCall?.[1]).toMatchObject({
      uid: createdUser.uid,
      storeId: 'workspace-store-id',
      role: 'staff',
      status: 'pending',
      email: 'owner@example.com',
    })

    const unrelatedWrites = setDocCalls.filter(([ref]) => {
      const path = ref?.path ?? ''
      return path.startsWith('stores/') || path.startsWith('products/')
    })
    expect(unrelatedWrites).toHaveLength(0)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /Welcome to Sedifex/i }),
      ).toBeInTheDocument(),
    )

    expect(mocks.auth.signOut).not.toHaveBeenCalled()
    expect(mocks.auth.currentUser).toBe(createdUser)

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

    renderApp()

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

      await user.click(screen.getByRole('button', { name: /Start free trial/i }))
    })

    await waitFor(() =>
      expect(mocks.initializeStore).toHaveBeenCalledWith(
        {
          phone: '5551234567',
          firstSignupEmail: 'owner@example.com',
          ownerName: 'Morgan Owner',
          businessName: 'Morgan Retail Co',
          country: 'Kenya',
          town: 'Nairobi',
          signupRole: 'owner',
        },
        null,
      ),
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
