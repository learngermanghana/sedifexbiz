// web/src/App.tsx
import React, { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import './App.css'
import './pwa'
import { useToast } from './components/ToastProvider'
import { configureAuthPersistence, persistSession, refreshSessionHeartbeat } from './controllers/sessionController'
import {
  initializeStore,
  resolveStoreAccess,
  type ResolveStoreAccessResult,
  type SignupRoleOption,
  extractCallableErrorMessage,
  INACTIVE_WORKSPACE_MESSAGE,
} from './controllers/accessController'
import { payWithPaystack } from './lib/paystack'
import { AuthUserContext } from './hooks/useAuthUser'
import { getOnboardingStatus, setOnboardingStatus } from './utils/onboarding'

type AuthMode = 'login' | 'signup'
type StatusTone = 'idle' | 'loading' | 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

type QueueRequestType = 'sale' | 'receipt'

function isQueueRequestType(value: unknown): value is QueueRequestType {
  return value === 'sale' || value === 'receipt'
}

const LOGIN_IMAGE_URL = 'https://i.imgur.com/fx9vne9.jpeg'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8

function sanitizePhone(value: string): string {
  return value.replace(/\D+/g, '')
}

function normalizeSignupRole(value: string | SignupRoleOption): SignupRoleOption {
  return value === 'team-member' ? 'team-member' : 'owner'
}

// We intentionally keep the auth account so administrators can investigate the failure later.
async function cleanupFailedSignup(_user: User) {
  try {
    await auth.signOut()
  } catch (error) {
    console.warn('[signup] Unable to sign out after rejected signup', error)
  }
}

interface PasswordStrength {
  isLongEnough: boolean
  hasUppercase: boolean
  hasLowercase: boolean
  hasNumber: boolean
  hasSymbol: boolean
}

function evaluatePasswordStrength(password: string): PasswordStrength {
  return {
    isLongEnough: password.length >= PASSWORD_MIN_LENGTH,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  }
}

function getLoginValidationError(email: string, password: string): string | null {
  if (!email) return 'Enter your email.'
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'
  if (!password) return 'Enter your password.'
  return null
}

type QueueCompletedMessage = {
  type: 'QUEUE_REQUEST_COMPLETED'
  requestType?: unknown
}

type QueueFailedMessage = {
  type: 'QUEUE_REQUEST_FAILED'
  requestType?: unknown
  error?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isQueueCompletedMessage(value: unknown): value is QueueCompletedMessage {
  return isRecord(value) && (value as any).type === 'QUEUE_REQUEST_COMPLETED'
}

function isQueueFailedMessage(value: unknown): value is QueueFailedMessage {
  return isRecord(value) && (value as any).type === 'QUEUE_REQUEST_FAILED'
}

function getQueueRequestLabel(requestType: unknown): string {
  if (!isQueueRequestType(requestType)) return 'request'
  return requestType === 'receipt' ? 'stock receipt' : 'sale'
}

function normalizeQueueError(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [storeId, setStoreId] = useState('')
  const [phone, setPhone] = useState('')
  const [normalizedPhone, setNormalizedPhone] = useState('')
  const [country, setCountry] = useState('')
  const [town, setTown] = useState('')
  const [signupRole, setSignupRole] = useState<SignupRoleOption>('owner')
  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' })
  const isLoading = status.tone === 'loading'
  const { publish } = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const normalizedEmail = email.trim()
  const normalizedPassword = password.trim()
  const normalizedConfirmPassword = confirmPassword.trim()
  const normalizedFullName = fullName.trim()
  const normalizedBusinessName = businessName.trim()
  const normalizedCountry = country.trim()
  const normalizedTown = town.trim()
  const normalizedStoreId = storeId.trim()

  const passwordStrength = evaluatePasswordStrength(normalizedPassword)
  const passwordChecklist = [
    { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, passed: passwordStrength.isLongEnough },
    { id: 'uppercase', label: 'Includes an uppercase letter', passed: passwordStrength.hasUppercase },
    { id: 'lowercase', label: 'Includes a lowercase letter', passed: passwordStrength.hasLowercase },
    { id: 'number', label: 'Includes a number', passed: passwordStrength.hasNumber },
    { id: 'symbol', label: 'Includes a symbol', passed: passwordStrength.hasSymbol },
  ] as const

  const doesPasswordMeetAllChecks = passwordChecklist.every(item => item.passed)
  const isSignupFormValid =
    normalizedEmail.length > 0 &&
    normalizedPassword.length > 0 &&
    normalizedFullName.length > 0 &&
    normalizedBusinessName.length > 0 &&
    normalizedPhone.length > 0 &&
    normalizedCountry.length > 0 &&
    normalizedTown.length > 0 &&
    (signupRole === 'team-member' ? normalizedStoreId.length > 0 : true)

  const isLoginFormValid = EMAIL_PATTERN.test(normalizedEmail) && normalizedPassword.length > 0
  const isSubmitDisabled = isLoading || (mode === 'login' ? !isLoginFormValid : !isSignupFormValid)

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
    if (!isAuthReady || user) return
    if (status.tone === 'loading') setStatus({ tone: 'idle', message: '' })
  }, [isAuthReady, status.tone, user])

  useEffect(() => {
    if (!user) return
    refreshSessionHeartbeat(user).catch(error => {
      console.warn('[session] Unable to refresh session', error)
    })
  }, [user])

  useEffect(() => {
    if (!user) return
    let status = getOnboardingStatus(user.uid)
    if (!status) {
      status = 'pending'
      setOnboardingStatus(user.uid, 'pending')
    }
    if (status === 'pending' && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true })
    }
  }, [location.pathname, navigate, user])

  useEffect(() => {
    // Small UX touch: show the current auth mode in the tab title
    document.title = mode === 'login' ? 'Sedifex — Log in' : 'Sedifex — Sign up'
  }, [mode])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (isQueueCompletedMessage(data)) {
        const label = getQueueRequestLabel(data.requestType)
        publish({ message: `Queued ${label} synced successfully.`, tone: 'success' })
        return
      }

      if (isQueueFailedMessage(data)) {
        const label = getQueueRequestLabel(data.requestType)
        const detail = normalizeQueueError(data.error)
        publish({
          message: detail
            ? `We couldn't sync the queued ${label}. ${detail}`
            : `We couldn't sync the queued ${label}. Please try again.`,
          tone: 'error',
          duration: 8000,
        })
      }
    }

    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [publish])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const sanitizedEmail = email.trim()
    const sanitizedPassword = password.trim()
    const sanitizedConfirmPassword = confirmPassword.trim()
    setEmail(sanitizedEmail)
    setPassword(sanitizedPassword)
    if (mode === 'signup') setConfirmPassword(sanitizedConfirmPassword)

    const sanitizedPhone = sanitizePhone(phone)
    const sanitizedFullName = fullName.trim()
    const sanitizedBusinessName = businessName.trim()
    const sanitizedCountry = country.trim()
    const sanitizedTown = town.trim()
    const sanitizedSignupRole = normalizeSignupRole(signupRole)
    const sanitizedStoreId = storeId.trim()

    const validationError =
      mode === 'login' ? getLoginValidationError(sanitizedEmail, sanitizedPassword) : null

    if (mode === 'signup') {
      setPhone(sanitizedPhone)
      setNormalizedPhone(sanitizedPhone)
      setFullName(sanitizedFullName)
      setBusinessName(sanitizedBusinessName)
      setCountry(sanitizedCountry)
      setTown(sanitizedTown)
      setSignupRole(sanitizedSignupRole)
      setStoreId(sanitizedStoreId)
    }

    if (validationError) {
      setStatus({ tone: 'error', message: validationError })
      return
    }

    if (mode === 'signup' && sanitizedSignupRole === 'team-member' && !sanitizedStoreId) {
      setStatus({ tone: 'error', message: 'Enter your store ID to continue.' })
      return
    }

    setStatus({
      tone: 'loading',
      message: mode === 'login' ? 'Signing you in…' : 'Creating your account…',
    })

    try {
      if (mode === 'login') {
        const { user: nextUser } = await signInWithEmailAndPassword(
          auth,
          sanitizedEmail,
          sanitizedPassword,
        )
        await persistSession(nextUser)
        try {
          const resolution = await resolveStoreAccess()
          await persistSession(nextUser, {
            storeId: resolution.storeId,
            workspaceSlug: resolution.workspaceSlug,
            role: resolution.role,
          })
        } catch (error) {
          console.warn('[auth] Failed to resolve workspace access', error)
          setStatus({ tone: 'error', message: getErrorMessage(error) })
          return
        }
      } else {
        const { user: nextUser } = await createUserWithEmailAndPassword(
          auth,
          sanitizedEmail,
          sanitizedPassword,
        )
        await persistSession(nextUser)

        let initializedStoreId: string | undefined
        try {
          const initialization = await initializeStore({
            phone: sanitizedPhone || null,
            firstSignupEmail: sanitizedEmail ? sanitizedEmail.toLowerCase() : null,
            ownerName: sanitizedFullName || null,
            businessName: sanitizedBusinessName || null,
            country: sanitizedCountry || null,
            town: sanitizedTown || null,
            signupRole: sanitizedSignupRole,
          }, sanitizedSignupRole === 'team-member' ? sanitizedStoreId : null)
          initializedStoreId = initialization.storeId
        } catch (error) {
          console.warn('[signup] Failed to initialize workspace', error)
          setStatus({ tone: 'error', message: getErrorMessage(error) })
          await cleanupFailedSignup(nextUser)
          return
        }

        let resolution: ResolveStoreAccessResult
        try {
          resolution = await resolveStoreAccess(initializedStoreId)
        } catch (error) {
          console.warn('[signup] Failed to resolve workspace access', error)
          setStatus({ tone: 'error', message: getErrorMessage(error) })
          await cleanupFailedSignup(nextUser)
          return
        }

        await persistSession(nextUser, {
          storeId: resolution.storeId,
          workspaceSlug: resolution.workspaceSlug,
          role: resolution.role,
        })

        try {
          const preferredDisplayName =
            sanitizedFullName || nextUser.displayName?.trim() || sanitizedEmail
          const resolvedBusinessName = sanitizedBusinessName || null
          const resolvedOwnerName = sanitizedFullName || preferredDisplayName
          const customerName = resolvedBusinessName || resolvedOwnerName
          await setDoc(
            doc(db, 'customers', nextUser.uid),
            {
              storeId: resolution.storeId,
              name: customerName,
              displayName: resolvedOwnerName,
              email: sanitizedEmail,
              phone: sanitizedPhone,
              businessName: resolvedBusinessName,
              ownerName: resolvedOwnerName,
              country: sanitizedCountry || null,
              town: sanitizedTown || null,
              status: 'active',
              role: 'client',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          )
        } catch (error) {
          console.warn('[customers] Unable to upsert customer record', error)
        }
        try {
          await nextUser.getIdToken(true)
        } catch (error) {
          console.warn('[auth] Unable to refresh ID token after signup', error)
        }
        setOnboardingStatus(nextUser.uid, 'pending')
        try {
          await auth.signOut()
        } catch (error) {
          console.warn('[signup] Unable to sign out after successful signup', error)
        }
        setMode('login')
      }

      setStatus({
        tone: 'success',
        message: mode === 'login'
          ? 'Welcome back! Redirecting…'
          : 'Account created! You can now sign in.',
      })
      setPassword('')
      setConfirmPassword('')
      setFullName('')
      setBusinessName('')
      setPhone('')
      setNormalizedPhone('')
      setCountry('')
      setTown('')
      setStoreId('')
      setSignupRole('owner')
    } catch (err: unknown) {
      setStatus({ tone: 'error', message: getErrorMessage(err) })
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
    setConfirmPassword('')
    setFullName('')
    setBusinessName('')
    setPhone('')
    setNormalizedPhone('')
    setCountry('')
    setTown('')
    setSignupRole('owner')
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
    const PAGE_FEATURES = [
      {
        path: '/products',
        name: 'Products',
        description:
          'Spot low inventory, sync counts, and keep every SKU accurate across locations.',
      },
      {
        path: '/sell',
        name: 'Sell',
        description:
          'Ring up sales with guided workflows that keep the floor moving and customers happy.',
      },
      {
        path: '/receive',
        name: 'Receive',
        description:
          'Check in purchase orders, reconcile deliveries, and put new stock to work immediately.',
      },
      {
        path: '/customers',
        name: 'Customers',
        description:
          'Understand top shoppers, loyalty trends, and service follow-ups without exporting data.',
      },
      {
        path: '/close-day',
        name: 'Close Day',
        description:
          'Tie out cash, settle registers, and share end-of-day reports with finance in one view.',
      },
    ] as const

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

            {/* --- TEMP: Test Paystack flow (remove later) --- */}
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="secondary-button"
                onClick={async () => {
                  const r = await payWithPaystack(12.5, {
                    email: normalizedEmail || 'testbuyer@example.com',
                    phone: normalizedPhone,
                    name: normalizedFullName || 'Test Buyer',
                  })
                  if (r.ok && r.reference) {
                    publish({
                      tone: 'success',
                      message: `Paystack test payment complete. Ref: ${r.reference}`,
                    })
                    // Later: call commitSale(...) with
                    // { provider: 'paystack', method: 'card', providerRef: r.reference, status: 'pending' }
                  } else {
                    publish({
                      tone: 'error',
                      message: r.error || 'Payment cancelled or failed',
                    })
                  }
                }}
              >
                Test Paystack (GHS 12.50)
              </button>
              <p className="form__hint">Uses Paystack Test Mode. No real charge.</p>
            </div>
            {/* --- /TEMP --- */}

            <div className="app__pill-group" role="list">
              <span className="app__pill" role="listitem">
                Realtime visibility
              </span>
              <span className="app__pill" role="listitem">
                Multi-location ready
              </span>
              <span className="app__pill" role="listitem">
                Floor-friendly UI
              </span>
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
                  onBlur={() => setEmail(current => current.trim())}
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  disabled={isLoading}
                  inputMode="email"
                  aria-invalid={email.length > 0 && !EMAIL_PATTERN.test(normalizedEmail)}
                />
              </div>

              {mode === 'signup' && (
                <div className="form__field">
                  <label htmlFor="full-name">Full name</label>
                  <input
                    id="full-name"
                    value={fullName}
                    onChange={event => setFullName(event.target.value)}
                    onBlur={() => setFullName(current => current.trim())}
                    type="text"
                    autoComplete="name"
                    placeholder="Alex Morgan"
                    required
                    disabled={isLoading}
                    aria-invalid={fullName.length > 0 && normalizedFullName.length === 0}
                    aria-describedby="full-name-hint"
                  />
                  <p className="form__hint" id="full-name-hint">
                    Helps personalize your workspace and invites.
                  </p>
                </div>
              )}

              {mode === 'signup' && (
                <div className="form__field">
                  <label htmlFor="business-name">Business name</label>
                  <input
                    id="business-name"
                    value={businessName}
                    onChange={event => setBusinessName(event.target.value)}
                    onBlur={() => setBusinessName(current => current.trim())}
                    type="text"
                    autoComplete="organization"
                    placeholder="Morgan Retail Co."
                    required
                    disabled={isLoading}
                    aria-invalid={businessName.length > 0 && normalizedBusinessName.length === 0}
                    aria-describedby="business-name-hint"
                  />
                  <p className="form__hint" id="business-name-hint">
                    We’ll tailor onboarding based on your store name.
                  </p>
                </div>
              )}

              {mode === 'signup' && (
                <div className="form__field">
                  <label htmlFor="phone">Phone</label>
                  <input
                    id="phone"
                    value={phone}
                    onChange={event => {
                      const nextValue = event.target.value
                      setPhone(nextValue)
                      setNormalizedPhone(sanitizePhone(nextValue))
                    }}
                    onBlur={() =>
                      setPhone(current => {
                        const trimmed = current.trim()
                        const sanitized = sanitizePhone(trimmed)
                        setNormalizedPhone(sanitized)
                        return sanitized
                      })
                    }
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="(555) 123-4567"
                    required
                    disabled={isLoading}
                    aria-invalid={phone.length > 0 && normalizedPhone.length === 0}
                    aria-describedby="phone-hint"
                  />
                  <p className="form__hint" id="phone-hint">
                    We’ll use this to tailor your onboarding.
                  </p>
                </div>
              )}

              {mode === 'signup' && (
                <div className="form__field">
                  <label htmlFor="country">Country</label>
                  <input
                    id="country"
                    value={country}
                    onChange={event => setCountry(event.target.value)}
                    onBlur={() => setCountry(current => current.trim())}
                    type="text"
                    autoComplete="country-name"
                    placeholder="Ghana"
                    required
                    disabled={isLoading}
                    aria-invalid={country.length > 0 && normalizedCountry.length === 0}
                    aria-describedby="country-hint"
                  />
                  <p className="form__hint" id="country-hint">
                    Let us know where your business operates.
                  </p>
                </div>
              )}

              {mode === 'signup' && (
                <div className="form__field">
                  <label htmlFor="town">Town or city</label>
                  <input
                    id="town"
                    value={town}
                    onChange={event => setTown(event.target.value)}
                    onBlur={() => setTown(current => current.trim())}
                    type="text"
                    autoComplete="address-level2"
                    placeholder="Accra"
                    required
                    disabled={isLoading}
                    aria-invalid={town.length > 0 && normalizedTown.length === 0}
                    aria-describedby="town-hint"
                  />
                  <p className="form__hint" id="town-hint">
                    We’ll adapt recommendations for your local market.
                  </p>
                </div>
              )}

              {mode === 'signup' && (
                <fieldset className="form__field form__field--choices">
                  <legend>Are you the owner or joining a team?</legend>
                  <div className="form__choice-group" role="radiogroup" aria-label="Signup role">
                    <label className="form__choice" data-selected={signupRole === 'owner'}>
                      <input
                        type="radio"
                        name="signup-role"
                        value="owner"
                        checked={signupRole === 'owner'}
                        onChange={() => setSignupRole('owner')}
                        disabled={isLoading}
                      />
                      <span>I’m the business owner</span>
                    </label>
                    <label className="form__choice" data-selected={signupRole === 'team-member'}>
                      <input
                        type="radio"
                        name="signup-role"
                        value="team-member"
                        checked={signupRole === 'team-member'}
                        onChange={() => setSignupRole('team-member')}
                        disabled={isLoading}
                      />
                      <span>I’m joining as a team member</span>
                    </label>
                  </div>
                  <p className="form__hint">We’ll customize onboarding tips based on your role.</p>
                </fieldset>
              )}

              {mode === 'signup' && signupRole === 'team-member' && (
                <div className="form__field">
                  <label htmlFor="store-id">Store ID</label>
                  <input
                    id="store-id"
                    value={storeId}
                    onChange={event => setStoreId(event.target.value)}
                    onBlur={() => setStoreId(current => current.trim())}
                    type="text"
                    autoComplete="off"
                    placeholder="Enter the store ID from your owner"
                    required
                    disabled={isLoading}
                    aria-invalid={storeId.length > 0 && normalizedStoreId.length === 0}
                    aria-describedby="store-id-hint"
                  />
                  <p className="form__hint" id="store-id-hint">
                    Ask your workspace owner for the store ID to join their team.
                  </p>
                </div>
              )}

              <div className="form__field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  onBlur={() => setPassword(current => current.trim())}
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="Use a strong password"
                  required
                  disabled={isLoading}
                  aria-invalid={mode === 'signup' && normalizedPassword.length > 0 && !doesPasswordMeetAllChecks}
                  aria-describedby={mode === 'signup' ? 'password-guidelines' : undefined}
                />
                {mode === 'signup' && (
                  <ul className="form__hint-list" id="password-guidelines">
                    {passwordChecklist.map(item => (
                      <li key={item.id} data-complete={item.passed}>
                        <span className={`form__hint-indicator${item.passed ? ' is-valid' : ''}`}>
                          {item.passed ? '✓' : '•'}
                        </span>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {mode === 'signup' && (
                <div className="form__field">
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    value={confirmPassword}
                    onChange={event => setConfirmPassword(event.target.value)}
                    onBlur={() => setConfirmPassword(current => current.trim())}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    required
                    disabled={isLoading}
                    aria-invalid={normalizedConfirmPassword.length > 0 && normalizedPassword !== normalizedConfirmPassword}
                    aria-describedby="confirm-password-hint"
                  />
                  <p className="form__hint" id="confirm-password-hint">
                    Must match the password exactly.
                  </p>
                </div>
              )}

              <button className="primary-button" type="submit" disabled={isSubmitDisabled}>
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
                <Link className="app__visual-link" to="/sell">
                  Live sales
                </Link>
                ,{' '}
                <Link className="app__visual-link" to="/products">
                  inventory alerts
                </Link>
                , and{' '}
                <Link className="app__visual-link" to="/close-day">
                  smart counts
                </Link>{' '}
                help your whole team stay aligned from any device.
              </p>
            </div>
          </aside>
        </div>

        <section className="app__features" aria-label="Sedifex workspace pages">
          <header className="app__features-header">
            <h2>Explore the workspace</h2>
            <p>
              Every Sedifex page is built to keep retail operations synchronized—from the sales
              floor to finance.
            </p>
          </header>

          <div className="app__features-grid" role="list">
            {PAGE_FEATURES.map(feature => (
              <Link
                key={feature.path}
                className="feature-card"
                to={feature.path}
                role="listitem"
                aria-label={`Open the ${feature.name} page`}
              >
                <div className="feature-card__body">
                  <h3>{feature.name}</h3>
                  <p>{feature.description}</p>
                </div>
                <span className="feature-card__cta" aria-hidden="true">
                  Visit {feature.name}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="app__info-grid" aria-label="Sedifex company information">
          <article className="info-card">
            <h3>About Sedifex</h3>
            <p>
              Sedifex is the operations control tower for modern retail teams. We unite store
              execution, warehouse visibility, and merchandising insights so every location
              can act on the same live source of truth.
            </p>
            <p>
              Connect your POS, ecommerce, and supplier systems in minutes to orchestrate the
              entire product journey—from forecast to fulfillment—with less manual work and
              far fewer stockouts.
            </p>
            <footer>
              <ul className="info-card__list">
                <li>Real-time inventory that syncs every channel and warehouse</li>
                <li>Automated replenishment playbooks driven by store performance</li>
                <li>Integrations for Shopify, NetSuite, Square, and 40+ retail tools</li>
              </ul>
            </footer>
          </article>

          <article className="info-card">
            <h3>Our Mission</h3>
            <p>
              We believe resilient retailers win by responding to change faster than their
              inventory can move. Sedifex exists to give operators the clarity and confidence
              to do exactly that.
            </p>
            <ul className="info-card__list">
              <li>Deliver every SKU promise with predictive inventory intelligence</li>
              <li>Empower teams with guided workflows, not spreadsheets</li>
              <li>Earn shopper loyalty through always-on availability</li>
            </ul>
          </article>

          <article className="info-card">
            <h3>Contact Sales</h3>
            <p>
              Partner with a retail operations strategist to tailor Sedifex to your fleet,
              review pricing, and build an onboarding plan that keeps stores running while we
              launch.
            </p>
            <a
              className="info-card__cta"
              href="https://calendly.com/sedifex/demo"
              target="_blank"
              rel="noreferrer noopener"
            >
              Book a 30-minute consultation
            </a>
            <p className="info-card__caption">Prefer email? Reach us at sales@sedifex.com.</p>
          </article>
        </section>
      </main>
    )
  }

  return (
    <AuthUserContext.Provider value={user}>
      <Outlet />
    </AuthUserContext.Provider>
  )
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
        return 'Please choose a stronger password. It must be at least 8 characters and include uppercase, lowercase, number, and symbol.'
      case 'functions/permission-denied': {
        const callableMessage = extractCallableErrorMessage(error) ?? INACTIVE_WORKSPACE_MESSAGE
        return callableMessage
      }
      default:
        return (error as any).message || 'Something went wrong. Please try again.'
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
