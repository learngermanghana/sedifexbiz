import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { MemoryRouter } from 'react-router-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** ---------------- hoisted state/mocks ---------------- */
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
    resolveStoreAccess: vi.fn(),
    afterSignupBootstrap: vi.fn(async () => {}),
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

const sheet = vi.hoisted(() => {
  const fetchSheetRowsMock = vi.fn(async () => {
    throw new Error('sheet fetch failed')
  })
  const findUserRowMock = vi.fn(() => null)
  const isContractActiveMock = vi.fn(() => false)

  return {
    fetchSheetRowsMock,
    findUserRowMock,
    isContractActiveMock,
    reset() {
      fetchSheetRowsMock.mockReset()
      findUserRowMock.mockReset()
      isContractActiveMock.mockReset()
      fetchSheetRowsMock.mockImplementation(async () => {
        throw new Error('sheet fetch failed')
      })
      findUserRowMock.mockReturnValue(null)
      isContractActiveMock.mockReturnValue(false)
    },
  }
})

/** ---------------- module mocks ---------------- */
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
  resolveStoreAccess: (...args: unknown[]) => mocks.resolveStoreAccess(...args),
  afterSignupBootstrap: (...args: unknown[]) => mocks.afterSignupBootstrap(...args),
}))

// IMPORTANT: mock the sheet fallback to be deterministic when a test expects cleanup
vi.mock('./sheetClient', () => ({
  fetchSheetRows: (...args: unknown[]) => sheet.fetchSheetRowsMock(...args),
  findUserRow: (...args: unknown[]) => sheet.findUserRowMock(...args),
  isContractActive: (...args: unknown[]) => sheet.isContractActiveMock(...args),
}))

/** ---------------- imports after mocks ---------------- */
import App from './App'

/** ---------------- helpers ---------------- */
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

let localStorageSetItemSpy: ReturnType<typeof vi.spyOn>

describe('App signup cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.currentUser = null
    mocks.listeners.splice(0, mocks.listeners.length)
    firestore.reset()
    mocks.resolveStoreAccess.mockReset()
    mocks.resolveStoreAccess.mockResolvedValue(null)

    mocks.afterSignupBootstrap.mockReset()
    mocks.afterSignupBootstrap.mockImplementation(async () => {})

    window.localStorage.clear()
    localStorageSetItemSpy = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterEach(() => {
    localStorageSetItemSpy.mockRestore()
  })

  it('surfaces signup errors without deleting the new account', async () => {
    const user = userEvent.setup()
    const { user: createdUser, deleteFn } = createTestUser()

    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = createdUser
      mocks.listeners.forEach(listener => listener(createdUser))
      return { user: createdUser }
    })

    // Force the very first persistSession to fail
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
      await user.type(screen.getByLabelText(/Store ID/i), 'store-001')
      await user.type(screen.getByLabelText(/Phone/i), '5551234567')
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
    expect(localStorageSetItemSpy).not.toHaveBeenCalled()
  })

  it('persists metadata and seeds the workspace after a successful signup', async () => {
    const user = userEvent.setup()
    const { user: createdUser } = createTestUser()

    // Successful create + callable returns seed data
    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = createdUser
      mocks.listeners.forEach(listener => listener(createdUser))
      return { user: createdUser }
    })

    mocks.resolveStoreAccess.mockImplementation(async storeId => {
      if (!storeId) return null
      return {
        ok: true,
        storeId: 'sheet-store-id',
        role: 'staff',
        teamMember: { id: 'seed-team-member', data: { name: 'Seeded Member' } },
        store: { id: 'sheet-store-id', data: { name: 'Seeded Store' } },
        products: [
          {
            id: 'product-1',
            data: {
              name: 'Seed Product',
              createdAt: 1_700_000_000_000,
            },
          },
        ],
        customers: [
          {
            id: 'seeded-customer',
            data: { name: 'Seeded Customer' },
          },
        ],
      }
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
      await user.type(screen.getByLabelText(/Store ID/i), '  sheet-store-id  ')
      await user.type(screen.getByLabelText(/Phone/i), ' (555) 123-4567 ')
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')
      await user.click(screen.getByRole('button', { name: /Create account/i }))
    })

    await waitFor(() => expect(mocks.persistSession).toHaveBeenCalled())
    await waitFor(() => expect(mocks.afterSignupBootstrap).toHaveBeenCalledWith('sheet-store-id'))
    await waitFor(() =>
      expect(mocks.resolveStoreAccess).toHaveBeenCalledWith('sheet-store-id'),
    )

    const { docRefByPath, setDocMock } = firestore
    const ownerDocKey = `teamMembers/${createdUser.uid}`
    const customerDocKey = `customers/${createdUser.uid}`
    const seededTeamMemberDocKey = 'teamMembers/seed-team-member'
    const seededStoreDocKey = 'stores/sheet-store-id'
    const seededProductDocKey = 'products/product-1'
    const seededCustomerDocKey = 'customers/seeded-customer'

    const ownerDocRef = docRefByPath.get(ownerDocKey)
    const customerDocRef = docRefByPath.get(customerDocKey)
    const seededTeamMemberDocRef = docRefByPath.get(seededTeamMemberDocKey)
    const seededStoreDocRef = docRefByPath.get(seededStoreDocKey)
    const seededProductDocRef = docRefByPath.get(seededProductDocKey)
    const seededCustomerDocRef = docRefByPath.get(seededCustomerDocKey)

    expect(ownerDocRef).toBeDefined()
    expect(customerDocRef).toBeDefined()
    expect(seededTeamMemberDocRef).toBeDefined()
    expect(seededStoreDocRef).toBeDefined()
    expect(seededProductDocRef).toBeDefined()
    expect(seededCustomerDocRef).toBeDefined()

    const setDocCalls = setDocMock.mock.calls

    const ownerCalls = setDocCalls.filter(([ref]) => ref === ownerDocRef)
    expect(ownerCalls).toHaveLength(2)

    const [, ensurePayload, ensureOptions] = ownerCalls[0]!
    expect(ensurePayload).toEqual(
      expect.objectContaining({
        uid: createdUser.uid,
        storeId: 'sheet-store-id',
        role: 'staff',
      }),
    )
    expect(ensureOptions).toEqual({ merge: true })

    const metadataCall = ownerCalls.find(([, payload]) =>
      Object.prototype.hasOwnProperty.call(payload as Record<string, unknown>, 'phone'),
    )
    expect(metadataCall).toBeDefined()
    const [, ownerPayload, ownerOptions] = metadataCall!
    expect(ownerPayload).toEqual(
      expect.objectContaining({
        storeId: 'sheet-store-id',
        name: 'Owner account',
        phone: '5551234567',
        email: 'owner@example.com',
        role: 'staff',
        createdAt: expect.objectContaining({ __type: 'serverTimestamp' }),
        updatedAt: expect.objectContaining({ __type: 'serverTimestamp' }),
      }),
    )
    expect(ownerOptions).toEqual({ merge: true })

    const customerCall = setDocCalls.find(([ref]) => ref === customerDocRef)
    expect(customerCall).toBeDefined()
    const [, customerPayload, customerOptions] = customerCall!
    expect(customerPayload).toEqual(
      expect.objectContaining({
        storeId: 'sheet-store-id',
        name: 'owner@example.com',
        displayName: 'owner@example.com',
        email: 'owner@example.com',
        phone: '5551234567',
        status: 'active',
        role: 'client',
        createdAt: expect.objectContaining({ __type: 'serverTimestamp' }),
        updatedAt: expect.objectContaining({ __type: 'serverTimestamp' }),
      }),
    )
    expect(customerOptions).toEqual({ merge: true })

    const seededTeamMemberCall = setDocCalls.find(([ref]) => ref === seededTeamMemberDocRef)
    expect(seededTeamMemberCall?.[1]).toEqual(
      expect.objectContaining({ name: 'Seeded Member' }),
    )

    const seededStoreCall = setDocCalls.find(([ref]) => ref === seededStoreDocRef)
    expect(seededStoreCall?.[1]).toEqual(expect.objectContaining({ name: 'Seeded Store' }))

    const seededProductCall = setDocCalls.find(([ref]) => ref === seededProductDocRef)
    expect(seededProductCall?.[1]).toEqual(
      expect.objectContaining({
        name: 'Seed Product',
        createdAt: expect.objectContaining({ __type: 'timestamp', millis: 1_700_000_000_000 }),
      }),
    )

    const seededCustomerCall = setDocCalls.find(([ref]) => ref === seededCustomerDocRef)
    expect(seededCustomerCall?.[1]).toEqual(expect.objectContaining({ name: 'Seeded Customer' }))

    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'success', message: expect.stringMatching(/All set/i) }),
    )
    expect(localStorageSetItemSpy).toHaveBeenCalledWith('activeStoreId', 'sheet-store-id')
    expect(window.localStorage.getItem('activeStoreId')).toBe('sheet-store-id')
  })

  it('ensures a team member profile exists when login falls back to the sheet', async () => {
    const user = userEvent.setup()
    const { user: existingUser } = createTestUser()

    mocks.signInWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = existingUser
      return { user: existingUser }
    })

    mocks.resolveStoreAccess.mockImplementationOnce(async () => {
      throw new Error('callable failed')
    })

    sheet.fetchSheetRowsMock.mockResolvedValue([{ id: 'row-1' }])
    sheet.findUserRowMock.mockImplementation(() => ({ storeId: 'sheet-store', role: 'Owner' }))
    sheet.isContractActiveMock.mockReturnValue(true)

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
    await waitFor(() => expect(sheet.fetchSheetRowsMock).toHaveBeenCalled())
    await waitFor(() => expect(localStorageSetItemSpy).toHaveBeenCalledWith('activeStoreId', 'sheet-store'))

    // Delay notifying auth listeners until after the login flow resolves to avoid
    // races with the restore-side effect that also performs a sheet fallback.
    await act(async () => {
      mocks.listeners.forEach(listener => listener(existingUser))
    })

    const { docRefByPath, setDocMock } = firestore
    await waitFor(() => {
      const profileRef = docRefByPath.get(`teamMembers/${existingUser.uid}`)
      expect(profileRef).toBeDefined()
    })
    await waitFor(() => {
      const hasProfileCall = setDocMock.mock.calls.some(([ref]) =>
        Boolean(ref && typeof ref === 'object' && (ref as { path?: string }).path === `teamMembers/${existingUser.uid}`),
      )
      expect(hasProfileCall).toBe(true)
    })

    const profileCall = setDocMock.mock.calls.find(([ref]) => {
      return Boolean(ref && typeof ref === 'object' && (ref as { path?: string }).path === `teamMembers/${existingUser.uid}`)
    })
    expect(profileCall).toBeDefined()
    const [profileRef, profilePayload, profileOptions] = profileCall!
    expect(profileRef).toEqual(expect.objectContaining({ path: `teamMembers/${existingUser.uid}` }))
    expect(profilePayload).toEqual(
      expect.objectContaining({
        uid: existingUser.uid,
        storeId: 'sheet-store',
        role: 'owner',
      }),
    )
    expect(profileOptions).toEqual({ merge: true })
    expect(window.localStorage.getItem('activeStoreId')).toBe('sheet-store')
  })

  it('cleans up the account when store access resolution fails (callable + sheet fallback)', async () => {
    const user = userEvent.setup()
    const { user: createdUser, deleteFn } = createTestUser()

    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = createdUser
      mocks.listeners.forEach(listener => listener(createdUser))
      return { user: createdUser }
    })

    // Callable fails when invoked with a store ID (sheet fallback already mocked to fail)
    mocks.resolveStoreAccess.mockImplementation(async storeId => {
      if (!storeId) return null
      throw new Error(
        'We could not confirm the store ID assigned to your Sedifex workspace. Reach out to your Sedifex administrator.',
      )
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
      await user.type(screen.getByLabelText(/Store ID/i), 'store-001')
      await user.type(screen.getByLabelText(/Phone/i), '5551234567')
      await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
      await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')
      await user.click(screen.getByRole('button', { name: /Create account/i }))
    })

    await waitFor(() => expect(mocks.resolveStoreAccess).toHaveBeenCalledWith('store-001'))
    await waitFor(() => expect(deleteFn).toHaveBeenCalled())
    expect(mocks.auth.signOut).toHaveBeenCalled()
    expect(mocks.auth.currentUser).toBeNull()

    // Ensure no seeded writes happened
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
  })
})
