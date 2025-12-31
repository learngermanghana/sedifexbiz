import React, { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
} from 'firebase/auth'
import {
  doc,
  serverTimestamp,
  setDoc,
  collection,
  query,
  onSnapshot,
  limit,
} from 'firebase/firestore'
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
import { auth, db } from '../firebase'
import { setOnboardingStatus } from '../utils/onboarding'

const LOGI_PARTNER_IMAGE_URL =
  'https://raw.githubusercontent.com/learngermanghana/sedifexbiz/main/photos/pexels-omotayo-tajudeen-1650120-3213283%281%29.jpg'
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

interface PartnerStoreSnippet {
  id: string
  name: string
  town: string | null
  country: string | null
}

function sanitizePhone(value: string): string {
  return value.replace(/\D+/g, '')
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
      case 'auth/invalid-login-credentials':
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.'
      case 'auth/user-disabled':
        return 'This account has been disabled. Please contact support to restore access.'
      case 'auth/invalid-email':
        return 'Enter a valid email address.'
      case 'auth/missing-email':
        return 'Enter your email to continue.'
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.'
      case 'auth/network-request-failed':
        return 'Network error. Please check your connection and try again.'
      case 'auth/email-already-in-use':
        return 'An account already exists with this email.'
      case 'auth/operation-not-allowed':
        return 'Email and password sign-in is currently unavailable. Please contact support.'
      case 'auth/missing-password':
        return 'Enter your password to continue.'
      case 'auth/weak-password':
        return 'Please choose a stronger password. It must be at least 8 characters and include uppercase, lowercase, number, and symbol.'
      case 'functions/permission-denied': {
        const callableMessage =
          extractCallableErrorMessage(error) ?? INACTIVE_WORKSPACE_MESSAGE
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

function getAuthErrorMessage(error: unknown, mode: AuthMode): string {
  const baseMessage = getErrorMessage(error)
  const firebaseCode = error instanceof FirebaseError ? error.code : undefined

  const contextualMessage = (() => {
    if (mode === 'signup' && baseMessage === 'An account already exists with this email.') {
      return 'An account already exists with this email. Try logging in instead or use another email to sign up.'
    }

    if (
      mode === 'login' &&
      (firebaseCode === 'auth/invalid-credential' ||
        firebaseCode === 'auth/invalid-login-credentials' ||
        firebaseCode === 'auth/wrong-password' ||
        firebaseCode === 'auth/user-not-found')
    ) {
      return 'Incorrect email or password. If you have forgotten your password, please reset it and try again.'
    }

    return baseMessage
  })()

  if (contextualMessage && contextualMessage !== 'Something went wrong. Please try again.') {
    return contextualMessage
  }

  return mode === 'login'
    ? 'We couldn’t sign you in. Confirm your email and password, check your internet connection, or reset your password if you cannot remember it.'
    : 'We couldn’t create your account. Ensure all details are filled in, your network is stable, and try again. If the issue persists, please contact support.'
}

function formatTrialReminder(
  billing: ResolveStoreAccessResult['billing'],
): string | null {
  if (!billing) return null
  if (billing.status !== 'trial') return null
  if (billing.paymentStatus === 'active') return null

  const days = billing.trialDaysRemaining
  if (typeof days === 'number') {
    if (days <= 0) {
      return 'Your free trial has ended. Please upgrade to continue.'
    }
    const unit = days === 1 ? 'day' : 'days'
    return `You’re on a free trial — ${days} ${unit} left.`
  }

  return null
}

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('')
  const [town, setTown] = useState('')
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<StatusState>({ tone: 'idle', message: '' })

  // random partner stores for the marketing section
  const [partnerStores, setPartnerStores] = useState<PartnerStoreSnippet[]>([])

  const isLoading = status.tone === 'loading'
  const { publish } = useToast()

  const normalizedEmail = email.trim()
  const normalizedPassword = password.trim()
  const normalizedConfirmPassword = confirmPassword.trim()
  const normalizedFullName = fullName.trim()
  const normalizedBusinessName = businessName.trim()
  const normalizedPhone = sanitizePhone(phone)
  const normalizedCountry = country.trim()
  const normalizedTown = town.trim()
  const normalizedAddress = address.trim()

  const passwordStrength = evaluatePasswordStrength(normalizedPassword)
  const passwordChecklist = useMemo(
    () => [
      {
        id: 'length',
        label: `At least ${PASSWORD_MIN_LENGTH} characters`,
        passed: passwordStrength.isLongEnough,
      },
      {
        id: 'uppercase',
        label: 'Includes an uppercase letter',
        passed: passwordStrength.hasUppercase,
      },
      {
        id: 'lowercase',
        label: 'Includes a lowercase letter',
        passed: passwordStrength.hasLowercase,
      },
      { id: 'number', label: 'Includes a number', passed: passwordStrength.hasNumber },
      { id: 'symbol', label: 'Includes a symbol', passed: passwordStrength.hasSymbol },
    ] as const,
    [
      passwordStrength.hasLowercase,
      passwordStrength.hasNumber,
      passwordStrength.hasSymbol,
      passwordStrength.hasUppercase,
      passwordStrength.isLongEnough,
    ],
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
    normalizedAddress.length > 0

  const isLoginFormValid =
    EMAIL_PATTERN.test(normalizedEmail) && normalizedPassword.length > 0
  const isSubmitDisabled =
    isLoading || (mode === 'login' ? !isLoginFormValid : !isSignupFormValid)

  useEffect(() => {
    document.title = mode === 'login' ? 'Sedifex — Log in' : 'Sedifex — Sign up'
  }, [mode])

  useEffect(() => {
    if (!status.message) return
    if (status.tone === 'success' || status.tone === 'error') {
      publish({ tone: status.tone, message: status.message })
    }
  }, [publish, status.message, status.tone])

  // 🔹 Load a handful of stores and pick some at random for the partners section
  useEffect(() => {
    const q = query(collection(db, 'stores'), limit(30))

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const all: PartnerStoreSnippet[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data() as any
          const name =
            (data.businessName as string) ||
            (data.name as string) ||
            'Unnamed store'
          const town =
            (typeof data.town === 'string' && data.town) ||
            (typeof data.city === 'string' && data.city) ||
            null
          const country =
            (typeof data.country === 'string' && data.country) || null

          return {
            id: docSnap.id,
            name,
            town,
            country,
          }
        })

        if (!all.length) {
          setPartnerStores([])
          return
        }

        // simple client-side shuffle & pick 4
        const shuffled = [...all].sort(() => Math.random() - 0.5)
        setPartnerStores(shuffled.slice(0, 4))
      },
      error => {
        console.warn('[auth] Failed to load partner stores', error)
        setPartnerStores([])
      },
    )

    return unsubscribe
  }, [])

  function handleModeChange(nextMode: AuthMode) {
    setMode(nextMode)
    setStatus({ tone: 'idle', message: '' })
    setConfirmPassword('')
    setFullName('')
    setBusinessName('')
    setPhone('')
    setCountry('')
    setTown('')
    setAddress('')
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
    const sanitizedAddress = address.trim()

    const validationError =
      mode === 'login'
        ? getLoginValidationError(sanitizedEmail, sanitizedPassword)
        : null

    if (mode === 'signup') {
      setPhone(sanitizedPhone)
      setFullName(sanitizedFullName)
      setBusinessName(sanitizedBusinessName)
      setCountry(sanitizedCountry)
      setTown(sanitizedTown)
      setAddress(sanitizedAddress)

      if (!doesPasswordMeetAllChecks) {
        setStatus({
          tone: 'error',
          message:
            'Use a stronger password that is at least 8 characters and includes uppercase, lowercase, number, and symbol.',
        })
        return
      }

      if (sanitizedPassword !== sanitizedConfirmPassword) {
        setStatus({
          tone: 'error',
          message: 'Passwords do not match. Please re-enter them.',
        })
        return
      }
    }

    if (validationError) {
      setStatus({ tone: 'error', message: validationError })
      return
    }

    setStatus({
      tone: 'loading',
      message: mode === 'login' ? 'Signing you in…' : 'Creating your account…',
    })

    try {
      if (mode === 'login') {
        // ---------- LOGIN FLOW ----------
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
          const reminder = formatTrialReminder(resolution.billing)
          if (reminder) {
            publish({ tone: 'info', message: reminder })
          }
        } catch (error) {
          console.warn('[auth] Failed to resolve workspace access', error)
          setStatus({ tone: 'error', message: getAuthErrorMessage(error, 'login') })
          return
        }
      } else {
        // ---------- SIGNUP FLOW ----------
        const { user: nextUser } = await createUserWithEmailAndPassword(
          auth,
          sanitizedEmail,
          sanitizedPassword,
        )
        await persistSession(nextUser)

        let initializedStoreId: string | undefined
        const signupRoleForWorkspace: SignupRoleOption = 'owner'

        // 1) Initialize workspace (always a new store now)
        try {
          const initialization = await initializeStore(
            {
              phone: sanitizedPhone || null,
              firstSignupEmail: sanitizedEmail ? sanitizedEmail.toLowerCase() : null,
              ownerName: sanitizedFullName || null,
              businessName: sanitizedBusinessName || null,
              country: sanitizedCountry || null,
              town: sanitizedTown || null,
              address: sanitizedAddress || null,
              signupRole: signupRoleForWorkspace,
            },
            null,
          )
          initializedStoreId = initialization.storeId
        } catch (error) {
          console.warn('[signup] Failed to initialize workspace', error)
          setStatus({ tone: 'error', message: getAuthErrorMessage(error, 'signup') })
          await cleanupFailedSignup(nextUser)
          return
        }

        // 2) Resolve access (gets final storeId + role)
        let resolution: ResolveStoreAccessResult
        try {
          resolution = await resolveStoreAccess(initializedStoreId)
        } catch (error) {
          console.warn('[signup] Failed to resolve workspace access', error)
          setStatus({ tone: 'error', message: getAuthErrorMessage(error, 'signup') })
          await cleanupFailedSignup(nextUser)
          return
        }

        await persistSession(nextUser, {
          storeId: resolution.storeId,
          workspaceSlug: resolution.workspaceSlug,
          role: resolution.role,
        })
        const reminder = formatTrialReminder(resolution.billing)
        if (reminder) {
          publish({ tone: 'info', message: reminder })
        }

        // 3) Upsert customer profile – always owner for self-signup
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
              address: sanitizedAddress || null,
              status: 'active',
              role: 'owner',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          )
        } catch (error) {
          console.warn('[customers] Unable to upsert customer record', error)
        }

        // 4) Refresh ID token for fresh custom claims
        try {
          await nextUser.getIdToken(true)
        } catch (error) {
          console.warn('[auth] Unable to refresh ID token after signup', error)
        }

        // 5) Send email verification
        try {
          const continueUrl = `${window.location.origin}/verify-email`
          await sendEmailVerification(nextUser, {
            url: continueUrl,
            handleCodeInApp: true,
          })
        } catch (error) {
          console.warn('[auth] Failed to send verification email', error)
        }

        // 6) Mark onboarding as pending and bounce to login
        setOnboardingStatus(nextUser.uid, 'pending')
        setMode('login')
      }

      setStatus({
        tone: 'success',
        message:
          mode === 'login'
            ? 'Welcome back! Redirecting…'
            : 'Account created! We’ve emailed you a verification link — please confirm your email, then sign in.',
      })
      setPassword('')
      setConfirmPassword('')
      setFullName('')
      setBusinessName('')
      setPhone('')
      setCountry('')
      setTown('')
      setAddress('')
    } catch (err: unknown) {
      setStatus({ tone: 'error', message: getAuthErrorMessage(err, mode) })
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
              <p className="app__trial-note">
                Start with a free 14-day trial—no payment required until you’re ready.
              </p>
            </div>
          </div>

          <div
            className="app__mode-toggle"
            role="tablist"
            aria-label="Authentication mode"
          >
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
              Start free trial
            </button>
          </div>

          <form
            className="form"
            onSubmit={handleSubmit}
            aria-label={mode === 'login' ? 'Log in form' : 'Sign up form'}
          >
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
              <p className="form__hint">
                {mode === 'signup'
                  ? 'We’ll send a verification link to this address.'
                  : 'Enter the email you use for work.'}
              </p>
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
                  aria-invalid={
                    businessName.length > 0 && normalizedBusinessName.length === 0
                  }
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
                  placeholder="254 712 345 678"
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
                  placeholder="Kenya or Ghana"
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
                  placeholder="Nairobi"
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
              <div className="form__field">
                <label htmlFor="address">Business address</label>
                <textarea
                  id="address"
                  value={address}
                  onChange={event => setAddress(event.target.value)}
                  onBlur={() => setAddress(current => current.trim())}
                  autoComplete="street-address"
                  placeholder="123 Market Street, Suite 5"
                  required
                  disabled={isLoading}
                  aria-invalid={address.length > 0 && normalizedAddress.length === 0}
                  aria-describedby="address-hint"
                  rows={3}
                />
                <p className="form__hint" id="address-hint">
                  Helps us set up invoices and receipts with your mailing details.
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
                aria-invalid={
                  mode === 'signup' &&
                  normalizedPassword.length > 0 &&
                  !doesPasswordMeetAllChecks
                }
                aria-describedby={mode === 'signup' ? 'password-guidelines' : undefined}
              />
              {mode === 'signup' && (
                <ul className="form__hint-list" id="password-guidelines">
                  {passwordChecklist.map(item => (
                    <li key={item.id} data-complete={item.passed}>
                      <span
                        className={`form__hint-indicator${
                          item.passed ? ' is-valid' : ''
                        }`}
                      >
                        {item.passed ? '✓' : '•'}
                      </span>
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
              {mode === 'login' && (
                <p className="form__hint">
                  Forgot your password?{' '}
                  <Link to="/reset-password" className="form__link">
                    Reset it.
                  </Link>
                </p>
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
                  aria-invalid={
                    normalizedConfirmPassword.length > 0 &&
                    normalizedPassword !== normalizedConfirmPassword
                  }
                  aria-describedby="confirm-password-hint"
                />
                <p className="form__hint" id="confirm-password-hint">
                  Must match the password exactly.
                </p>
              </div>
            )}

            {mode === 'signup' && (
              <p className="form__hint" style={{ marginTop: 8 }}>
                Summary: You are creating a new store and will be the owner of this
                workspace.
              </p>
            )}

            <button className="primary-button" type="submit" disabled={isSubmitDisabled}>
              {isLoading
                ? mode === 'login'
                  ? 'Signing in…'
                  : 'Starting free trial…'
                : mode === 'login'
                  ? 'Log in'
                  : 'Start free trial'}
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

        <aside
          className="app__visual"
          aria-label="Watch the Sedifex walkthrough before signing in"
        >
          <div className="app__visual-media" role="presentation">
            <iframe
              src="https://www.youtube.com/embed/Jgyfz1CT2YY"
              title="Sedifex tutorial video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="app__visual-overlay" />
          <div className="app__visual-caption">
            <span className="app__visual-pill">Quick tutorial</span>
            <h2>See how our AI inventory system works before logging in</h2>
            <p>
              Watch the short walkthrough to learn how Sedifex uses AI to connect sales,
              inventory, and finance in one workspace built for small businesses. Start
              the video right here before creating an account.
            </p>
          </div>
        </aside>
      </div>

      <section
        className="app__partners"
        aria-label="Stores using Sedifex and sharing snapshots with partners"
      >
        <div className="app__partners-copy">
          <span className="app__pill">Store partners</span>
          <h2>Share your AI-backed store snapshot before partners sign in</h2>
          <p>
            Provide partners with a live, read-only view of non-sensitive store details.
            Your store name, location, and overview refresh automatically after sign
            up—no extra setup required. Our AI keeps inventory details accurate while we
            list your store on stores.sedifex.com automatically for free SEO visibility.
          </p>

          {partnerStores.length > 0 && (
            <div className="app__partners-examples">
              <p className="app__partners-examples-label">
                Example stores currently running on Sedifex:
              </p>
              <ul className="app__partners-list">
                {partnerStores.map(store => (
                  <li key={store.id} className="app__partners-badge">
                    <span className="app__partners-name">{store.name}</span>
                    {(store.town || store.country) && (
                      <span className="app__partners-location">
                        {store.town}
                        {store.town && store.country ? ', ' : ''}
                        {store.country}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link className="app__partners-link" to="/logi">
            Preview the Logi snapshot
          </Link>
        </div>

        <div className="app__partners-visual" aria-hidden="true">
          <img
            src={LOGI_PARTNER_IMAGE_URL}
            alt="Retail partners reviewing a product shelf"
            loading="lazy"
          />
          <div className="app__partners-glow" />
        </div>
      </section>

      <section className="app__features" aria-label="Sedifex workspace pages">
        <header className="app__features-header">
          <h2>Explore the AI workspace</h2>
          <p>
            Every Sedifex page is built to keep retail operations synchronized with
            AI-powered inventory insights—from the sales floor to finance.
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
            Sedifex is the smart AI inventory system for modern small businesses. We unite
            store execution, warehouse visibility, and merchandising insights so every
            location can act on the same live source of truth.
          </p>
          <p>
            Connect your POS, ecommerce, and supplier systems in minutes to orchestrate
            the entire product journey—from forecast to fulfillment—with less manual work,
            fewer stockouts, and smarter AI-driven decisions.
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
            inventory can move. Sedifex exists to give small business operators the AI
            clarity and confidence to do exactly that.
          </p>
          <ul className="info-card__list">
            <li>Deliver every SKU promise with predictive AI inventory intelligence</li>
            <li>Empower teams with guided workflows, not spreadsheets</li>
            <li>Earn shopper loyalty through always-on availability</li>
          </ul>
        </article>

        <article className="info-card">
          <h3>Contact Sales</h3>
          <p>
            Partner with a retail operations strategist to tailor Sedifex to your fleet,
            review pricing, and build an onboarding plan that keeps stores running while
            we launch.
          </p>
          <a
            className="info-card__cta"
            href="https://calendly.com/sedifexbiz"
            target="_blank"
            rel="noreferrer noopener"
          >
            Book a 30-minute consultation
          </a>
          <p className="info-card__caption">
            Prefer email? Reach us at sedifexbiz@gmail.com.
          </p>
        </article>
      </section>
    </main>
  )
}

const PAGE_FEATURES = [
  {
    path: '/products',
    name: 'Items',
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
    path: '/finance',
    name: 'Finance',
    description:
      'Track cash-up, expenses, and profitability with one simple view.',
  },
  {
    path: '/logi',
    name: 'Logi partners',
    description:
      'Share a live public snapshot of your store name, location, and overview with partners.',
  },
] as const

async function cleanupFailedSignup(_user: User) {
  try {
    await auth.signOut()
  } catch (error) {
    console.warn('[signup] Unable to sign out after rejected signup', error)
  }
}
