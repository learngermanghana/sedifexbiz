// web/src/hooks/useMemberships.ts
import { useEffect, useState } from 'react'
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuthUser } from './useAuthUser'
import { OVERRIDE_TEAM_MEMBER_DOC_ID } from '../config/teamMembers'

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

function mapMembershipData(
  id: string,
  rawData: DocumentData | undefined,
): Membership {
  const data = rawData ?? {}

  const createdAt = data.createdAt instanceof Timestamp ? data.createdAt : null
  const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt : null
  const storeId = typeof data.storeId === 'string' && data.storeId.trim() !== '' ? data.storeId : null

  return {
    id,
    uid: typeof data.uid === 'string' && data.uid.trim() ? data.uid : id,
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

function mapMembershipSnapshot(
  snapshot: QueryDocumentSnapshot<DocumentData> | DocumentSnapshot<DocumentData>,
): Membership {
  return mapMembershipData(snapshot.id, snapshot.data())
}

export function useMemberships(activeStoreId?: string | null) {
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

      if (activeStoreId === undefined) {
        if (!cancelled) {
          setLoading(true)
          setError(null)
          setMemberships([])
        }
        return
      }

      if (!cancelled) {
        setLoading(true)
        setError(null)
      }

      try {
        const membersRef = collection(db, 'teamMembers')
        const constraints = [where('uid', '==', user.uid)]
        const normalizedStoreId =
          typeof activeStoreId === 'string' && activeStoreId.trim() !== ''
            ? activeStoreId
            : null

        if (normalizedStoreId) {
          constraints.push(where('storeId', '==', normalizedStoreId))
        }

        const membershipsQuery = query(membersRef, ...constraints)
        const snapshot = await getDocs(membershipsQuery)

        if (cancelled) return

        const membershipsById = new Map<string, Membership>()
        for (const docSnapshot of snapshot.docs) {
          const membership = mapMembershipSnapshot(docSnapshot)
          membershipsById.set(membership.id, membership)
        }

        const fallbackRefs = [doc(db, 'teamMembers', user.uid)]

        if (OVERRIDE_TEAM_MEMBER_DOC_ID) {
          fallbackRefs.push(doc(db, 'teamMembers', OVERRIDE_TEAM_MEMBER_DOC_ID))
        }

        for (const ref of fallbackRefs) {
          try {
            const fallbackSnapshot = await getDoc(ref)
            if (fallbackSnapshot.exists()) {
              const membership = mapMembershipSnapshot(fallbackSnapshot)
              if (membership.storeId) {
                membershipsById.set(membership.id, membership)
              }
            }
          } catch (fallbackError) {
            // Ignore fallback errors to avoid masking the primary query results.
            console.error(fallbackError)
          }
        }

        setMemberships(Array.from(membershipsById.values()))
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
  }, [activeStoreId, user?.uid])

  return { loading, memberships, error }
}
