import { useEffect, useState } from 'react'
import {
  Timestamp,
  collection,
  getDocs,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuthUser } from './useAuthUser'
import { getStoreIdFromRecord } from '../utils/storeId'

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
  const storeId = getStoreIdFromRecord(data)

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

export function useMemberships(_activeStoreId?: string | null) {
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
        // ✅ Use default Firestore DB
        const membersRef = collection(db, 'teamMembers')
        const membershipsQuery = query(membersRef, where('uid', '==', user.uid))
        const snapshot = await getDocs(membershipsQuery)

        if (cancelled) return

        const rows = snapshot.docs.map(mapMembershipSnapshot)
        const storeMap = new Map<string, Membership>()
        const legacyMap = new Map<string, Membership>()
        const withoutStore: Membership[] = []

        for (const row of rows) {
          if (!row.storeId) {
            withoutStore.push(row)
            continue
          }

          if (row.id === row.uid) {
            if (!legacyMap.has(row.storeId)) {
              legacyMap.set(row.storeId, row)
            }
            continue
          }

          storeMap.set(row.storeId, row)
        }

        const merged = [...storeMap.values()]

        for (const [storeId, legacyMember] of legacyMap.entries()) {
          if (!storeMap.has(storeId)) {
            merged.push(legacyMember)
          }
        }

        setMemberships([...merged, ...withoutStore])
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
