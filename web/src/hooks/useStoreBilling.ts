// src/hooks/useStoreBilling.ts
import { useEffect, useState } from 'react'
import { doc, onSnapshot, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from './useActiveStore'

export type BillingStatus = 'active' | 'trial' | 'inactive' | 'past_due' | 'unknown'

export type PaymentStatus = BillingStatus | 'suspended'

export type StoreBilling = {
  status: BillingStatus
  planKey: string | null
  trialEndsAt: Timestamp | null
  paymentStatus: PaymentStatus
  contractEnd: Timestamp | null
}

type BillingState = {
  loading: boolean
  billing: StoreBilling | null
  error: string | null
}

/**
 * Subscribe to the current store's billing info from Firestore.
 * Expects a `billing` object on the `stores/{storeId}` document, e.g.:
 * billing: {
 *   status: 'trial' | 'active' | 'inactive',
 *   planKey: 'standard',
 *   trialEndsAt: <Timestamp>
 * }
 */
export function useStoreBilling(): BillingState {
  const { storeId } = useActiveStore()
  const [state, setState] = useState<BillingState>({
    loading: true,
    billing: null,
    error: null,
  })

  useEffect(() => {
    if (!storeId) {
      setState({ loading: false, billing: null, error: null })
      return
    }

    setState(prev => ({ ...prev, loading: true, error: null }))

    const ref = doc(db, 'stores', storeId)
    const unsubscribe = onSnapshot(
      ref,
      snapshot => {
        const data = snapshot.data() || {}
        const billingRaw = (data.billing || {}) as any
        const paymentStatusRaw = typeof data.paymentStatus === 'string' ? data.paymentStatus : null

        const statusRaw = typeof billingRaw.status === 'string' ? billingRaw.status : null
        const planKey =
          typeof billingRaw.planKey === 'string' && billingRaw.planKey.trim()
            ? billingRaw.planKey
            : null

        let trialEndsAt: Timestamp | null = null
        if (billingRaw.trialEndsAt instanceof Timestamp) {
          trialEndsAt = billingRaw.trialEndsAt
        }

        let contractEnd: Timestamp | null = null
        if (data.contractEnd instanceof Timestamp) {
          contractEnd = data.contractEnd
        }

        const status: BillingStatus =
          statusRaw === 'active' ||
          statusRaw === 'trial' ||
          statusRaw === 'inactive' ||
          statusRaw === 'past_due'
            ? statusRaw
            : 'unknown'

        const paymentStatus: PaymentStatus =
          paymentStatusRaw === 'suspended'
            ? 'suspended'
            : paymentStatusRaw === 'past_due'
              ? 'past_due'
              : status

        setState({
          loading: false,
          billing: {
            status,
            planKey,
            trialEndsAt,
            paymentStatus,
            contractEnd,
          },
          error: null,
        })
      },
      error => {
        console.error('[useStoreBilling] Failed to subscribe to store billing', error)
        setState({
          loading: false,
          billing: null,
          error: 'Unable to load subscription status.',
        })
      },
    )

    return () => unsubscribe()
  }, [storeId])

  return state
}
