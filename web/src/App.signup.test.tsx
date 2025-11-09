import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'

const signupConfigMock = vi.hoisted(() => ({
  paymentUrl: 'https://billing.example.com/checkout',
  salesEmail: 'billing@example.com',
  salesBookingUrl: 'https://calendly.com/sedifex/demo',
}))

const mocks = vi.hoisted(() => {
  const listeners: Array<(user: User | null) => void> = []
  const auth = {
    currentUser: null as User | null,
    signOut: vi.fn(async () => {
      auth.currentUser = null
      listeners.forEach(listener => listener(auth.currentUser))
    }),
  }

  return {
    listeners,
    auth,
    createUserWithEmailAndPassword: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    configureAuthPersistence: vi.fn(async () => {}),
    ensureStoreDocument: vi.fn(async () => {}),
    persistSession: vi.fn(async () => {}),
    refreshSessionHeartbeat: vi.fn(async () => {}),
    publish: vi.fn(),
    initializeStore: vi.fn(),
    resolveStoreAccess: vi.fn(async () => ({
      ok: true,
      storeId: 'store-123',
      role: 'owner',
      claims: {},
      teamMember: null,
      store: null,
      products: [],
      customers: [],
    })),
  }
})

const paidMarkerMocks = vi.hoisted(() => ({
  getPaidMarker: vi.fn(() => null),
  clearPaidMarker: vi.fn(),
}))

const clearActiveStoreIdForUserMock = vi.hoisted(() => vi.fn())

vi.mock('./config/signup', () => ({ signupConfig: signupConfigMock }))

vi.mock('./firebase', () => ({
  auth: mocks.auth,
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

vi.mock('./lib/db', () => ({
  db: {},
  rosterDb: {},
  doc: vi.fn(() => ({})),
  setDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => ({})),
  Timestamp: class MockTimestamp {
    static fromMillis(value: number) {
      return { __type: 'timestamp', millis: value }
    }
  },
}))

vi.mock('./controllers/sessionController', () => ({
  configureAuthPersistence: (...args: unknown[]) => mocks.configureAuthPersistence(...args),
  ensureStoreDocument: (...args: unknown[]) => mocks.ensureStoreDocument(...args),
  persistSession: (...args: unknown[]) => mocks.persistSession(...args),
  refreshSessionHeartbeat: (...args: unknown[]) => mocks.refreshSessionHeartbeat(...args),
}))

vi.mock('./controllers/accessController', () => ({
  initializeStore: (...args: unknown[]) => mocks.initializeStore(...args),
  resolveStoreAccess: (...args: unknown[]) => mocks.resolveStoreAccess(...args),
  extractCallableErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'An unexpected error occurred.',
  INACTIVE_WORKSPACE_MESSAGE: 'Your workspace is inactive.',
}))

vi.mock('./lib/paid', () => ({
  getPaidMarker: () => paidMarkerMocks.getPaidMarker(),
  clearPaidMarker: () => paidMarkerMocks.clearPaidMarker(),
}))

vi.mock('./utils/activeStoreStorage', () => ({
  clearActiveStoreIdForUser: (...args: unknown[]) => clearActiveStoreIdForUserMock(...args),
}))

vi.mock('./components/ToastProvider', () => ({
  useToast: () => ({ publish: mocks.publish }),
}))

describe('App signup access control', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.currentUser = null
    mocks.listeners.splice(0, mocks.listeners.length)
    signupConfigMock.paymentUrl = 'https://billing.example.com/checkout'
    signupConfigMock.salesEmail = 'billing@example.com'
    signupConfigMock.salesBookingUrl = 'https://calendly.com/sedifex/demo'
    paidMarkerMocks.getPaidMarker.mockReset()
    paidMarkerMocks.getPaidMarker.mockReturnValue(null)
    paidMarkerMocks.clearPaidMarker.mockReset()
    clearActiveStoreIdForUserMock.mockReset()
    const mockUser = {
      uid: 'user-123',
      email: 'owner@example.com',
      displayName: null,
      getIdToken: vi.fn(async () => 'token-123'),
    } as unknown as User
    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = mockUser
      return { user: mockUser }
    })
    mocks.initializeStore.mockResolvedValue({ storeId: 'store-123' })
  })

  it('shows the full sign up form without opening checkout immediately', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    const signUpTab = await screen.findByRole('tab', { name: /sign up/i })
    await user.click(signUpTab)

    expect(signUpTab).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByLabelText(/full name/i)).toBeVisible()
    expect(openSpy).not.toHaveBeenCalled()

    openSpy.mockRestore()
  })

  it('opens the payment checkout after a successful signup', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /sign up/i }))

    await user.type(await screen.findByLabelText(/full name/i), 'Owner Example')
    await user.type(screen.getByLabelText(/business name/i), 'Example Stores')
    await user.type(screen.getByLabelText(/phone/i), '0551234567')
    await user.type(screen.getByLabelText(/country/i), 'Ghana')
    await user.type(screen.getByLabelText(/town/i), 'Accra')
    await user.type(screen.getByLabelText(/^email/i), 'owner@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'StrongPassw0rd!')
    await user.type(screen.getByLabelText(/confirm password/i), 'StrongPassw0rd!')

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mocks.createUserWithEmailAndPassword).toHaveBeenCalled())
    expect(openSpy).toHaveBeenCalledWith(
      'https://billing.example.com/checkout',
      '_blank',
      'noopener,noreferrer',
    )

    const statusMessage = await screen.findByRole('status')
    expect(statusMessage.textContent).toContain('Complete your payment')

    openSpy.mockRestore()
  })

  it('initializes a workspace when optional signup details are omitted', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /sign up/i }))

    await user.type(screen.getByLabelText(/^email/i), 'owner@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'StrongPassw0rd!')
    await user.type(screen.getByLabelText(/confirm password/i), 'StrongPassw0rd!')

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mocks.createUserWithEmailAndPassword).toHaveBeenCalled())

    expect(mocks.initializeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: expect.objectContaining({
          phone: null,
          firstSignupEmail: 'owner@example.com',
          ownerName: null,
          businessName: null,
          country: null,
          town: null,
          signupRole: 'owner',
        }),
      }),
    )

    openSpy.mockRestore()
  })

  it('passes the paid plan marker to initializeStore when available', async () => {
    paidMarkerMocks.getPaidMarker.mockReturnValue({ plan: 'pro', at: Date.now() })

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /sign up/i }))

    await user.type(screen.getByLabelText(/^email/i), 'owner@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'StrongPassw0rd!')
    await user.type(screen.getByLabelText(/confirm password/i), 'StrongPassw0rd!')

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mocks.initializeStore).toHaveBeenCalled())
    expect(mocks.initializeStore).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'pro' }),
    )
  })

  it('allows reinitializing the workspace without recreating the user after a reset', async () => {
    mocks.initializeStore.mockRejectedValueOnce(new Error('init failed'))

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /sign up/i }))

    await user.type(screen.getByLabelText(/^email/i), 'owner@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'StrongPassw0rd!')
    await user.type(screen.getByLabelText(/confirm password/i), 'StrongPassw0rd!')

    const submitButton = screen.getByRole('button', { name: /create account/i })
    await user.click(submitButton)

    await waitFor(() => expect(mocks.initializeStore).toHaveBeenCalledTimes(1))

    expect(paidMarkerMocks.clearPaidMarker).toHaveBeenCalledTimes(1)
    expect(clearActiveStoreIdForUserMock).toHaveBeenCalledWith('user-123')
    expect(mocks.auth.signOut).not.toHaveBeenCalled()

    await user.click(submitButton)

    await waitFor(() => expect(mocks.initializeStore).toHaveBeenCalledTimes(2))
    expect(mocks.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1)
  })

  it('falls back to contacting sales via email when no checkout link is set', async () => {
    signupConfigMock.paymentUrl = null
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /sign up/i }))

    await user.type(await screen.findByLabelText(/full name/i), 'Owner Example')
    await user.type(screen.getByLabelText(/business name/i), 'Example Stores')
    await user.type(screen.getByLabelText(/phone/i), '0551234567')
    await user.type(screen.getByLabelText(/country/i), 'Ghana')
    await user.type(screen.getByLabelText(/town/i), 'Accra')
    await user.type(screen.getByLabelText(/^email/i), 'owner@example.com')
    await user.type(screen.getByLabelText(/^password/i), 'StrongPassw0rd!')
    await user.type(screen.getByLabelText(/confirm password/i), 'StrongPassw0rd!')

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(mocks.createUserWithEmailAndPassword).toHaveBeenCalled())
    expect(openSpy).toHaveBeenCalledWith(
      `mailto:${signupConfigMock.salesEmail}`,
      '_blank',
      'noopener,noreferrer',
    )

    const statusMessage = await screen.findByRole('status')
    expect(statusMessage.textContent).toContain('Please contact billing@example.com')

    openSpy.mockRestore()
  })
})
