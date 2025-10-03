// web/src/hooks/useMemberships.ts
import { useEffect, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { querySupabase } from '../supabaseClient'
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

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseTimestamp(value: unknown): Timestamp | null {
  if (typeof value !== 'string') {
    return null
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }

  return Timestamp.fromMillis(parsed)
}

type SupabaseMembershipRow = {
  id: string
  uid: string | null
  email: string | null
  role: string | null
  store_id: string | null
  phone: string | null
  invited_by: string | null
  first_signup_email: string | null
  created_at: string | null
  updated_at: string | null
}

function mapMembershipRow(row: SupabaseMembershipRow): Membership {
  const id = normalizeString(row.id) ?? row.id.trim()
  const uid = normalizeString(row.uid) ?? id
  const storeId = normalizeString(row.store_id)

  return {
    id,
    uid,
    role: normalizeRole(row.role),
    storeId,
    email: normalizeString(row.email),
    phone: normalizeString(row.phone),
    invitedBy: normalizeString(row.invited_by),
    firstSignupEmail: normalizeString(row.first_signup_email),
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  }
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
        const normalizedStoreId =
          typeof activeStoreId === 'string' && activeStoreId.trim() !== ''
            ? activeStoreId.trim()
            : null

        const params = new URLSearchParams()
        params.set(
          'select',
          [
            'id',
            'uid',
            'email',
            'role',
            'store_id',
            'phone',
            'invited_by',
            'first_signup_email',
            'created_at',
            'updated_at',
          ].join(','),
        )
        params.set('uid', `eq.${user.uid}`)
        params.append('order', 'updated_at.desc')

        if (normalizedStoreId) {
          params.set('store_id', `eq.${normalizedStoreId}`)
        }

        const rows = await querySupabase<SupabaseMembershipRow>('team_memberships_view', params)

        if (cancelled) return

        const membershipsById = new Map<string, Membership>()
        for (const row of rows) {
          const membership = mapMembershipRow(row)
          membershipsById.set(membership.id, membership)
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
