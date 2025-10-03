import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { Outlet } from 'react-router-dom'
import { auth } from './firebase'
import './pwa'
import { configureAuthPersistence, refreshSessionHeartbeat } from './controllers/sessionController'
import { AuthUserContext } from './hooks/useAuthUser'
import { clearActiveStoreIdForUser, clearLegacyActiveStoreId } from './utils/activeStoreStorage'

const loadingStyle: CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const previousUidRef = useRef<string | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)

  useEffect(() => {
    configureAuthPersistence(auth).catch(() => {})
    const unsubscribe = onAuthStateChanged(auth, nextUser => {
      const previousUid = previousUidRef.current

      if (!nextUser) {
        if (previousUid) {
          clearActiveStoreIdForUser(previousUid)
        }
        clearLegacyActiveStoreId()
      } else if (previousUid && previousUid !== nextUser.uid) {
        clearActiveStoreIdForUser(previousUid)
      }

      previousUidRef.current = nextUser?.uid ?? null
      setUser(nextUser)
      setIsAuthReady(true)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user) return
    refreshSessionHeartbeat(user).catch(() => {})
  }, [user])

  if (!isAuthReady) {
    return (
      <main style={loadingStyle}>
        <p>Checking your session…</p>
      </main>
    )
  }

  return (
    <AuthUserContext.Provider value={user}>
      <Outlet />
    </AuthUserContext.Provider>
  )
}
