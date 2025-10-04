import { useCallback, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthForm, inputGroupStyle, inputStyle, labelStyle, noteStyle } from '../components/auth/AuthForm'
import { useToast } from '../components/ToastProvider'
import { afterSignupBootstrap } from '../controllers/accessController'
import { supabase } from '../supabaseClient'
import { colors, overlays, radii, shadows } from '../styles/themeTokens'

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
          const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          })

          if (signInError) {
            const message = normalizeError(signInError)
            setError(message)
            publish({ message, tone: 'error' })
            return
          }

          if (!data.session) {
            publish({ message: 'Signed in. Loading your workspace…', tone: 'info' })
          } else {
            publish({ message: 'Welcome back!', tone: 'success' })
          }

          navigate(redirectTo, { replace: true })
          return
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        })

        if (signUpError) {
          const message = normalizeError(signUpError)
          setError(message)
          publish({ message, tone: 'error' })
          return
        }

        if (data.user?.id) {
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
        }

        const successMessage = data.session
          ? 'Account created! Setting things up now…'
          : 'Check your inbox to confirm your email and finish setting up your account.'
        publish({ message: successMessage, tone: 'success' })

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
    <main style={screenStyle}>
      <div style={panelStyle}>
        <div style={brandStyle}>
          <div style={logoStyle}>Sedifex</div>
          <p style={taglineStyle}>Sell faster. Count smarter.</p>
        </div>

        <div style={modeToggleStyle}>
          <button
            type="button"
            onClick={() => toggleMode('sign-in')}
            style={{ ...modeButtonStyle, ...(mode === 'sign-in' ? modeButtonActiveStyle : {}) }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => toggleMode('sign-up')}
            style={{ ...modeButtonStyle, ...(mode === 'sign-up' ? modeButtonActiveStyle : {}) }}
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
                style={footerActionButtonStyle}
                disabled={loading}
              >
                {footerActionButtonLabel}
              </button>
            </div>
          }
        >
          <label style={inputGroupStyle}>
            <span style={labelStyle}>Email</span>
            <input
              style={inputStyle}
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

          <label style={inputGroupStyle}>
            <span style={labelStyle}>Password</span>
            <input
              style={inputStyle}
              type="password"
              name="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              placeholder="Enter at least 8 characters"
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={loading}
              required
            />
            <p style={noteStyle}>Use at least {MIN_PASSWORD_LENGTH} characters for a strong password.</p>
          </label>
        </AuthForm>
      </div>
    </main>
  )
}

const screenStyle: CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '2rem',
  background: `radial-gradient(circle at top, ${overlays.brandTint}, transparent 55%), ${colors.background}`,
}

const panelStyle: CSSProperties = {
  width: '100%',
  maxWidth: '520px',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem',
  alignItems: 'center',
}

const brandStyle: CSSProperties = {
  textAlign: 'center',
  color: colors.textPrimary,
}

const logoStyle: CSSProperties = {
  fontWeight: 800,
  fontSize: '2.5rem',
  letterSpacing: '-0.04em',
}

const taglineStyle: CSSProperties = {
  margin: '0.5rem 0 0',
  fontSize: '1rem',
  color: colors.textSecondary,
}

const modeToggleStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  backgroundColor: overlays.brandOutline,
  borderRadius: radii.pill,
  padding: '0.25rem',
  gap: '0.25rem',
}

const modeButtonStyle: CSSProperties = {
  appearance: 'none',
  border: 'none',
  borderRadius: radii.pill,
  padding: '0.6rem 1.25rem',
  fontSize: '0.95rem',
  fontWeight: 600,
  backgroundColor: 'transparent',
  color: colors.textSecondary,
  cursor: 'pointer',
  transition: 'background-color 150ms ease, color 150ms ease, box-shadow 150ms ease',
}

const modeButtonActiveStyle: CSSProperties = {
  backgroundColor: colors.surface,
  color: colors.info,
  boxShadow: shadows.infoLift,
}

const footerActionButtonStyle: CSSProperties = {
  appearance: 'none',
  background: 'none',
  border: 'none',
  color: colors.infoStrong,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
}
