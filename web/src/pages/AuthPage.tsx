import React, { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { Link } from 'react-router-dom'
import '../App.css'
import { useToast } from '../components/ToastProvider'
import { persistSession } from '../controllers/sessionController'
import {
  initializeStore,
  resolveStoreAccess,
  type ResolveStoreAccessResult,
  type SignupRoleOption,
  extractCallableErrorMessage,
  INACTIVE_WORKSPACE_MESSAGE,
} from '../controllers/accessController'
import { payWithPaystack } from '../lib/paystack'
import { auth, db } from '../firebase'
import { setOnboardingStatus } from '../utils/onboarding'

const LOGIN_IMAGE_URL = 'https://i.imgur.com/fx9vne9.jpeg'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8

type AuthMode = 'login' | 'signup'
type StatusTone = 'idle' | 'loading' | 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

interface PasswordStrength {
  isLongEnough: boolean
  hasUppercase: boolean
  hasLowercase: boolean
  hasNumber: boolean
  hasSymbol: boolean
}

function sanitizePhone(value: string): string {
  return value.replace(/\D+/g, '')
}

function normalizeSignupRole(value: string | SignupRoleOption): SignupRoleOption {
  return value === 'team-member' ? 'team-member' : 'owner'
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

function getErrorMessage(error: unknown): string {
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

export default function AuthPage() {
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

  const normalizedEmail = email.trim()
  const normalizedPassword = password.trim()
  const normalizedConfirmPassword = confirmPassword.trim()
  const normalizedFullName = fullName.trim()
  const normalizedBusinessName = businessName.trim()
  const normalizedCountry = country.trim()
  const normalizedTown = town.trim()
  const normalizedStoreId = storeId.trim()

  const passwordStrength = evaluatePasswordStrength(normalizedPassword)
  const passwordChecklist = useMemo(
    () => [
      { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, passed: passwordStrength.isLongEnough },
      { id: 'uppercase', label: 'Includes an uppercase letter', passed: passwordStrength.hasUppercase },
      { id: 'lowercase', label: 'Includes a lowercase letter', passed: passwordStrength.hasLowercase },
      { id: 'number', label: 'Includes a number', passed: passwordStrength.hasNumber },
      { id: 'symbol', label: 'Includes a symbol', passed: passwordStrength.hasSymbol },
    ] as const,
    [passwordStrength.hasLowercase, passwordStrength.hasNumber, passwordStrength.hasSymbol, passwordStrength.hasUppercase, passwordStrength.isLongEnough],
  )

  const doesPasswordMeetAllChecks = passwordChecklist.every(item => item.passed)
  const doPasswordsMatch = normalizedPassword === normalizedConfirmPassword
  const isSignupFormValid =
    normalizedEmail.length > 0 &&
    normalizedPassword.length > 0 &&
    doesPasswordMeetAllChecks &&
    doPasswordsMatch &&
    normalizedFullName.length > 0 &&
    normalizedBusinessName.length > 0 &&
    normalizedPhone.length > 0 &&
    normalizedCountry.length > 0 &&
    normalizedTown.length > 0 &&
    (signupRole === 'team-member' ? normalizedStoreId.length > 0 : true)

  const isLoginFormValid = EMAIL_PATTERN.test(normalizedEmail) && normalizedPassword.length > 0
  const isSubmitDisabled = isLoading || (mode === 'login' ? !isLoginFormValid : !isSignupFormValid)

  useEffect(() => {
    document.title = mode === 'login' ? 'Sedifex — Log in' : 'Sedifex — Sign up'
  }, [mode])

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

    const validationError = mode === 'login' ? getLoginValidationError(sanitizedEmail, sanitizedPassword) : null

    if (mode === 'signup') {
      setPhone(sanitizedPhone)
      setNormalizedPhone(sanitizedPhone)
      setFullName(sanitizedFullName)
      setBusinessName(sanitizedBusinessName)
      setCountry(sanitizedCountry)
      setTown(sanitizedTown)
      setSignupRole(sanitizedSignupRole)
      setStoreId(sanitizedStoreId)

      if (!doesPasswordMeetAllChecks) {
        setStatus({
          tone: 'error',
          message:
            'Use a stronger password that is at least 8 characters and includes uppercase, lowercase, number, and symbol.',
        })
        return
      }

      if (sanitizedPassword !== sanitizedConfirmPassword) {
        setStatus({ tone: 'error', message: 'Passwords do not match. Please re-enter them.' })
        return
      }
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
        const { user: nextUser } = await signInWithEmailAndPassword(auth, sanitizedEmail, sanitizedPassword)
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
        const { user: nextUser } = await createUserWithEmailAndPassword(auth, sanitizedEmail, sanitizedPassword)
        await persistSession(nextUser)

        let initializedStoreId: string | undefined
        try {
          const initialization = await initializeStore(
            {
              phone: sanitizedPhone || null,
              firstSignupEmail: sanitizedEmail ? sanitizedEmail.toLowerCase() : null,
              ownerName: sanitizedFullName || null,
              businessName: sanitizedBusinessName || null,
              country: sanitizedCountry || null,
              town: sanitizedTown || null,
              signupRole: sanitizedSignupRole,
            },
            sanitizedSignupRole === 'team-member' ? sanitizedStoreId : null,
          )
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
          const preferredDisplayName = sanitizedFullName || nextUser.displayName?.trim() || sanitizedEmail
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
        message: mode === 'login' ? 'Welcome back! Redirecting…' : 'Account created! You can now sign in.',
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
                  publish({ tone: 'success', message: `Paystack test payment complete. Ref: ${r.reference}` })
                } else {
                  publish({ tone: 'error', message: 'Paystack test payment failed.' })
                }
              }}
              disabled={isLoading}
            >
              Test Paystack
            </button>
          </div>

          <div className="app__mode-toggle" role="tablist" aria-label="Authentication mode">
            <button
              className={`app__mode-button${mode === 'login' ? ' is-active' : ''}`}
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => handleModeChange('login')}
              type="button"
              disabled={isLoading}
            >
              Log in
            </button>
            <button
              className={`app__mode-button${mode === 'signup' ? ' is-active' : ''}`}
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => handleModeChange('signup')}
              type="button"
              disabled={isLoading}
            >
              Create account
            </button>
          </div>

          <form className="form" onSubmit={handleSubmit} aria-label={mode === 'login' ? 'Log in form' : 'Sign up form'}>
            <div className="form__field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                onBlur={() => setEmail(current => current.trim())}
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
                disabled={isLoading}
              />
              <p className="form__hint">Enter the email you use for work.</p>
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
                  placeholder="Ada Lovelace"
                  required
                  disabled={isLoading}
                  aria-invalid={fullName.length > 0 && normalizedFullName.length === 0}
                  aria-describedby="full-name-hint"
                />
                <p className="form__hint" id="full-name-hint">
                  We use this to personalize your workspace and onboarding tips.
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
                  placeholder="Sedifex Retail"
                  required
                  disabled={isLoading}
                  aria-invalid={businessName.length > 0 && normalizedBusinessName.length === 0}
                  aria-describedby="business-name-hint"
                />
                <p className="form__hint" id="business-name-hint">
                  Appears on invoices, receipts, and workspace communications.
                </p>
              </div>
            )}

            {mode === 'signup' && (
              <div className="form__field">
                <label htmlFor="phone">Phone number</label>
                <input
                  id="phone"
                  value={phone}
                  onChange={event => setPhone(event.target.value)}
                  onBlur={() => setPhone(current => sanitizePhone(current))}
                  type="tel"
                  autoComplete="tel"
                  placeholder="233 20 123 4567"
                  required
                  disabled={isLoading}
                  aria-invalid={phone.length > 0 && normalizedPhone.length === 0}
                  aria-describedby="phone-hint"
                />
                <p className="form__hint" id="phone-hint">
                  Use a number where we can reach you for onboarding support.
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

const PAGE_FEATURES = [
  {
    path: '/products',
    name: 'Products',
    description: 'Spot low inventory, sync counts, and keep every SKU accurate across locations.',
  },
  {
    path: '/sell',
    name: 'Sell',
    description: 'Ring up sales with guided workflows that keep the floor moving and customers happy.',
  },
  {
    path: '/receive',
    name: 'Receive',
    description: 'Check in purchase orders, reconcile deliveries, and put new stock to work immediately.',
  },
  {
    path: '/customers',
    name: 'Customers',
    description: 'Understand top shoppers, loyalty trends, and service follow-ups without exporting data.',
  },
  {
    path: '/close-day',
    name: 'Close Day',
    description: 'Tie out cash, settle registers, and share end-of-day reports with finance in one view.',
  },
] as const

async function cleanupFailedSignup(_user: User) {
  try {
    await auth.signOut()
  } catch (error) {
    console.warn('[signup] Unable to sign out after rejected signup', error)
  }
}
