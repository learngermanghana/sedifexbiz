import React, { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { Outlet } from 'react-router-dom'
import { auth } from './firebase'
import './App.css'
import './pwa'
import { useToast } from './components/ToastProvider'
import {
  configureAuthPersistence,
  persistSession,
  refreshSessionHeartbeat,
} from './controllers/sessionController'

type AuthMode = 'login' | 'signup'

type StatusTone = 'idle' | 'loading' | 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

const LOGIN_IMAGE_URL = 'https://i.imgur.com/fx9vne9.jpeg'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' })
  const isLoading = status.tone === 'loading'
  const { publish } = useToast()

  useEffect(() => {
    // Ensure persistence is configured before we react to auth changes
    configureAuthPersistence(auth).catch(error => {
      console.warn('[auth] Unable to configure persistence', error)
    })

    const unsubscribe = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser)
      setIsAuthReady(true)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user) return
    refreshSessionHeartbeat(user).catch(error => {
      console.warn('[session] Unable to refresh session', error)
    })
  }, [user])

  useEffect(() => {
    // Small UX touch: show the current auth mode in the tab title
    document.title = mode === 'login' ? 'Sedifex — Log in' : 'Sedifex — Sign up'
  }, [mode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus({
      tone: 'loading',
      message: mode === 'login' ? 'Signing you in…' : 'Creating your account…',
    })
    try {
      if (mode === 'login') {
        const { user: nextUser } = await signInWithEmailAndPassword(auth, email, password)
        await persistSession(nextUser)
      } else {
        const { user: nextUser } = await createUserWithEmailAndPassword(auth, email, password)
        await persistSession(nextUser)
      }
      setStatus({
        tone: 'success',
        message: mode === 'login' ? 'Welcome back! Redirecting…' : 'All set! Your account is ready.',
      })
      // Optional: clear the password field post-success
      setPassword('')
    } catch (err: unknown) {
      setStatus({
        tone: 'error',
        message: getErrorMessage(err),
      })
    }
  }

  useEffect(() => {
    if (!status.message) return
    if (status.tone === 'success' || status.tone === 'error') {
      publish({ tone: status.tone, message: status.message })
    }
  }, [publish, status.message, status.tone])

  function handleModeChange(nextMode: AuthMode) {
    setMode(nextMode)
    setStatus({ tone: 'idle', message: '' })
  }

  // Inline minHeight is just a safety net; CSS already uses dvh/svh.
  const appStyle: React.CSSProperties = { minHeight: '100dvh' }

  if (!isAuthReady) {
    return (
      <main className="app" style={appStyle}>
        <div className="app__card">
          <p className="form__hint">Checking your session…</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="app" style={appStyle}>
        <div className="app__layout">
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

            <div className="app__pill-group" role="list">
              <span className="app__pill" role="listitem">Realtime visibility</span>
              <span className="app__pill" role="listitem">Multi-location ready</span>
              <span className="app__pill" role="listitem">Floor-friendly UI</span>
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
                disabled={isLoading}
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                className={`toggle-button${mode === 'signup' ? ' is-active' : ''}`}
                onClick={() => handleModeChange('signup')}
                disabled={isLoading}
              >
                Sign up
              </button>
            </div>

            <form className="form" onSubmit={handleSubmit} aria-busy={isLoading} noValidate>
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
                  inputMode="email"
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

          <aside className="app__visual" aria-hidden="true">
            <img
              src={LOGIN_IMAGE_URL}
              alt="Team members organizing inventory packages in a warehouse"
              loading="lazy"
            />
            <div className="app__visual-overlay" />
            <div className="app__visual-caption">
              <span className="app__visual-pill">Operations snapshot</span>
              <h2>Stay synced from the floor to finance</h2>
              <p>
                Live sales, inventory alerts, and smart counts help your whole team stay aligned
                from any device.
              </p>
            </div>
          </aside>
        </div>

        <section className="app__info-grid" aria-label="Sedifex company information">
          <article className="info-card">
            <h3>About Sedifex</h3>
            <p>
              We&apos;ll soon share the story behind Sedifex, the retailers we empower, and the
              product principles that guide our platform.
            </p>
            <footer>
              <span className="info-card__placeholder">Team bio and product timeline coming soon.</span>
            </footer>
          </article>

          <article className="info-card">
            <h3>Our Mission</h3>
            <p>
              This space will outline our mission, vision, and the values that keep every
              inventory count accurate and every sales floor connected.
            </p>
            <ul className="info-card__list">
              <li>Mission statement</li>
              <li>Core values</li>
              <li>Customer promises</li>
            </ul>
          </article>

          <article className="info-card">
            <h3>Contact Sales</h3>
            <p>
              Ready to see Sedifex in action? We&apos;ll add direct ways to reach our sales team
              for demos, pricing, and onboarding support.
            </p>
            <button type="button" className="info-card__cta" disabled>
              Contact our sales team
            </button>
            <span className="info-card__placeholder">Live chat and calendar booking coming soon.</span>
          </article>
        </section>
      </main>
    )
  }

  return <Outlet />
}

function getErrorMessage(error: unknown): string {
  // Friendlier Firebase Auth errors
  if (error instanceof FirebaseError) {
    const code = error.code || ''
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.'
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.'
      case 'auth/network-request-failed':
        return 'Network error. Please check your connection and try again.'
      case 'auth/email-already-in-use':
        return 'An account already exists with this email.'
      case 'auth/weak-password':
        return 'Please choose a stronger password (at least 6 characters).'
      default:
        return error.message || 'Something went wrong. Please try again.'
    }
  }

  if (error instanceof Error) {
    return error.message || 'Something went wrong. Please try again.'
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Something went wrong. Please try again.'
}
