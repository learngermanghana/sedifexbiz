// web/src/pages/AccountOverview.tsx
import React, { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships } from '../hooks/useMemberships'

type StoreProfile = {
  status: string | null
  billingPlan: string | null
  paymentProvider: string | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

function toNullableString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v : null
}

function isTimestamp(v: unknown): v is Timestamp {
  return typeof v === 'object' && v !== null && typeof (v as Timestamp).toDate === 'function'
}

function mapStore(data: any): StoreProfile {
  return {
    status: toNullableString(data.status ?? data.contractStatus),
    billingPlan: toNullableString(data.billingPlan ?? data.billing?.planId),
    paymentProvider: toNullableString(data.paymentProvider ?? data.billing?.provider),
    createdAt: isTimestamp(data.createdAt) ? data.createdAt : null,
    updatedAt: isTimestamp(data.updatedAt) ? data.updatedAt : null
  }
}

function formatValue(v: string | null) {
  return v ?? '—'
}

function formatTimestamp(t: Timestamp | null) {
  if (!t) return '—'
  try {
    return t.toDate().toLocaleString()
  } catch {
    return '—'
  }
}

export default function AccountOverview() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const { memberships } = useMemberships()
  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwner = memberships.some(m => m.storeId === storeId && m.role === 'owner')

  useEffect(() => {
    if (!storeId) {
      setProfile(null)
      setError(null)
      return
    }

    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        let snapshot = await getDoc(doc(db, 'stores', storeId))
        if (!snapshot.exists()) {
          // fallback: stores where ownerId == storeId
          const q = query(collection(db, 'stores'), where('ownerId', '==', storeId))
          const snap2 = await getDocs(q)
          snapshot = snap2.docs[0] ?? snapshot
        }

        if (!cancelled && snapshot.exists()) {
          setProfile(mapStore(snapshot.data()))
        } else if (!cancelled) {
          setProfile(null)
          setError('We could not find this workspace profile.')
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setError('We could not load the workspace profile.')
          setProfile(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (storeError) {
    return <div role="alert">{storeError}</div>
  }

  if (!storeLoading && !storeId) {
    return (
      <div className="account-overview">
        <h1>Account overview</h1>
        <p>Select a workspace to view account details.</p>
      </div>
    )
  }

  return (
    <div className="account-overview">
      <h1>Account overview</h1>

      {error && (
        <div role="alert">
          <p>{error}</p>
        </div>
      )}

      {loading && (
        <p role="status" aria-live="polite">
          Loading account details…
        </p>
      )}

      {profile && (
        <section>
          <h2>Contract &amp; billing</h2>
          <dl>
            <div>
              <dt>Contract status</dt>
              <dd>{formatValue(profile.status)}</dd>
            </div>
            <div>
              <dt>Billing plan</dt>
              <dd>{formatValue(profile.billingPlan)}</dd>
            </div>
            <div>
              <dt>Payment provider</dt>
              <dd>{formatValue(profile.paymentProvider)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatTimestamp(profile.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestamp(profile.updatedAt)}</dd>
            </div>
          </dl>
          <p>{isOwner ? 'You are the workspace owner.' : 'You are staff in this workspace.'}</p>
        </section>
      )}
    </div>
  )
}
