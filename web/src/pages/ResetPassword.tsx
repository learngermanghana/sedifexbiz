// web/src/pages/ResetPassword.tsx
import React, { useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../firebase'

export default function ResetPassword() {
  const [email, setEmail] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isValid = email.trim() !== ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || isSending) return

    setIsSending(true)
    setError(null)
    setSuccess(null)

    try {
      // Optional: you can pass an actionCodeSettings object here
      await sendPasswordResetEmail(auth, email.trim())

      setSuccess(
        'If an account exists for this email, a reset link has been sent. Check your inbox (and spam).',
      )
      setEmail('')
    } catch (err: any) {
      console.error('[reset-password] failed', err)
      // Keep the message generic for security
      setError('We could not send a reset link. Please check the email and try again.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="page auth-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Reset your password</h2>
          <p className="page__subtitle">
            Enter the email you used for Sedifex. We’ll send a link to create a new password.
          </p>
        </div>
      </header>

      <section className="card" aria-label="Reset password form">
        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="status status--success" role="status">
            {success}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="form"
          style={{ maxWidth: 420, display: 'grid', gap: 12 }}
        >
          <div className="form__field">
            <label htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <p className="form__hint">
              We’ll never show this email to anyone. You’ll receive a single-use reset link.
            </p>
          </div>

          <button
            type="submit"
            className="button button--primary"
            disabled={!isValid || isSending}
          >
            {isSending ? 'Sending reset link…' : 'Send reset link'}
          </button>
        </form>
      </section>
    </div>
  )
}
