import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import AuthScreen from './AuthScreen'

type MockToastOptions = { message: string; tone?: 'success' | 'error' | 'info'; duration?: number }

const mockSignUp = vi.fn()
const mockSignInWithPassword = vi.fn()
const mockPublish = vi.fn<(options: MockToastOptions) => void>()
const mockNavigate = vi.fn()
const mockAfterSignupBootstrap = vi.fn()

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
  },
}))

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ publish: mockPublish }),
}))

vi.mock('../controllers/accessController', () => ({
  afterSignupBootstrap: (...args: unknown[]) => mockAfterSignupBootstrap(...args),
}))

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/', state: null }),
  }
})

describe('AuthScreen sign up flow', () => {
  beforeEach(() => {
    mockSignUp.mockReset()
    mockSignInWithPassword.mockReset()
    mockPublish.mockReset()
    mockNavigate.mockReset()
    mockAfterSignupBootstrap.mockReset()
  })

  it('skips bootstrap and error toast when session is missing after sign up', async () => {
    mockSignUp.mockResolvedValue({
      data: {
        user: { id: 'user-1' },
        session: null,
      },
      error: null,
    })

    render(<AuthScreen />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create one/i }))
    await user.type(screen.getByLabelText(/email/i), 'new.user@example.com')
    await user.type(screen.getByLabelText(/password/i), 'password123')

    const submitButton = screen
      .getAllByRole('button', { name: /create account/i })
      .find(button => button.getAttribute('type') === 'submit')

    if (!submitButton) {
      throw new Error('Could not find submit button')
    }

    await user.click(submitButton)

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledTimes(1)
    })

    expect(mockAfterSignupBootstrap).not.toHaveBeenCalled()
    const errorToastCall = mockPublish.mock.calls.find(
      ([options]) => options.tone === 'error' && options.message.includes('snag syncing workspace data'),
    )
    expect(errorToastCall).toBeUndefined()

    const successToastCall = mockPublish.mock.calls.find(([options]) => options.tone === 'success')
    expect(successToastCall?.[0].message).toContain(
      'Check your inbox to confirm your email and finish setting up your account.',
    )
  })
})
