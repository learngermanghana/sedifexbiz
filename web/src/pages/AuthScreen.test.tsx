import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'

import AuthScreen from './AuthScreen'

type MockToastOptions = { message: string; tone?: 'success' | 'error' | 'info'; duration?: number }

const mockAuth = vi.hoisted(() => ({} as unknown as Record<string, unknown>))

const mockSignInWithEmailAndPassword = vi.fn()
const mockPersistSession = vi.fn(async (..._args: unknown[]) => {})
const mockEnsureStoreDocument = vi.fn(async (..._args: unknown[]) => {})
const mockPublish = vi.fn<(options: MockToastOptions) => void>()
const mockNavigate = vi.fn()
const signupConfigMock = vi.hoisted(() => ({
  paymentUrl: 'https://billing.example.com/checkout',
  salesEmail: 'billing@example.com',
  salesBookingUrl: 'https://calendly.com/sedifex/demo',
}))

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) =>
    mockSignInWithEmailAndPassword(...args),
}))

vi.mock('../firebase', () => ({
  auth: mockAuth,
}))

vi.mock('../controllers/sessionController', () => ({
  persistSession: (...args: unknown[]) => mockPersistSession(...args),
  ensureStoreDocument: (...args: unknown[]) => mockEnsureStoreDocument(...args),
}))

vi.mock('../config/signup', () => ({ signupConfig: signupConfigMock }))

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ publish: mockPublish }),
}))

vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ pathname: '/', state: null }),
  }
})

describe('AuthScreen', () => {
  beforeEach(() => {
    mockSignInWithEmailAndPassword.mockReset()
    mockPersistSession.mockClear()
    mockEnsureStoreDocument.mockClear()
    mockPublish.mockReset()
    mockNavigate.mockReset()
    signupConfigMock.paymentUrl = 'https://billing.example.com/checkout'
    signupConfigMock.salesEmail = 'billing@example.com'
    signupConfigMock.salesBookingUrl = 'https://calendly.com/sedifex/demo'
  })

  it('signs in with Firebase auth and persists the session', async () => {
    const mockUser = { uid: 'user-123' }
    mockSignInWithEmailAndPassword.mockResolvedValue({ user: mockUser })

    render(<AuthScreen />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/email/i), '  user@example.com  ')
    await user.type(screen.getByLabelText(/password/i), 'password123')

    const submitButton = screen
      .getAllByRole('button', { name: /sign in/i })
      .find(button => button.getAttribute('type') === 'submit')

    if (!submitButton) {
      throw new Error('Could not find submit button')
    }

    await user.click(submitButton)

    await waitFor(() => {
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        mockAuth,
        'user@example.com',
        'password123',
      )
    })

    expect(mockEnsureStoreDocument).toHaveBeenCalledWith(mockUser)
    expect(mockPersistSession).toHaveBeenCalledWith(mockUser)
    expect(mockPublish).toHaveBeenCalledWith({ message: 'Welcome back!', tone: 'success' })
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('directs users to payment before allowing signup', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<AuthScreen />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create one/i }))

    expect(
      screen.getByRole('heading', { name: /complete payment to create your sedifex workspace/i }),
    ).toBeInTheDocument()

    const paymentButton = screen.getByRole('button', { name: /continue to payment/i })
    await user.click(paymentButton)

    expect(openSpy).toHaveBeenCalledWith(
      'https://billing.example.com/checkout',
      '_blank',
      'noopener,noreferrer',
    )
    const infoToastCall = mockPublish.mock.calls.find(([options]) => options.tone === 'info')
    expect(infoToastCall?.[0].message).toContain('Sedifex requires an active subscription')
    expect(mockSignInWithEmailAndPassword).not.toHaveBeenCalled()
    expect(mockEnsureStoreDocument).not.toHaveBeenCalled()

    openSpy.mockRestore()
  })

  it('falls back to emailing sales when no payment URL is configured', async () => {
    signupConfigMock.paymentUrl = null
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<AuthScreen />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /create one/i }))

    const contactButton = screen.getByRole('button', { name: /contact sales/i })
    await user.click(contactButton)

    expect(openSpy).toHaveBeenCalledWith(
      `mailto:${signupConfigMock.salesEmail}`,
      '_blank',
      'noopener,noreferrer',
    )

    openSpy.mockRestore()
  })

  it('guides the user to unblock reCAPTCHA when App Check fails', async () => {
    const appCheckError = new FirebaseError(
      'auth/internal-error',
      'Firebase: Error (auth/internal-error). App Check token fetch failed for reCAPTCHA Enterprise.',
    )

    mockSignInWithEmailAndPassword.mockRejectedValue(appCheckError)

    render(<AuthScreen />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/email/i), 'blocked@example.com')
    await user.type(screen.getByLabelText(/password/i), 'password123')

    const submitButton = screen
      .getAllByRole('button', { name: /sign in/i })
      .find(button => button.getAttribute('type') === 'submit')

    if (!submitButton) {
      throw new Error('Could not find submit button')
    }

    await user.click(submitButton)

    const guidance = await screen.findByRole('alert')
    expect(guidance.textContent).toContain('Double-check that browser extensions or network filters allow')
    expect(guidance.textContent).toContain('https://www.google.com/recaptcha/enterprise')

    const toastCall = mockPublish.mock.calls.find(([options]) => options.tone === 'error')
    expect(toastCall?.[0].message).toContain('We could not verify your device with Firebase App Check.')
    expect(toastCall?.[0].duration).toBe(8000)
  })
})

