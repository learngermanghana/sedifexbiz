import { useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where, rosterDb } from './lib/db'
import { auth } from './firebase'
import { clearActiveStoreIdForUser, persistActiveStoreIdForUser } from './utils/activeStoreStorage'
import { useAuthUser } from './hooks/useAuthUser'
import type { User } from 'firebase/auth'

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
  'payment_due',
  'payment-due',
  'payment due',
  'past_due',
  'past-due',
  'past due',
  'mismatch',
])

type WorkspaceDenialReason = 'expired' | 'payment_due' | 'mismatch'

function detectWorkspaceDenialReason(snapshot: TeamMemberSnapshot): WorkspaceDenialReason | null {
  const statuses = [snapshot.status, snapshot.contractStatus]
    .map(value => normalizeString(value))
    .filter((value): value is string => Boolean(value))
    .map(value => value.toLowerCase())

  if (statuses.some(status => status.includes('mismatch'))) {
    return 'mismatch'
  }

  if (
    statuses.some(status => {
      if (status.includes('payment') && status.includes('due')) {
        return true
      }
      if (status.includes('past') && status.includes('due')) {
        return true
      }
      return false
    })
  ) {
    return 'payment_due'
  }

  if (statuses.some(status => status.includes('expired') || status.includes('cancel'))) {
    return 'expired'
  }

  return null
}

function formatDenialMessage(reason: WorkspaceDenialReason): string {
  switch (reason) {
    case 'expired':
      return 'Access denied: expired. Your Sedifex workspace subscription has expired. Contact your Sedifex administrator to restore access.'
    case 'payment_due':
      return 'Access denied: payment due. Complete payment with your Sedifex administrator to restore access.'
    case 'mismatch':
      return 'Access denied: mismatch. Your Sedifex account is assigned to a different workspace. Confirm your invitation details with your Sedifex administrator.'
    default:
      return 'Access denied.'
  }
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
}

function snapshotFromData(data: Record<string, unknown> | undefined): TeamMemberSnapshot {
  if (!data) {
    return { storeId: null, status: null, contractStatus: null }
  }

  const storeId = normalizeString(data['storeId'])
  const status = normalizeString(data['status'])
  const contractStatus = normalizeString(data['contractStatus'])

  return { storeId, status, contractStatus }
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
    const reason = detectWorkspaceDenialReason(lastSnapshot)
    if (reason) {
      throw new Error(formatDenialMessage(reason))
    }
    throw new Error('Your Sedifex workspace contract is not active.')
  }

  throw new Error('Access denied.')
}

async function loadTeamMember(user: User): Promise<TeamMemberSnapshot> {
  const uidRef = doc(rosterDb, 'teamMembers', user.uid)
  const uidSnapshot = await getDoc(uidRef)

  if (uidSnapshot.exists()) {
    return snapshotFromData(uidSnapshot.data())
  }

  const email = normalizeString(user.email)
  if (!email) {
    return { storeId: null, status: null, contractStatus: null }
  }

  const membersRef = collection(rosterDb, 'teamMembers')
  const candidates = await getDocs(query(membersRef, where('email', '==', email)))
  const match = candidates.docs[0]
  if (!match) {
    return { storeId: null, status: null, contractStatus: null }
  }

  return snapshotFromData(match.data())
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
  const user = useAuthUser()
  const requestIdRef = useRef(0)

  useEffect(() => {
    let isMounted = true
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    const run = async () => {
      if (!user) {
        if (isMounted && requestId === requestIdRef.current) {
          setError(null)
          setReady(true)
        }
        return
      }

      if (!isMounted || requestId !== requestIdRef.current) {
        return
      }

      setReady(false)
      setError(null)

      try {
        const member = await loadActiveTeamMemberWithRetries(user)
        if (!isMounted || requestId !== requestIdRef.current) {
          return
        }

        persistActiveStoreIdForUser(user.uid, member.storeId)
        setError(null)
      } catch (e: unknown) {
        if (!isMounted || requestId !== requestIdRef.current) {
          return
        }

        const message = e instanceof Error ? e.message : 'Access denied.'
        setError(message)
        await auth.signOut()
        clearActiveStoreIdForUser(user.uid)
      } finally {
        if (isMounted && requestId === requestIdRef.current) {
          setReady(true)
        }
      }
    }

    void run()

    return () => {
      isMounted = false
    }
  }, [user?.uid, user?.email])

  if (!ready) return <p>Checking workspace access…</p>
  return (
    <>
      {error ? <div role="alert">{error}</div> : null}
      {children}
    </>
  )
}
