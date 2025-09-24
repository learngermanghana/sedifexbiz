import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth'
import { auth } from './firebase'
import './pwa'

type AuthMode = 'login' | 'signup'

type StatusState = {
  message: string
  tone: 'info' | 'success' | 'error'
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<StatusState | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, nextUser => setUser(nextUser))
    return unsubscribe
  }, [])

  const handleModeChange = useCallback((nextMode: AuthMode) => {
    setMode(nextMode)
    setStatus(null)
  }, [])

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (isSubmitting) return

      const trimmedEmail = email.trim()
      const trimmedPassword = password.trim()

      if (!trimmedEmail || !trimmedPassword) {
        setStatus({
          message: 'Please enter both an email and a password.',
          tone: 'error'
        })
        return
      }

      setStatus({
        message: mode === 'login' ? 'Signing in…' : 'Creating account…',
        tone: 'info'
      })
      setIsSubmitting(true)

      try {
        if (mode === 'login') {
          await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword)
        } else {
          await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword)
        }
        setStatus({
          message: mode === 'login' ? 'Signed in successfully.' : 'Account created successfully.',
          tone: 'success'
        })
      } catch (error) {
        setStatus({
          message: getErrorMessage(error),
          tone: 'error'
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, isSubmitting, mode, password]
  )

  const statusColor = useMemo(() => {
    switch (status?.tone) {
      case 'success':
        return '#047857'
      case 'error':
        return '#B91C1C'
      default:
        return '#555'
    }
  }, [status])

  const modeLabel = mode === 'login' ? 'Login' : 'Create account'

  if (!user) {
    return (
      <div style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'Inter, system-ui, Arial' }}>
        <h1 style={{ color: '#4338CA' }}>Sedifex</h1>
        <p>Sell faster. Count smarter.</p>

        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => handleModeChange('login')}
            style={{
              marginRight: 8,
              padding: '6px 10px',
              borderRadius: 8,
              border: mode === 'login' ? '2px solid #4338CA' : '1px solid #ddd',
              background: '#fff'
            }}
          >
            Login
          </button>
          <button
            onClick={() => handleModeChange('signup')}
            style={{
              padding: '6px 10px',
              borderRadius: 8,
              border: mode === 'signup' ? '2px solid #4338CA' : '1px solid #ddd',
              background: '#fff'
            }}
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
          <label>Email</label>
          <input
            value={email}
            onChange={event => {
              setEmail(event.target.value)
              if (status) setStatus(null)
            }}
            type="email"
            required
            style={{ display: 'block', width: '100%', padding: 12, marginTop: 8 }}
          />
          <label style={{ marginTop: 12, display: 'block' }}>Password</label>
          <input
            value={password}
            onChange={event => {
              setPassword(event.target.value)
              if (status) setStatus(null)
            }}
            type="password"
            required
            style={{ display: 'block', width: '100%', padding: 12, marginTop: 8 }}
          />
          <button
            type="submit"
            style={{
              marginTop: 12,
              padding: '10px 16px',
              background: '#4338CA',
              color: '#fff',
              borderRadius: 8,
              border: 0,
              opacity: isSubmitting ? 0.85 : 1,
              cursor: isSubmitting ? 'not-allowed' : 'pointer'
            }}
            disabled={isSubmitting}
          >
            {modeLabel}
          </button>
        </form>

        <p aria-live="polite" style={{ marginTop: 12, color: statusColor }}>
          {status?.message}
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'Inter, system-ui, Arial' }}>
      <h1 style={{ color: '#4338CA' }}>Sedifex</h1>
      <p>
        Logged in as <strong>{user.email}</strong>
      </p>

      {/* Hash link so it works without server rewrites */}
      <a href="#/products" style={{ display: 'inline-block', marginTop: 12 }}>
        Go to Products →
      </a>

      <button
        onClick={() => signOut(auth)}
        style={{ display: 'block', marginTop: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd' }}
      >
        Sign out
      </button>

      <p style={{ marginTop: 24 }}>Next: Products & Sell screen.</p>
    </div>
  )
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'Something went wrong. Please try again.'
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Something went wrong. Please try again.'
}
