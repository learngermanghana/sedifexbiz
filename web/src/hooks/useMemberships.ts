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
} from 'firebase/firestore'
import { db } from '../firebase'
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

function mapMembershipSnapshot(snapshot: DocumentSnapshot<DocumentData>): Membership {
  const data = snapshot.data() ?? {}

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
        const membersRef = collection(db, 'teamMembers')
        const results = new Map<string, Membership>()
        let hasStoreId = false

        const addMembership = (snapshot: DocumentSnapshot<DocumentData>) => {
          if (!snapshot.exists()) return

          const membership = mapMembershipSnapshot(snapshot)
          if (membership.storeId) {
            hasStoreId = true
          }
          results.set(membership.id, membership)
        }

        const uidDocRef = doc(db, 'teamMembers', user.uid)
        const uidDocSnapshot = await getDoc(uidDocRef)
        addMembership(uidDocSnapshot)

        const membershipsQuery = query(membersRef, where('uid', '==', user.uid))
        const uidMatches = await getDocs(membershipsQuery)
        uidMatches.docs.forEach(addMembership)

        if (!hasStoreId) {
          const email = typeof user.email === 'string' ? user.email.trim() : ''
          if (email) {
            const emailQuery = query(membersRef, where('email', '==', email))
            const emailMatches = await getDocs(emailQuery)
            emailMatches.docs.forEach(addMembership)
          }
        }

        if (cancelled) return

        const rows = Array.from(results.values())
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
  }, [user?.uid, user?.email])

  return { loading, memberships, error }
}
