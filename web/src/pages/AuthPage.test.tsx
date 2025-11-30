import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AuthPage from './AuthPage'

const mockAuth = { signOut: vi.fn(async () => {}) }
const mockSignInWithEmailAndPassword = vi.fn()
const mockCreateUserWithEmailAndPassword = vi.fn()
const mockPersistSession = vi.fn(async () => {})
const mockResolveStoreAccess = vi.fn(async () => ({
  storeId: 'store-1',
  workspaceSlug: 'workspace-1',
  role: 'owner',
}))
const mockInitializeStore = vi.fn()
const mockPublish = vi.fn()
const mockServerTimestamp = vi.fn(() => ({ __type: 'timestamp' }))
const mockSetDoc = vi.fn(async () => {})
const mockSetOnboardingStatus = vi.fn()
const mockPayWithPaystack = vi.fn(async () => ({ ok: true, reference: 'ref-123' }))

vi.mock('../firebase', () => ({
  auth: mockAuth,
  db: {},
}))

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUserWithEmailAndPassword(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignInWithEmailAndPassword(...args),
}))

vi.mock('firebase/firestore', () => ({
  doc: (...segments: string[]) => ({ path: segments.join('/') }),
  serverTimestamp: (...args: unknown[]) => mockServerTimestamp(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

vi.mock('../controllers/sessionController', () => ({
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
}))

vi.mock('../controllers/accessController', () => ({
  initializeStore: (...args: unknown[]) => mockInitializeStore(...args),
  resolveStoreAccess: (...args: unknown[]) => mockResolveStoreAccess(...args),
  extractCallableErrorMessage: () => null,
  INACTIVE_WORKSPACE_MESSAGE: 'workspace inactive',
}))

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ publish: mockPublish }),
}))

vi.mock('../utils/onboarding', () => ({
  setOnboardingStatus: (...args: unknown[]) => mockSetOnboardingStatus(...args),
}))

vi.mock('../utils/paystack', () => ({
  payWithPaystack: (...args: unknown[]) => mockPayWithPaystack(...args),
}))

describe('AuthPage', () => {
  beforeEach(() => {
    mockSignInWithEmailAndPassword.mockReset()
    mockCreateUserWithEmailAndPassword.mockReset()
    mockPersistSession.mockClear()
    mockResolveStoreAccess.mockClear()
    mockInitializeStore.mockClear()
    mockPublish.mockClear()
    mockSetDoc.mockClear()
    mockServerTimestamp.mockClear()
    mockSetOnboardingStatus.mockClear()
    mockPayWithPaystack.mockClear()
  })

  it('shows a loading state while signing in and surfaces success toasts', async () => {
    const user = userEvent.setup()
    let resolveSignIn: (value: unknown) => void
    const signInPromise = new Promise(resolve => {
      resolveSignIn = resolve
    })
    mockSignInWithEmailAndPassword.mockReturnValueOnce(signInPromise)

    render(
      <MemoryRouter>
        <AuthPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText(/Email/i), ' shopper@example.com ')
    await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')

    await user.click(screen.getByRole('button', { name: /Log in/i }))

    expect(screen.getByRole('button', { name: /Signing in…/i })).toBeDisabled()

    resolveSignIn?.({ user: { uid: 'user-1' } })

    await waitFor(() => expect(mockPersistSession).toHaveBeenCalledTimes(2))

    const successToast = mockPublish.mock.calls.find(([options]) => options.tone === 'success')?.[0]
    expect(successToast?.message).toBe('Welcome back! Redirecting…')
  })
})
