// web/src/hooks/useMemberships.ts
import { useEffect, useState } from 'react'
import {
  Timestamp,
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuthUser } from './useAuthUser'
import { getAuth } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'

export type Membership = {
  id: string
  uid: string
  role: 'owner' | 'staff'
  storeId: string | null
  email: string | null
  phone: string | null
  invitedBy: string | null
  firstSignupEmail: string | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

function normalizeRole(role: unknown): Membership['role'] {
  return role === 'owner' ? 'owner' : 'staff'
}

function mapMembershipSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Membership {
  const data = snapshot.data()

  const createdAt = data.createdAt instanceof Timestamp ? data.createdAt : null
  const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt : null
  const storeId = typeof data.storeId === 'string' && data.storeId.trim() !== '' ? data.storeId : null

  return {
    id: snapshot.id,
    uid: typeof data.uid === 'string' && data.uid.trim() ? data.uid : snapshot.id,
    role: normalizeRole(data.role),
    storeId,
    email: typeof data.email === 'string' ? data.email : null,
    phone: typeof data.phone === 'string' ? data.phone : null,
    invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : null,
    firstSignupEmail: typeof data.firstSignupEmail === 'string' ? data.firstSignupEmail : null,
    createdAt,
    updatedAt,
  }
}

async function loadMembershipsFromDb(firestore: Firestore, uid: string): Promise<Membership[]> {
  const membersRef = collection(firestore, 'teamMembers')
  const membershipsQuery = query(membersRef, where('uid', '==', uid))
  const snapshot = await getDocs(membershipsQuery)
  return snapshot.docs.map(mapMembershipSnapshot)
}

async function loadMembershipsForUser(uid: string): Promise<Membership[]> {
  return loadMembershipsFromDb(db, uid)
}

/**
 * Call once after sign-in to ensure the backend sets role/storeId into custom claims,
 * then force-refresh the ID token so callable functions see the correct role.
 */
export async function refreshMembershipClaims() {
  const auth = getAuth()
  const user = auth.currentUser
  if (!user) return

  const region = import.meta.env.VITE_FB_FUNCTIONS_REGION || 'us-central1'
  const functions = getFunctions(undefined, region)

  await httpsCallable(functions, 'resolveStoreAccess')()
  await user.getIdToken(true)
}

/**
 * Optional helper while debugging.
 */
export async function debugClaims() {
  const auth = getAuth()
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

  useEffect(() => {
    let cancelled = false

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
        if (!cancelled) {
          setError(e)
          setMemberships([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [user?.uid])

  return { loading, memberships, error }
}
