// web/src/App.tsx
import React, { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { Outlet, useLocation } from 'react-router-dom'
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

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const location = useLocation()

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

  useEffect(() => {
    configureAuthPersistence(auth).catch(error => {
      console.warn('[auth] Unable to configure persistence', error)
    })

    const unsubscribe = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser)
      setIsAuthReady(true)
      if (nextUser) {
        void bootstrapStoreContext()
      }
    })
    return unsubscribe
  }, [])

  useSessionHeartbeat(user)
  useOnboardingRedirect(user)
  useQueueMessageToasts()

  const appStyle: React.CSSProperties = { minHeight: '100dvh' }

  if (!isAuthReady && !isPublicRoute) {
    return (
      <main className="app" style={appStyle}>
        <div className="app__card">
          <p className="form__hint">Checking your session…</p>
        </div>
      </main>
    )
  }

  if (!user && !isPublicRoute) {
    return <AuthPage />
  }

  return (
    <AuthUserContext.Provider value={user}>
      <Outlet />
    </AuthUserContext.Provider>
  )
}
