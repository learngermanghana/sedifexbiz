import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import './pwa'
import { useToast } from './components/ToastProvider'
import { configureAuthPersistence, refreshSessionHeartbeat } from './controllers/sessionController'
import { AuthUserContext } from './hooks/useAuthUser'
import { clearActiveStoreIdForUser, clearLegacyActiveStoreId } from './utils/activeStoreStorage'
import { getOnboardingStatus } from './utils/onboarding'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type QueueCompletedMessage = { type: 'QUEUE_REQUEST_COMPLETED'; requestType?: unknown }
type QueueFailedMessage = { type: 'QUEUE_REQUEST_FAILED'; requestType?: unknown; error?: unknown }

function isQueueCompletedMessage(value: unknown): value is QueueCompletedMessage {
  return isRecord(value) && (value as QueueCompletedMessage).type === 'QUEUE_REQUEST_COMPLETED'
}

function isQueueFailedMessage(value: unknown): value is QueueFailedMessage {
  return isRecord(value) && (value as QueueFailedMessage).type === 'QUEUE_REQUEST_FAILED'
}

function getQueueRequestLabel(requestType: unknown): string {
  return requestType === 'receipt' ? 'stock receipt' : 'sale'
}

function normalizeQueueError(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  if (value instanceof Error) {
    const message = value.message.trim()
    if (message) return message
  }
  return null
}

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
  const { publish } = useToast()
  const navigate = useNavigate()
  const location = useLocation()

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

  useEffect(() => {
    if (!user) return
    const status = getOnboardingStatus(user.uid)
    if (status === 'pending' && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true })
    }
  }, [location.pathname, navigate, user])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handleMessage = (event: MessageEvent) => {
      const data = event.data
      if (isQueueCompletedMessage(data)) {
        const label = getQueueRequestLabel((data as QueueCompletedMessage).requestType)
        publish({ message: `Queued ${label} synced successfully.`, tone: 'success' })
        return
      }
      if (isQueueFailedMessage(data)) {
        const label = getQueueRequestLabel((data as QueueFailedMessage).requestType)
        const detail = normalizeQueueError((data as QueueFailedMessage).error)
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
