// web/src/App.tsx
import React, { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { Link, Outlet, useLocation } from 'react-router-dom'
import './App.css'
import './pwa'
import { auth } from './firebase'
import { configureAuthPersistence } from './controllers/sessionController'
import { bootstrapStoreContext } from './controllers/accessController'
import { AuthUserContext } from './hooks/useAuthUser'
import AuthPage from './pages/AuthPage'
import { useOnboardingRedirect } from './hooks/useOnboardingRedirect'
import { useSessionHeartbeat } from './hooks/useSessionHeartbeat'
import { useQueueMessageToasts } from './hooks/useQueueMessageToasts'
import { PwaProvider } from './context/PwaContext'
import { CanonicalLink } from './components/CanonicalLink'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [storeAccessStatus, setStoreAccessStatus] = useState<
    'idle' | 'pending' | 'ready' | 'failed'
  >('idle')
  const [storeAccessError, setStoreAccessError] = useState<string | null>(null)
  const location = useLocation()

  const isPwaApp = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search)
    return urlParams.get('source') === 'pwa'
  }, [])

  const publicPaths = [
    '/reset-password',
    '/verify-email',
    '/billing/verify',
    '/legal/privacy',
    '/legal/cookies',
    '/legal/refund',
    '/privacy',
    '/cookies',
    '/refund',
  ]

  const isPublicRoute = publicPaths.some(path => location.pathname.startsWith(path))
  const isAccountRoute = location.pathname.startsWith('/account')

  useEffect(() => {
    configureAuthPersistence(auth).catch(error => {
      console.warn('[auth] Unable to configure persistence', error)
    })

    const unsubscribe = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser)
      setIsAuthReady(true)

      if (!nextUser) {
        setStoreAccessStatus(previous => (previous === 'failed' ? 'failed' : 'idle'))
        return
      }

      setStoreAccessError(null)
      setStoreAccessStatus('pending')

      const bootstrap = async () => {
        try {
          await bootstrapStoreContext()
          setStoreAccessStatus('ready')
        } catch (error) {
          console.error('Store access resolution failed:', error)
          setStoreAccessStatus('failed')
          const message =
            error instanceof Error && error.message
              ? error.message
              : 'Your Sedifex workspace is unavailable.'
          setStoreAccessError(message)
          localStorage.removeItem('storeId')
          localStorage.removeItem('workspaceSlug')
        }
      }

      void bootstrap()
    })
    return unsubscribe
  }, [])

  useSessionHeartbeat(user)
  useOnboardingRedirect(user)
  useQueueMessageToasts()

  const appStyle: React.CSSProperties = { minHeight: '100dvh' }

  let content: React.ReactNode

  if (!isAuthReady && !isPublicRoute) {
    content = (
      <main className="app" style={appStyle}>
        <div className="app__card">
          <p className="form__hint">Checking your session…</p>
        </div>
      </main>
    )
  } else if (storeAccessStatus === 'pending' && user && !isPublicRoute) {
    content = (
      <main className="app" style={appStyle}>
        <div className="app__card">
          <p className="form__hint">Preparing your workspace…</p>
        </div>
      </main>
    )
  } else if (storeAccessStatus === 'failed' && !isPublicRoute && !isAccountRoute) {
    content = (
      <main className="app" style={appStyle}>
        <div className="app__card">
          <h1 className="app__heading">Workspace access blocked</h1>
          <p className="form__hint">
            {storeAccessError ??
              'Your Sedifex workspace is unavailable. Please upgrade your plan or contact support to restore access.'}
          </p>
          <p className="form__hint">
            Billing issues can block workspace access. Update your subscription to restore it.
          </p>
          <div className="flex gap-3 mt-4">
            <Link className="button button--primary" to="/account">
              Go to billing
            </Link>
            <a
              className="button button--ghost"
              href="https://paystack.shop/pay/pa5tmww0ml"
              target="_blank"
              rel="noreferrer"
            >
              Pay yearly
            </a>
            <a
              className="button button--ghost"
              href="https://paystack.shop/pay/opd2z7tow6"
              target="_blank"
              rel="noreferrer"
            >
              Pay monthly
            </a>
          </div>
        </div>
      </main>
    )
  } else if (!user && !isPublicRoute) {
    content = <AuthPage />
  } else {
    content = (
      <AuthUserContext.Provider value={user}>
        <Outlet />
      </AuthUserContext.Provider>
    )
  }

  return (
    <PwaProvider isPwaApp={isPwaApp}>
      <CanonicalLink />
      {content}
    </PwaProvider>
  )
}
