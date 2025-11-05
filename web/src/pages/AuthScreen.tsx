// web/src/pages/AuthScreen.tsx
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'

import { auth } from '../firebase'
import { configureAuthPersistence, ensureStoreDocument, persistSession } from '../controllers/sessionController'
import { useToast } from '../components/ToastProvider'
import { signupConfig } from '../config/signup'
import { clearPaidMarker, hasRecentPayment } from '../lib/paid'

import './AuthScreen.css'

type Mode = 'signin'

const INFO_TOAST_MESSAGE =
  'Sedifex requires an active subscription before we can create a workspace. Complete checkout to continue.'

const APP_CHECK_GUIDANCE_MESSAGE =
  [
    'We could not verify your device with Firebase App Check.',
    'Sedifex automatically registers App Check during startup, so you normally will not see a reCAPTCHA challenge.',
    'Double-check that browser extensions or network filters allow https://www.google.com/recaptcha/enterprise to load, then refresh and try again.',
  ].join(' ')

function isAppCheckRelatedError(error: unknown): boolean {
  const message =
    error instanceof FirebaseError
      ? error.message
      : error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : null

  if (!message) {
    return false
  }

  return /app[\s-_]?check/i.test(message) || /recaptcha/i.test(message)
}

function resolveAuthError(error: unknown): { message: string; toastDuration?: number } {
  if (isAppCheckRelatedError(error)) {
    return { message: APP_CHECK_GUIDANCE_MESSAGE, toastDuration: 8000 }
  }

  if (error instanceof FirebaseError && error.message) {
    return { message: error.message }
  }

  if (error instanceof Error && error.message) {
    return { message: error.message }
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return { message: error }
  }

  return { message: 'We could not sign you in with those credentials.' }
}

export default function AuthScreen() {
  const navigate = useNavigate()
  const { publish } = useToast()

  const [mode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPaymentPrompt, setShowPaymentPrompt] = useState(false)
  const [recentPayment] = useState(() => hasRecentPayment())

  const paymentUrl = signupConfig.paymentUrl
  const salesEmail = signupConfig.salesEmail
  const salesBookingUrl = signupConfig.salesBookingUrl

  useEffect(() => {
    void configureAuthPersistence(auth)
  }, [])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (isSubmitting) return

      const trimmedEmail = email.trim()
      const passwordValue = password

      if (!trimmedEmail || !passwordValue) {
        setError('Email and password are required to sign in.')
        return
      }

      setError(null)
      setIsSubmitting(true)

      try {
        const credential = await signInWithEmailAndPassword(auth, trimmedEmail, passwordValue)
        const user = credential.user

        await ensureStoreDocument(user)
        await persistSession(user)

        publish({ message: 'Welcome back!', tone: 'success' })
        clearPaidMarker()
        navigate('/', { replace: true })
      } catch (err) {
        const { message, toastDuration } = resolveAuthError(err)
        setError(message)
        publish({ message, tone: 'error', ...(toastDuration ? { duration: toastDuration } : {}) })
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, password, isSubmitting, navigate, publish],
  )

  const handleCreateAccount = useCallback(() => {
    setShowPaymentPrompt(true)
  }, [])

  const openExternal = useCallback((url: string) => {
    if (typeof window === 'undefined') {
      throw new Error('Cannot open external links outside the browser environment.')
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const handleContactSales = useCallback(() => {
    if (!salesEmail) {
      publish({ message: 'sales@sedifex.com', tone: 'info' })
      return
    }

    openExternal(`mailto:${salesEmail}`)
  }, [openExternal, publish, salesEmail])

  const handleContinueToPayment = useCallback(() => {
    if (!paymentUrl) {
      handleContactSales()
      return
    }

    openExternal(paymentUrl)
    publish({ message: INFO_TOAST_MESSAGE, tone: 'info', duration: 6000 })
  }, [handleContactSales, openExternal, paymentUrl, publish])

  const heading = useMemo(() => {
    switch (mode) {
      case 'signin':
      default:
        return 'Sign in to Sedifex'
    }
  }, [mode])

  return (
    <main className="auth-screen">
      <section className="auth-screen__panel">
        <header className="auth-screen__brand">
          <p className="auth-screen__logo">Sedifex</p>
          <p className="auth-screen__tagline">Retail operations for growing teams</p>
        </header>

        <form onSubmit={handleSubmit} aria-describedby={error ? 'auth-error' : undefined}>
          <h1>{heading}</h1>
          {recentPayment && (
            <p role="status" style={{ marginBottom: '1rem', color: '#1d4ed8' }}>
              We detected a recent payment. Use the email you registered during checkout to finish
              signing in.
            </p>
          )}

          <div className="form-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />
          </div>

          {error && (
            <p id="auth-error" role="alert" style={{ color: '#b91c1c' }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <footer>
          <p>
            Don&apos;t have an account?{' '}
            <button type="button" className="auth-screen__footer-button" onClick={handleCreateAccount}>
              Create one
            </button>
          </p>
        </footer>
      </section>

      {showPaymentPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-gate-heading"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            zIndex: 50,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '1rem',
              maxWidth: 520,
              width: '100%',
              padding: '2rem',
              boxShadow: '0 20px 45px rgba(15, 23, 42, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <h2 id="payment-gate-heading">Complete payment to create your Sedifex workspace</h2>
            <p>
              New workspaces require an active Sedifex subscription. Once checkout is complete,
              we&apos;ll automatically guide you back here to finish creating your admin account.
            </p>
            {paymentUrl ? (
              <button type="button" onClick={handleContinueToPayment}>
                Continue to payment
              </button>
            ) : (
              <button type="button" onClick={handleContactSales}>
                Contact sales
              </button>
            )}

            {salesBookingUrl && (
              <button
                type="button"
                onClick={() => openExternal(salesBookingUrl)}
                style={{ backgroundColor: 'transparent', color: '#1d4ed8' }}
              >
                Book a live demo
              </button>
            )}

            <button type="button" onClick={() => setShowPaymentPrompt(false)}>
              Back to sign in
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
