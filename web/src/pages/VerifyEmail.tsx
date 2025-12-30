// web/src/pages/VerifyEmail.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { applyActionCode } from 'firebase/auth'
import { auth } from '../firebase'
import { useToast } from '../components/ToastProvider'

type StatusTone = 'idle' | 'loading' | 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

// Helper: merge query params from search and hash (works nicely with hash router)
function getParamsFromLocation(location: ReturnType<typeof useLocation>): URLSearchParams {
  const params = new URLSearchParams(location.search || '')
  const hash = location.hash || ''
  const qIndex = hash.indexOf('?')
  if (qIndex >= 0) {
    const extra = new URLSearchParams(hash.slice(qIndex + 1))
    extra.forEach((value, key) => {
      if (!params.has(key)) params.set(key, value)
    })
  }
  return params
}

export default function VerifyEmail() {
  const location = useLocation()
  const navigate = useNavigate()
  const { publish } = useToast()

  const [status, setStatus] = useState<StatusState>({
    tone: 'idle',
    message: 'Checking your verification link…',
  })

  const params = useMemo(() => getParamsFromLocation(location), [location])
  const mode = params.get('mode')
  const oobCode = params.get('oobCode')

  useEffect(() => {
    async function verify() {
      if (mode !== 'verifyEmail' || !oobCode) {
        setStatus({
          tone: 'error',
          message: 'This verification link is missing information. Please request a new one.',
        })
        return
      }

      setStatus({ tone: 'loading', message: 'Verifying your email…' })

      try {
        await applyActionCode(auth, oobCode)
        // reload current user if logged in, so emailVerified flag updates
        if (auth.currentUser) {
          await auth.currentUser.reload()
        }
        setStatus({
          tone: 'success',
          message: 'Your email has been verified. You can now sign in to Sedifex.',
        })
      } catch (error) {
        console.error('[verify-email] Failed to verify email', error)
        setStatus({
          tone: 'error',
          message:
            'We could not verify this link. It might be expired or already used. Request a new email and try again.',
        })
      }
    }

    verify()
  }, [mode, oobCode])

  useEffect(() => {
    if (status.message && (status.tone === 'error' || status.tone === 'success')) {
      publish({ tone: status.tone, message: status.message })
    }
  }, [status, publish])

  const isLoading = status.tone === 'loading'

  return (
    <main className="page" style={{ maxWidth: 480, margin: '32px auto' }}>
      <section className="card">
        <h2 className="page__title">Verify your email</h2>
        <p className="page__subtitle">
          We use email verification to keep your Sedifex account secure.
        </p>

        <p className={`status status--${status.tone}`} style={{ marginTop: 8 }}>
          {status.message}
        </p>

        <button
          type="button"
          className="button button--primary"
          onClick={() => navigate('/', { replace: true })}
          disabled={isLoading}
          style={{ marginTop: 16 }}
        >
          {isLoading ? 'Please wait…' : 'Back to log in'}
        </button>
      </section>
    </main>
  )
}
