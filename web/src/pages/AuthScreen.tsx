import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import {
  AuthForm,
  authFormInputClass,
  authFormInputGroupClass,
  authFormLabelClass,
  authFormNoteClass,
} from '../components/auth/AuthForm'
import { useToast } from '../components/ToastProvider'
import { afterSignupBootstrap } from '../controllers/accessController'
import { persistSession } from '../controllers/sessionController'
import { auth } from '../firebase'
import { setOnboardingStatus } from '../utils/onboarding'
import './AuthScreen.css'

type AuthMode = 'sign-in' | 'sign-up'

const MIN_PASSWORD_LENGTH = 8

function normalizeError(error: unknown): string {
  if (!error) {
    return 'Something went wrong. Please try again.'
  }

  if (typeof error === 'string') {
    const trimmed = error.trim()
    return trimmed || 'Something went wrong. Please try again.'
  }

  if (error instanceof Error) {
    const trimmed = error.message.trim()
    return trimmed || 'Something went wrong. Please try again.'
  }

  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
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

  const redirectTo = useMemo(() => {
    const state = location.state as { from?: string } | null
    if (state?.from && typeof state.from === 'string') {
      return state.from
    }
    if (location.pathname && location.pathname !== '/') {
      return location.pathname
    }
    return '/'
  }, [location.pathname, location.state])

  const toggleMode = useCallback((nextMode: AuthMode) => {
    setMode(current => {
      if (current === nextMode) {
        return current
      }
      setError(null)
      setPassword('')
      return nextMode
    })
  }, [])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (loading) return

      const validationError = validateCredentials(email, password)
      if (validationError) {
        setError(validationError)
        publish({ message: validationError, tone: 'error' })
        return
      }

      setLoading(true)
      setError(null)

      const trimmedEmail = email.trim()

      try {
        if (mode === 'sign-in') {
          const { user } = await signInWithEmailAndPassword(auth, trimmedEmail, password)
          await persistSession(user)

          publish({ message: 'Welcome back!', tone: 'success' })
          navigate(redirectTo, { replace: true })
          return
        }

        const { user } = await createUserWithEmailAndPassword(auth, trimmedEmail, password)
        await persistSession(user)
        setOnboardingStatus(user.uid, 'pending')

        try {
          await afterSignupBootstrap()
        } catch (bootstrapError) {
          const message = normalizeError(bootstrapError)
          publish({
            message: `We created your account but hit a snag syncing workspace data. ${message}`,
            tone: 'error',
            duration: 8000,
          })
        }

        publish({ message: 'Account created! Setting things up now…', tone: 'success' })

        navigate(redirectTo, { replace: true })
      } catch (unknownError) {
        const message = normalizeError(unknownError)
        setError(message)
        publish({ message, tone: 'error' })
      } finally {
        setLoading(false)
      }
    },
    [email, loading, mode, navigate, password, publish, redirectTo],
  )

  const formTitle = mode === 'sign-in' ? 'Welcome back' : 'Create your Sedifex account'
  const formDescription =
    mode === 'sign-in'
      ? 'Sign in to manage your stores, track inventory, and keep sales in sync.'
      : 'Start your free Sedifex workspace so your team can sell faster and count smarter.'

  const footerActionLabel =
    mode === 'sign-in' ? "Don't have an account?" : 'Already have an account?'
  const footerActionButtonLabel = mode === 'sign-in' ? 'Create one' : 'Sign in'
  const footerActionMode: AuthMode = mode === 'sign-in' ? 'sign-up' : 'sign-in'

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

        <AuthForm
          title={formTitle}
          description={formDescription}
          onSubmit={handleSubmit}
          submitLabel={mode === 'sign-in' ? 'Sign in' : 'Create account'}
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
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              placeholder="Enter at least 8 characters"
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={loading}
              required
            />
            <p className={authFormNoteClass}>Use at least {MIN_PASSWORD_LENGTH} characters for a strong password.</p>
          </label>
        </AuthForm>
      </div>
    </main>
  )
}
