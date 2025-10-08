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
import { db, rosterDb } from '../firebase'
import { useAuthUser } from './useAuthUser'

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
  if (role === 'owner') return 'owner'
  return 'staff'
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

async function loadMembershipsFromDb(
  firestore: Firestore,
  uid: string,
): Promise<Membership[]> {
  const membersRef = collection(firestore, 'teamMembers')
  const membershipsQuery = query(membersRef, where('uid', '==', uid))
  const snapshot = await getDocs(membershipsQuery)
  return snapshot.docs.map(mapMembershipSnapshot)
}

async function loadMembershipsForUser(uid: string): Promise<Membership[]> {
  let primaryRows: Membership[] | null = null
  let primaryError: unknown = null

  try {
    primaryRows = await loadMembershipsFromDb(db, uid)
    if (primaryRows.length > 0) {
      return primaryRows
    }
  } catch (error) {
    primaryError = error
  }

  try {
    const rosterRows = await loadMembershipsFromDb(rosterDb, uid)
    if (rosterRows.length > 0) {
      return rosterRows
    }

    return primaryRows ?? rosterRows
  } catch (error) {
    if (primaryRows) {
      return primaryRows
    }
    throw primaryError ?? error
  }
}

export function useMemberships() {
  const user = useAuthUser()
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false

    async function loadMemberships() {
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

    loadMemberships()

    return () => {
      cancelled = true
    }
  }, [user?.uid])

  return { loading, memberships, error }
}
