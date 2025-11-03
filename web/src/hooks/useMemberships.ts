// web/src/hooks/useMemberships.ts
import { useEffect, useState } from 'react'
import {
  Timestamp,
  collection,
  getDocs,
  query,
  rosterDb,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from '../lib/db'
import { useAuthUser } from './useAuthUser'
import { useAutoRerun } from './useAutoRerun'
import { normalizeStaffRole } from '../utils/normalizeStaffRole'
import { auth } from '../firebase'
import { resolveStoreAccess } from '../controllers/accessController'

export type Membership = {
  id: string
  uid: string
  role: 'owner' | 'staff'
  storeId: string | null
  workspaceSlug: string | null
  email: string | null
  phone: string | null
  invitedBy: string | null
  firstSignupEmail: string | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

function mapMembershipSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Membership {
  const data = snapshot.data()

  const createdAt = data.createdAt instanceof Timestamp ? data.createdAt : null
  const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt : null
  const storeId = typeof data.storeId === 'string' && data.storeId.trim() !== '' ? data.storeId : null
  const workspaceSlugCandidate =
    typeof data.workspaceSlug === 'string' && data.workspaceSlug.trim()
      ? data.workspaceSlug.trim()
      : typeof data.slug === 'string' && data.slug.trim()
        ? data.slug.trim()
        : typeof data.workspace === 'string' && data.workspace.trim()
          ? data.workspace.trim()
          : typeof data.storeSlug === 'string' && data.storeSlug.trim()
            ? data.storeSlug.trim()
            : null

  return {
    id: snapshot.id,
    uid: typeof data.uid === 'string' && data.uid.trim() ? data.uid : snapshot.id,
    role: normalizeStaffRole(data.role),
    storeId,
    workspaceSlug: workspaceSlugCandidate,
    email: typeof data.email === 'string' ? data.email : null,
    phone: typeof data.phone === 'string' ? data.phone : null,
    invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : null,
    firstSignupEmail: typeof data.firstSignupEmail === 'string' ? data.firstSignupEmail : null,
    createdAt,
    updatedAt,
  }
}

function getMembershipSortKey(membership: Membership): number {
  try {
    if (membership.createdAt instanceof Timestamp) {
      const millis = membership.createdAt.toMillis()
      if (Number.isFinite(millis)) {
        return millis
      }
    }
  } catch (error) {
    console.warn('[useMemberships] Failed to derive createdAt sort key', error)
  }

  try {
    if (membership.updatedAt instanceof Timestamp) {
      const millis = membership.updatedAt.toMillis()
      if (Number.isFinite(millis)) {
        return millis
      }
    }
  } catch (error) {
    console.warn('[useMemberships] Failed to derive updatedAt sort key', error)
  }

  return 0
}

function compareMemberships(a: Membership, b: Membership): number {
  const aTime = getMembershipSortKey(a)
  const bTime = getMembershipSortKey(b)
  if (aTime !== bTime) {
    return aTime - bTime
  }

  const aLabel = (a.storeId ?? a.workspaceSlug ?? a.id ?? '').toLowerCase()
  const bLabel = (b.storeId ?? b.workspaceSlug ?? b.id ?? '').toLowerCase()
  if (aLabel && bLabel) {
    const comparison = aLabel.localeCompare(bLabel)
    if (comparison !== 0) {
      return comparison
    }
  }

  return a.id.localeCompare(b.id)
}

async function loadMembershipsFromDb(firestore: Firestore, uid: string): Promise<Membership[]> {
  const membersRef = collection(firestore, 'teamMembers')
  const membershipsQuery = query(membersRef, where('uid', '==', uid))
  const snapshot = await getDocs(membershipsQuery)
  return snapshot.docs.map(mapMembershipSnapshot).sort(compareMemberships)
}

async function loadMembershipsForUser(uid: string): Promise<Membership[]> {
  return loadMembershipsFromDb(rosterDb, uid)
}

/**
 * Call once after sign-in to ensure the backend sets role/storeId into custom claims.
 * The shared resolveStoreAccess helper reuses our configured Functions instance and
 * refreshes the ID token so callable functions see the correct role.
 */
export async function refreshMembershipClaims() {
  const user = auth.currentUser
  if (!user) return

  await resolveStoreAccess()
}

/**
 * Optional helper while debugging.
 */
export async function debugClaims() {
  const user = auth.currentUser
  if (!user) {
    // eslint-disable-next-line no-console
    console.log('No user signed in.')
    return
  }
  const token = await user.getIdTokenResult()
  // eslint-disable-next-line no-console
  console.log('claims:', token.claims, 'uid:', user.uid)
}

export function useMemberships() {
  const user = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [error, setError] = useState<unknown>(null)
  const { token: autoRerunToken, trigger: requestAutoRerun } = useAutoRerun(Boolean(user?.uid))

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    async function run() {
      if (!user) {
        if (!cancelled) {
          setMemberships([])
          setError(null)
          setLoading(false)
        }
        return
      }

      if (!cancelled) {
        setLoading(true)
        setError(null)
      }

      try {
        const rows = await loadMembershipsForUser(user.uid)
        if (cancelled) return
        setMemberships(rows)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e)
        setMemberships([])
        if (typeof window !== 'undefined') {
          if (retryTimer) {
            window.clearTimeout(retryTimer)
          }
          retryTimer = window.setTimeout(() => {
            requestAutoRerun()
          }, 10_000)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()

    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [autoRerunToken, requestAutoRerun, user?.uid])

  return { loading, memberships, error }
}
