import { useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where, rosterDb } from './lib/db'
import { persistActiveStoreIdForUser } from './utils/activeStoreStorage'
import { useAuthUser } from './hooks/useAuthUser'
import type { User } from 'firebase/auth'

type TeamMemberSnapshot = {
  storeId: string | null
  status: string | null
  contractStatus: string | null
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

async function loadActiveTeamMemberWithRetries(user: User): Promise<ActiveTeamMemberSnapshot | null> {
  let lastSnapshot: TeamMemberSnapshot | null = null

  for (let attempt = 0; attempt < MEMBERSHIP_RETRY_ATTEMPTS; attempt++) {
    const snapshot = await loadTeamMember(user)
    lastSnapshot = snapshot

    if (snapshot.storeId) {
      return { ...snapshot, storeId: snapshot.storeId }
    }

    if (attempt < MEMBERSHIP_RETRY_ATTEMPTS - 1) {
      await delay(MEMBERSHIP_RETRY_DELAY_MS)
    }
  }

  if (lastSnapshot?.storeId) {
    return { ...lastSnapshot, storeId: lastSnapshot.storeId }
  }

  return null
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

        if (member?.storeId) {
          persistActiveStoreIdForUser(user.uid, member.storeId)
        }
        setError(null)
      } catch (e: unknown) {
        if (!isMounted || requestId !== requestIdRef.current) {
          return
        }

        const message = e instanceof Error ? e.message : 'Access denied.'
        setError(message)
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
