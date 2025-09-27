import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { User } from 'firebase/auth'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
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
    createMyFirstStore: vi.fn(),
    configureAuthPersistence: vi.fn(async () => {}),
    persistSession: vi.fn(async () => {}),
    refreshSessionHeartbeat: vi.fn(async () => {}),
    publish: vi.fn(),
  }
  return state
})

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

vi.mock('./controllers/storeController', () => ({
  createMyFirstStore: (...args: unknown[]) => mocks.createMyFirstStore(...args),
}))

vi.mock('./controllers/sessionController', () => ({
  configureAuthPersistence: (...args: unknown[]) => mocks.configureAuthPersistence(...args),
  persistSession: (...args: unknown[]) => mocks.persistSession(...args),
  refreshSessionHeartbeat: (...args: unknown[]) => mocks.refreshSessionHeartbeat(...args),
}))

vi.mock('./components/ToastProvider', () => ({
  useToast: () => ({ publish: mocks.publish }),
}))

vi.mock('./hooks/useEnsureOnboarded', () => ({
  useEnsureOnboarded: () => {},
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
  })

  it('removes a newly created user when the store code is already in use', async () => {
    const user = userEvent.setup()
    const { user: createdUser, deleteFn } = createTestUser()

    mocks.createUserWithEmailAndPassword.mockImplementation(async () => {
      mocks.auth.currentUser = createdUser
      mocks.listeners.forEach(listener => listener(createdUser))
      return { user: createdUser }
    })

    mocks.createMyFirstStore.mockRejectedValueOnce(new Error('Store code already in use'))

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.configureAuthPersistence).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByText(/Checking your session/i)).not.toBeInTheDocument(),
    )

    await user.click(screen.getByRole('tab', { name: /Sign up/i }))
    await user.type(screen.getByLabelText(/Email/i), 'owner@example.com')
    await user.type(screen.getByLabelText(/Phone/i), '5551234567')
    await user.type(screen.getByLabelText(/Store code/i), 'ORBITX')
    await user.type(screen.getByLabelText(/^Password$/i), 'Password1!')
    await user.type(screen.getByLabelText(/Confirm password/i), 'Password1!')

    await user.click(screen.getByRole('button', { name: /Create account/i }))

    await waitFor(() => expect(mocks.createMyFirstStore).toHaveBeenCalled())
    await waitFor(() => expect(deleteFn).toHaveBeenCalled())
    await waitFor(() => expect(mocks.auth.signOut).toHaveBeenCalled())

    expect(mocks.auth.currentUser).toBeNull()

    await waitFor(() =>
      expect(screen.getByText('Store code already in use')).toBeVisible(),
    )

    const signUpTab = screen.getByRole('tab', { name: /Sign up/i })
    expect(signUpTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/Store code/i)).toBeInTheDocument()
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', message: 'Store code already in use' }),
    )
  })
})
