import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Outlet } from 'react-router-dom'
import './pwa'
import { useToast } from './components/ToastProvider'
import { configureAuthPersistence, persistSession, refreshSessionHeartbeat } from './controllers/sessionController'
import { AuthUserContext } from './hooks/useAuthUser'
import { clearActiveStoreIdForUser, clearLegacyActiveStoreId } from './utils/activeStoreStorage'
import { supabase, type Session } from './supabaseClient'
import AuthScreen from './pages/AuthScreen'

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
  const [session, setSession] = useState<Session | null>(null)
  const previousUidRef = useRef<string | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false) // NEW
  const { publish } = useToast()

  useEffect(() => {
    configureAuthPersistence(supabase).catch(() => {})
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const previousUid = previousUidRef.current
      const nextUid = nextSession?.user?.id ?? null

      if (!nextUid) {
        if (previousUid) {
          clearActiveStoreIdForUser(previousUid)
        }
        clearLegacyActiveStoreId()
      } else if (previousUid && previousUid !== nextUid) {
        clearActiveStoreIdForUser(previousUid)
      }

      previousUidRef.current = nextUid
      setSession(nextSession ?? null)
      setIsAuthReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    refreshSessionHeartbeat(session).catch(() => {})
  }, [session])

  const sessionPersistKey = session
    ? `${session.user?.id ?? 'anon'}:${session.access_token ?? 'anon'}`
    : null

  useEffect(() => {
    if (!session || !sessionPersistKey) return
    persistSession(session).catch(() => {})
  }, [session, sessionPersistKey])

  // ---------- NEW: ensure the user has a workspace (company + membership) ----------
  useEffect(() => {
    if (!session?.user) return
    setIsWorkspaceReady(false)
    ;(async () => {
      // Do I belong to any company?
      const { data: companies, error } = await supabase
        .from('companies')
        .select('id')
        .limit(1)

      if (error) {
        console.error(error)
        publish({ message: 'Could not load workspace.', tone: 'error' })
        setIsWorkspaceReady(true)
        return
      }

      if (!companies || companies.length === 0) {
        // Create default workspace and membership as owner
        const { data: company, error: cErr } = await supabase
          .from('companies')
          .insert([{ name: 'My Workspace' }])
          .select()
          .single()

        if (!cErr && company?.id) {
          await supabase.from('memberships').insert([{
            user_id: session.user.id,
            company_id: company.id,
            role: 'owner'
          }])
          publish({ message: 'Workspace created.', tone: 'success' })
        } else if (cErr) {
          console.error(cErr)
          publish({ message: 'Could not create workspace.', tone: 'error' })
        }
      }

      setIsWorkspaceReady(true)
    })().catch(() => setIsWorkspaceReady(true))
  }, [session, publish])
  // -------------------------------------------------------------------------------

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

  if (!session) {
    return (
      <AuthUserContext.Provider value={null}>
        <AuthScreen />
      </AuthUserContext.Provider>
    )
  }

  if (!isWorkspaceReady) {
    return (
      <main style={loadingStyle}>
        <p>Preparing your workspace…</p>
      </main>
    )
  }

  return (
    <AuthUserContext.Provider value={session.user ?? null}>
      <Outlet />
    </AuthUserContext.Provider>
  )
}
