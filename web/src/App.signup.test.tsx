import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'

const signupConfigMock = vi.hoisted(() => ({
  paymentUrl: 'https://billing.example.com/checkout',
  salesEmail: 'billing@example.com',
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

vi.mock('./config/signup', () => ({ signupConfig: signupConfigMock }))

vi.mock('./firebase', () => ({
  auth: mocks.auth,
  db: {},
  rosterDb: {},
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
  })

  it('opens the payment link when the sign up tab is selected', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    const signUpTab = await screen.findByRole('tab', { name: /sign up/i })
    await user.click(signUpTab)

    expect(openSpy).toHaveBeenCalledWith(
      'https://billing.example.com/checkout',
      '_blank',
      'noopener,noreferrer',
    )

    const infoToastCall = mocks.publish.mock.calls.find(([options]) => options.tone === 'info')
    expect(infoToastCall?.[0].message).toContain('Sedifex requires an active subscription')
    expect(screen.getByRole('tab', { name: /log in/i })).toHaveAttribute('aria-selected', 'true')

    openSpy.mockRestore()
  })

  it('falls back to emailing sales when no payment URL is configured', async () => {
    signupConfigMock.paymentUrl = null
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    const signUpTab = await screen.findByRole('tab', { name: /sign up/i })
    await user.click(signUpTab)

    expect(openSpy).toHaveBeenCalledWith(
      `mailto:${signupConfigMock.salesEmail}`,
      '_blank',
      'noopener,noreferrer',
    )

    openSpy.mockRestore()
  })
})
