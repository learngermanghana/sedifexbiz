// web/src/pages/ResetPassword.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  confirmPasswordReset,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
} from 'firebase/auth'
import { auth } from '../firebase'
import { useToast } from '../components/ToastProvider'

type ViewMode = 'request' | 'confirm'
type StatusTone = 'idle' | 'loading' | 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

function mergeQueryFromLocation(location: ReturnType<typeof useLocation>): URLSearchParams {
  // Standard query (?mode=...&oobCode=...) before the hash
  const searchParams = new URLSearchParams(location.search || '')

  // Sometimes Firebase may append things after the hash as well
  const hash = location.hash || ''
  const qIndex = hash.indexOf('?')
  if (qIndex >= 0) {
    const hashQuery = hash.slice(qIndex + 1)
    const extra = new URLSearchParams(hashQuery)
    extra.forEach((value, key) => {
      if (!searchParams.has(key)) {
        searchParams.set(key, value)
      }
    })
  }

  return searchParams
}

export default function ResetPassword() {
  const location = useLocation()
  const navigate = useNavigate()
  const { publish } = useToast()

  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' })
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('request')

  const params = useMemo(() => mergeQueryFromLocation(location), [location])
  const mode = params.get('mode')
  const oobCode = params.get('oobCode')

  // Decide whether we're in "request" or "confirm" mode based on URL
  useEffect(() => {
    if (mode === 'resetPassword' && oobCode) {
      setViewMode('confirm')
    } else {
      setViewMode('request')
    }
  }, [mode, oobCode])

  useEffect(() => {
    if (status.message && (status.tone === 'error' || status.tone === 'success')) {
      publish({ tone: status.tone, message: status.message })
    }
  }, [status, publish])

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setStatus({ tone: 'error', message: 'Enter the email you signed up with.' })
      return
    }

    setStatus({ tone: 'loading', message: 'Sending reset link…' })

    try {
      await sendPasswordResetEmail(auth, trimmedEmail, {
        url: `${window.location.origin}/reset-password`,
        handleCodeInApp: true,
      })
      setStatus({
        tone: 'success',
        message: 'Check your inbox for a password reset link. It may take a minute to arrive.',
      })
    } catch (error) {
      console.error('[reset-password] Failed to send email', error)
      setStatus({
        tone: 'error',
        message: 'We could not send a reset email. Check the address and try again.',
      })
    }
  }

  async function handleConfirmReset(e: React.FormEvent) {
    e.preventDefault()
    if (!oobCode) {
      setStatus({ tone: 'error', message: 'Reset link is missing. Try requesting a new email.' })
      return
    }
    if (!newPassword || newPassword.length < 8) {
      setStatus({
        tone: 'error',
        message: 'Use a password of at least 8 characters.',
      })
      return
    }
    if (newPassword !== confirmPassword) {
      setStatus({ tone: 'error', message: 'Passwords do not match.' })
      return
    }

    setStatus({ tone: 'loading', message: 'Updating your password…' })
    try {
      // Optional: verify first so we can show a nicer error if expired
      await verifyPasswordResetCode(auth, oobCode)
      await confirmPasswordReset(auth, oobCode, newPassword)

      setStatus({
        tone: 'success',
        message: 'Password updated. You can now sign in with your new password.',
      })

      // Clear the query params so refresh goes back to the request view
      setTimeout(() => {
        navigate('/', { replace: true })
      }, 1500)
    } catch (error) {
      console.error('[reset-password] Failed to confirm reset', error)
      setStatus({
        tone: 'error',
        message:
          'We could not update your password. The link may be expired or already used. Request a new email and try again.',
      })
    }
  }

  const isLoading = status.tone === 'loading'

  return (
    <main className="page" style={{ maxWidth: 480, margin: '32px auto' }}>
      <section className="card">
        <h2 className="page__title">
          {viewMode === 'request' ? 'Reset your password' : 'Choose a new password'}
        </h2>
        <p className="page__subtitle">
          {viewMode === 'request'
            ? 'Enter your Sedifex login email. We’ll email you a secure link to reset your password.'
            : 'Enter a new password for your Sedifex account. After this, you’ll use it to log in.'}
        </p>

        {viewMode === 'request' ? (
          <form className="form" onSubmit={handleRequestReset}>
            <div className="form__field">
              <label htmlFor="reset-email">Email</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="button button--primary" disabled={isLoading}>
              {isLoading ? 'Sending link…' : 'Send reset link'}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={handleConfirmReset}>
            <div className="form__field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <div className="form__field">
              <label htmlFor="confirm-new-password">Confirm password</label>
              <input
                id="confirm-new-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>
            <button type="submit" className="button button--primary" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}

        {status.tone !== 'idle' && status.message && (
          <p
            className={`status status--${status.tone}`}
            role={status.tone === 'error' ? 'alert' : 'status'}
            style={{ marginTop: 16 }}
          >
            {status.message}
          </p>
        )}

        <p className="form__hint" style={{ marginTop: 16 }}>
          Remembered your password?{' '}
          <a href="/" style={{ color: '#4338CA', fontWeight: 600 }}>
            Go back to log in
          </a>
          .
        </p>
      </section>
    </main>
  )
}
