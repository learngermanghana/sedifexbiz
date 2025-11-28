// web/src/pages/ResetPassword.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { auth } from '../firebase'
import { useToast } from '../components/ToastProvider'

type ViewMode = 'request' | 'confirm'
type StatusTone = 'idle' | 'loading' | 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

const PASSWORD_MIN_LENGTH = 8

function useQuery() {
  const location = useLocation()
  return useMemo(() => new URLSearchParams(location.search), [location.search])
}

function getFirebaseErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/user-not-found':
        return 'No account was found for this email.'
      case 'auth/invalid-action-code':
        return 'This reset link is invalid or has already been used.'
      case 'auth/expired-action-code':
        return 'This reset link has expired. Please request a new one.'
      case 'auth/weak-password':
        return 'Use a stronger password (at least 8 characters).'
      default:
        return error.message || 'Something went wrong. Please try again.'
    }
  }
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong. Please try again.'
}

export default function ResetPassword() {
  const query = useQuery()
  const { publish } = useToast()

  const oobCode = query.get('oobCode')
  const queryMode = query.get('mode')

  const viewMode: ViewMode =
    oobCode && queryMode === 'resetPassword' ? 'confirm' : 'request'

  // Request view state
  const [email, setEmail] = useState('')

  // Confirm view state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCodeChecking, setIsCodeChecking] = useState(false)
  const [isCodeValid, setIsCodeValid] = useState<boolean | null>(null)

  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' })

  const isBusy = status.tone === 'loading' || isCodeChecking

  // Show toast for success / error messages
  useEffect(() => {
    if (!status.message) return
    if (status.tone === 'success' || status.tone === 'error') {
      publish({ tone: status.tone, message: status.message })
    }
  }, [publish, status.tone, status.message])

  // When we have an oobCode, verify it with Firebase so we know it is valid
  useEffect(() => {
    if (viewMode !== 'confirm' || !oobCode) return

    setIsCodeChecking(true)
    setIsCodeValid(null)
    setStatus({ tone: 'idle', message: '' })

    verifyPasswordResetCode(auth, oobCode)
      .then(() => {
        setIsCodeValid(true)
      })
      .catch(error => {
        console.error('[reset-password] Invalid or expired code', error)
        setIsCodeValid(false)
        setStatus({
          tone: 'error',
          message: getFirebaseErrorMessage(error),
        })
      })
      .finally(() => setIsCodeChecking(false))
  }, [oobCode, viewMode])

  async function handleRequestSubmit(e: React.FormEvent) {
    e.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setStatus({ tone: 'error', message: 'Enter the email you use to sign in.' })
      return
    }

    setStatus({ tone: 'loading', message: 'Sending reset link…' })

    try {
      const redirectUrl = `${window.location.origin}/#/reset-password`

      await sendPasswordResetEmail(auth, normalizedEmail, {
        url: redirectUrl,
        handleCodeInApp: true,
      })

      setStatus({
        tone: 'success',
        message:
          'If an account exists for that email, a reset link has been sent. Check your inbox and follow the link.',
      })
    } catch (error) {
      console.error('[reset-password] Failed to send reset email', error)
      setStatus({
        tone: 'error',
        message: getFirebaseErrorMessage(error),
      })
    }
  }

  async function handleConfirmSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!oobCode) return

    const trimmedPassword = newPassword.trim()
    const trimmedConfirm = confirmPassword.trim()

    if (trimmedPassword.length < PASSWORD_MIN_LENGTH) {
      setStatus({
        tone: 'error',
        message: `Use a stronger password with at least ${PASSWORD_MIN_LENGTH} characters.`,
      })
      return
    }

    if (trimmedPassword !== trimmedConfirm) {
      setStatus({
        tone: 'error',
        message: 'Passwords do not match. Please re-enter them.',
      })
      return
    }

    setStatus({ tone: 'loading', message: 'Updating your password…' })

    try {
      await confirmPasswordReset(auth, oobCode, trimmedPassword)

      setStatus({
        tone: 'success',
        message: 'Your password has been updated. You can now log in with the new password.',
      })

      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      console.error('[reset-password] Failed to confirm reset', error)
      setStatus({
        tone: 'error',
        message: getFirebaseErrorMessage(error),
      })
    }
  }

  const appStyle: React.CSSProperties = { minHeight: '100dvh' }

  return (
    <main className="app" style={appStyle}>
      <div className="app__layout">
        <div className="app__card">
          <div className="app__brand">
            <span className="app__logo">Sx</span>
            <div>
              <h1 className="app__title">Sedifex</h1>
              <p className="app__tagline">
                Reset your password and get back to selling.
              </p>
            </div>
          </div>

          {viewMode === 'request' && (
            <>
              <h2 style={{ fontSize: 20, marginBottom: 8 }}>Forgot password</h2>
              <p style={{ fontSize: 14, color: '#64748B', marginBottom: 16 }}>
                Enter the email linked to your Sedifex account. We’ll send a secure link
                to set a new password.
              </p>

              <form className="form" onSubmit={handleRequestSubmit} aria-label="Request password reset">
                <div className="form__field">
                  <label htmlFor="reset-email">Work email</label>
                  <input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onBlur={() => setEmail(current => current.trim())}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                    disabled={isBusy}
                  />
                  <p className="form__hint">
                    We’ll only send a reset link if this email is associated with an account.
                  </p>
                </div>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={isBusy || !email.trim()}
                >
                  {isBusy ? 'Sending link…' : 'Send reset link'}
                </button>
              </form>

              {status.tone !== 'idle' && status.message && (
                <p
                  className={`status status--${status.tone}`}
                  role={status.tone === 'error' ? 'alert' : 'status'}
                  aria-live={status.tone === 'error' ? 'assertive' : 'polite'}
                >
                  {status.message}
                </p>
              )}

              <p style={{ fontSize: 13, marginTop: 16 }}>
                Remembered it?{' '}
                <Link to="/" className="app__link">
                  Back to log in
                </Link>
              </p>
            </>
          )}

          {viewMode === 'confirm' && (
            <>
              <h2 style={{ fontSize: 20, marginBottom: 8 }}>Set a new password</h2>
              <p style={{ fontSize: 14, color: '#64748B', marginBottom: 16 }}>
                Choose a strong password you haven’t used on this account before.
              </p>

              {isCodeChecking ? (
                <p style={{ fontSize: 13, color: '#475569' }}>Checking reset link…</p>
              ) : isCodeValid === false ? (
                <>
                  {status.tone !== 'idle' && status.message && (
                    <p
                      className={`status status--${status.tone}`}
                      role="alert"
                      aria-live="assertive"
                    >
                      {status.message}
                    </p>
                  )}
                  <p style={{ fontSize: 13, marginTop: 8 }}>
                    You can request a fresh link on the{' '}
                    <Link to="/reset-password" className="app__link">
                      reset page
                    </Link>
                    .
                  </p>
                </>
              ) : (
                <>
                  <form
                    className="form"
                    onSubmit={handleConfirmSubmit}
                    aria-label="Confirm password reset"
                  >
                    <div className="form__field">
                      <label htmlFor="new-password">New password</label>
                      <input
                        id="new-password"
                        type="password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        onBlur={() => setNewPassword(current => current.trim())}
                        placeholder="Use at least 8 characters"
                        autoComplete="new-password"
                        required
                        disabled={isBusy}
                      />
                      <p className="form__hint">
                        Minimum {PASSWORD_MIN_LENGTH} characters. Avoid using your old password.
                      </p>
                    </div>

                    <div className="form__field">
                      <label htmlFor="confirm-new-password">Confirm password</label>
                      <input
                        id="confirm-new-password"
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        onBlur={() => setConfirmPassword(current => current.trim())}
                        placeholder="Re-enter the new password"
                        autoComplete="new-password"
                        required
                        disabled={isBusy}
                      />
                    </div>

                    <button
                      className="primary-button"
                      type="submit"
                      disabled={
                        isBusy ||
                        !newPassword.trim() ||
                        !confirmPassword.trim()
                      }
                    >
                      {isBusy ? 'Updating…' : 'Save new password'}
                    </button>
                  </form>

                  {status.tone !== 'idle' && status.message && (
                    <p
                      className={`status status--${status.tone}`}
                      role={status.tone === 'error' ? 'alert' : 'status'}
                      aria-live={status.tone === 'error' ? 'assertive' : 'polite'}
                    >
                      {status.message}
                    </p>
                  )}

                  <p style={{ fontSize: 13, marginTop: 16 }}>
                    When you’re done, you can{' '}
                    <Link to="/" className="app__link">
                      log back in
                    </Link>
                    .
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <aside className="app__visual" aria-hidden="true">
          <img
            src="https://i.imgur.com/fx9vne9.jpeg"
            alt="Retail team working with inventory"
            loading="lazy"
          />
          <div className="app__visual-overlay" />
          <div className="app__visual-caption">
            <span className="app__visual-pill">Password help</span>
            <h2>Keep your workspace secure</h2>
            <p>
              Strong passwords help protect your sales, customers, and inventory data
              across every Sedifex device.
            </p>
          </div>
        </aside>
      </div>
    </main>
  )
}
