import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from './firebase'
import { callSupabaseRpc } from './supabaseClient'
import { clearActiveStoreIdForUser, persistActiveStoreIdForUser } from './utils/activeStoreStorage'

type TeamMemberSnapshot = {
  storeId: string | null
  status: string | null
  contractStatus: string | null
}

const BLOCKED_STATUSES = new Set([
  'inactive',
  'disabled',
  'suspended',
  'terminated',
  'cancelled',
  'canceled',
  'expired',
])

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
}

const MEMBERSHIP_RETRY_ATTEMPTS = 3
const MEMBERSHIP_RETRY_DELAY_MS = 1000

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type ActiveTeamMemberSnapshot = TeamMemberSnapshot & { storeId: string }

async function loadActiveTeamMemberWithRetries(user: User): Promise<ActiveTeamMemberSnapshot> {
  let lastSnapshot: TeamMemberSnapshot | null = null

  for (let attempt = 0; attempt < MEMBERSHIP_RETRY_ATTEMPTS; attempt++) {
    const snapshot = await loadTeamMember(user)
    lastSnapshot = snapshot

    if (snapshot.storeId && isWorkspaceActive(snapshot)) {
      return { ...snapshot, storeId: snapshot.storeId }
    }

    if (attempt < MEMBERSHIP_RETRY_ATTEMPTS - 1) {
      await delay(MEMBERSHIP_RETRY_DELAY_MS)
    }
  }

  if (!lastSnapshot || !lastSnapshot.storeId) {
    throw new Error('We could not find a workspace assignment for this account.')
  }

  if (!isWorkspaceActive(lastSnapshot)) {
    throw new Error('Your Sedifex workspace contract is not active.')
  }

  throw new Error('Access denied.')
}

type SupabaseActiveMembership = {
  member_id: string | null
  store_id: string | null
  status: string | null
  contract_status: string | null
}

async function loadTeamMember(user: User): Promise<TeamMemberSnapshot> {
  const email = normalizeString(user.email)

  const data = await callSupabaseRpc<SupabaseActiveMembership>('get_active_team_membership', {
    p_uid: user.uid,
    p_email: email,
  })

  if (!data) {
    return { storeId: null, status: null, contractStatus: null }
  }

  return {
    storeId: normalizeString(data.store_id),
    status: normalizeString(data.status),
    contractStatus: normalizeString(data.contract_status),
  }
}

function isWorkspaceActive({ status, contractStatus }: TeamMemberSnapshot): boolean {
  const candidates = [status, contractStatus]
    .map(value => normalizeString(value ?? undefined))
    .filter((value): value is string => Boolean(value))

  if (candidates.length === 0) {
    return true
  }

  return candidates.every(value => !BLOCKED_STATUSES.has(value.toLowerCase()))
}

export default function SheetAccessGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    let currentRequest = 0

    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      currentRequest += 1
      const requestId = currentRequest

      const run = async () => {
        if (!user) {
          if (!isMounted || requestId !== currentRequest) {
            return
          }
          setError(null)
          setReady(true)
          return
        }

        if (!isMounted || requestId !== currentRequest) {
          return
        }

        setReady(false)
        setError(null)

        try {
          const member = await loadActiveTeamMemberWithRetries(user)
          if (!isMounted || requestId !== currentRequest) {
            return
          }

          persistActiveStoreIdForUser(user.uid, member.storeId)
          setError(null)
        } catch (e: unknown) {
          if (!isMounted || requestId !== currentRequest) {
            return
          }

          const message = e instanceof Error ? e.message : 'Access denied.'
          setError(message)
          await signOut(auth)
          clearActiveStoreIdForUser(user.uid)
        } finally {
          if (isMounted && requestId === currentRequest) {
            setReady(true)
          }
        }
      }

      void run()
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  if (!ready) return <p>Checking workspace access…</p>
  return (
    <>
      {error ? <div role="alert">{error}</div> : null}
      {children}
    </>
  )
}
