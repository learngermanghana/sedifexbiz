// web/src/pages/AuthScreen.tsx
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword } from 'firebase/auth'
import {
  AuthForm,
  authFormInputClass,
  authFormInputGroupClass,
  authFormLabelClass,
  authFormNoteClass,
} from '../components/auth/AuthForm'
import { useToast } from '../components/ToastProvider'
import { ensureStoreDocument, persistSession } from '../controllers/sessionController'
import { signupConfig } from '../config/signup'
import { auth } from '../firebase'
import { startCheckout } from '../lib/billing' // ← correct relative path from /src/pages
import './AuthScreen.css'

type AuthMode = 'sign-in' | 'sign-up'
const MIN_PASSWORD_LENGTH = 8

/** Flag set by /billing/thanks after successful verify */
function hasPaidFlag() {
  return Boolean(localStorage.getItem('sfx.billing.paidRef'))
}

function normalizeError(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.'
  if (typeof error === 'string') return error.trim() || 'Something went wrong. Please try again.'
  if (error instanceof Error) return error.message.trim() || 'Something went wrong. Please try again.'
  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return 'Something went wrong. Please try again.'
}

function validateCredentials(email: string, password: string): string | null {
  const trimmedEmail = email.trim()
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return 'Enter a valid email address to continue.'
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { publish } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { salesEmail } = signupConfig

  const redirectTo = useMemo(() => {
    const state = location.state as { from?: string } | null
    if (state?.from && typeof state.from === 'string') return state.from
    if (location.pathname && location.pathname !== '/') return location.pathname
    return '/'
  }, [location.pathname, location.state])

  const triggerCheckout = useCallback(async () => {
    publish({ message: 'Redirecting to checkout…', tone: 'info' })
    await startCheckout('starter') // or 'pro' / 'enterprise' based on your UI
  }, [publish])

  const toggleMode = useCallback(
    (nextMode: AuthMode) => {
      setMode(current => {
        if (current === nextMode) return current
        setError(null)
        setPassword('')
        return nextMode
      })

      // Only open Paystack if user hasn't paid yet
      if (nextMode === 'sign-up') {
        if (hasPaidFlag()) {
          publish({
            message: 'Payment confirmed. You can create your account now.',
            tone: 'success',
          })
          return
        }
        triggerCheckout().catch(err =>
          publish({ message: normalizeError(err), tone: 'error' }),
        )
      }
    },
    [publish, triggerCheckout],
  )

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (loading) return

      if (mode === 'sign-up') {
        if (!hasPaidFlag()) {
          await triggerCheckout()
          return
        }
        // Paid already → proceed to app or dedicated signup form
        publish({ message: 'Great — let’s create your account.', tone: 'success' })
        navigate('/', { replace: true })
        return
      }

      const validationError = validateCredentials(email, password)
      if (validationError) {
        setError(validationError)
        publish({ message: validationError, tone: 'error' })
        return
      }

      setLoading(true)
      setError(null)

      try {
        const { user } = await signInWithEmailAndPassword(auth, email.trim(), password)
        await ensureStoreDocument(user)
        await persistSession(user)

        publish({ message: 'Welcome back!', tone: 'success' })
        navigate(redirectTo, { replace: true })
      } catch (unknownError) {
        const message = normalizeError(unknownError)
        setError(message)
        publish({ message, tone: 'error' })
      } finally {
        setLoading(false)
      }
    },
    [email, loading, mode, navigate, password, publish, redirectTo, triggerCheckout],
  )

  const handleSignupRedirect = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (hasPaidFlag()) {
        publish({ message: 'Payment confirmed. You can create your account now.', tone: 'success' })
        navigate('/', { replace: true })
        return
      }
      await triggerCheckout()
    },
    [navigate, publish, triggerCheckout],
  )

  const signInFormTitle = 'Welcome back'
  const signInFormDescription =
    'Sign in to manage your stores, track inventory, and keep sales in sync.'

  const footerActionLabel =
    mode === 'sign-in' ? "Don't have an account?" : 'Already have an account?'
  const footerActionButtonLabel = mode === 'sign-in' ? 'Create one' : 'Sign in'
  const footerActionMode: AuthMode = mode === 'sign-in' ? 'sign-up' : 'sign-in'

  const paid = hasPaidFlag()

  return (
    <main className="auth-screen">
      <div className="auth-screen__panel">
        <div className="auth-screen__brand">
          <div className="auth-screen__logo">Sedifex</div>
          <p className="auth-screen__tagline">Sell faster. Count smarter.</p>
        </div>

        <div className="auth-screen__mode-toggle">
          <button
            type="button"
            onClick={() => toggleMode('sign-in')}
            className={`auth-screen__mode-button${mode === 'sign-in' ? ' is-active' : ''}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => toggleMode('sign-up')}
            className={`auth-screen__mode-button${mode === 'sign-up' ? ' is-active' : ''}`}
          >
            Create account
          </button>
        </div>

        {mode === 'sign-in' ? (
          <AuthForm
            title={signInFormTitle}
            description={signInFormDescription}
            onSubmit={handleSubmit}
            submitLabel="Sign in"
            loading={loading}
            error={error}
            footer={
              <div>
                {footerActionLabel}{' '}
                <button
                  type="button"
                  onClick={() => toggleMode(footerActionMode)}
                  className="auth-screen__footer-button"
                  disabled={loading}
                >
                  {footerActionButtonLabel}
                </button>
              </div>
            }
          >
            <label className={authFormInputGroupClass}>
              <span className={authFormLabelClass}>Email</span>
              <input
                className={authFormInputClass}
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
                disabled={loading}
                required
              />
            </label>

            <label className={authFormInputGroupClass}>
              <span className={authFormLabelClass}>Password</span>
              <input
                className={authFormInputClass}
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter at least 8 characters"
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={loading}
                required
              />
              <p className={authFormNoteClass}>
                Use at least {MIN_PASSWORD_LENGTH} characters for a strong password.
              </p>
            </label>
          </AuthForm>
        ) : (
          <AuthForm
            title={
              paid
                ? 'Payment confirmed — create your account'
                : 'Complete payment to create your workspace'
            }
            description={
              paid
                ? 'You’re all set. Continue to create your Sedifex account.'
                : 'Sedifex requires an active subscription before we can issue new logins.'
            }
            onSubmit={handleSignupRedirect}
            submitLabel={paid ? 'Continue' : 'Continue to payment'}
            loading={false}
            footer={
              <div>
                {footerActionLabel}{' '}
                <button
                  type="button"
                  onClick={() => toggleMode(footerActionMode)}
                  className="auth-screen__footer-button"
                  disabled={loading}
                >
                  {footerActionButtonLabel}
                </button>
              </div>
            }
          >
            {!paid && (
              <p className={authFormNoteClass}>
                We&apos;ll send activation details as soon as payment is confirmed.
                Need help? <a href={`mailto:${salesEmail}`}>Email our team</a>.
              </p>
            )}
          </AuthForm>
        )}
      </div>
    </main>
  )
}
