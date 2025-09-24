import React, { useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from 'firebase/auth'
import { auth } from './firebase'
import './App.css'
import './pwa'

type AuthMode = 'login' | 'signup'
type StatusTone = 'idle' | 'loading' | 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

export default function App() {
  const [user, setUser] = useState<any>(null)
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' })
  const isLoading = status.tone === 'loading'

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus({
      tone: 'loading',
      message: mode === 'login' ? 'Signing you in…' : 'Creating your account…'
    })
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
      }
      setStatus({
        tone: 'success',
        message: mode === 'login' ? 'Welcome back! Redirecting…' : 'All set! Your account is ready.'
      })
    } catch (err: any) {
      setStatus({
        tone: 'error',
        message: err?.message || 'Something went wrong. Please try again.'
      })
    }
  }

  function handleModeChange(nextMode: AuthMode) {
    setMode(nextMode)
    setStatus({ tone: 'idle', message: '' })
  }

  if (!user) {
    return (
      <main className="app">
        <div className="app__card">
          <div className="app__brand">
            <span className="app__logo">Sx</span>
            <div>
              <h1 className="app__title">Sedifex</h1>
              <p className="app__tagline">
                Sell faster. <span className="app__highlight">Count smarter.</span>
              </p>
            </div>
          </div>

          <p className="form__hint">
            {mode === 'login'
              ? 'Welcome back! Sign in to keep your stock moving.'
              : 'Create an account to start tracking sales and inventory in minutes.'}
          </p>

          <div className="toggle-group" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`toggle-button${mode === 'login' ? ' is-active' : ''}`}
              onClick={() => handleModeChange('login')}
            >
              Log in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`toggle-button${mode === 'signup' ? ' is-active' : ''}`}
              onClick={() => handleModeChange('signup')}
            >
              Sign up
            </button>
          </div>

          <form className="form" onSubmit={handleSubmit} aria-busy={isLoading}>
            <div className="form__field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                disabled={isLoading}
              />
            </div>
            <div className="form__field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="Enter at least 6 characters"
                required
                disabled={isLoading}
              />
            </div>
            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading
                ? mode === 'login'
                  ? 'Signing in…'
                  : 'Creating account…'
                : mode === 'login'
                  ? 'Log in'
                  : 'Create account'}
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
        </div>
      </main>
    )
  }

  return (
    <main className="app">
      <div className="app__card">
        <div className="app__brand">
          <span className="app__logo">Sx</span>
          <div>
            <h1 className="app__title">Sedifex</h1>
            <p className="app__tagline">Your retail command center.</p>
          </div>
        </div>

        <p className="form__hint">
          Signed in as <strong>{user.email}</strong>
        </p>

        <ul className="app__feature-list">
          <li>Track live stock levels across every location.</li>
          <li>Checkout customers in seconds with the Sell screen.</li>
          <li>Stay on target with smart alerts and insights.</li>
        </ul>

        <a className="link-button" href="#/products">
          Browse products <span aria-hidden="true">→</span>
        </a>

        <button className="secondary-button" onClick={() => signOut(auth)}>
          Sign out
        </button>

        <p className="app__footer">Next up: Products &amp; Sell screen.</p>
      </div>
    </main>
  )
}
