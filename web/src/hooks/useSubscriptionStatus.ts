// src/hooks/useSubscriptionStatus.ts
import { useMemo } from 'react'
import { useStoreBilling, BillingStatus, StoreBilling } from './useStoreBilling'

type SubscriptionState = {
  loading: boolean
  status: BillingStatus
  billing: StoreBilling | null
  error: string | null
  isInactive: boolean
}

/**
 * Lightweight helper so components can consistently read subscription state.
 */
export function useSubscriptionStatus(): SubscriptionState {
  const { loading, billing, error } = useStoreBilling()

  return useMemo(() => {
    const status = billing?.status ?? 'unknown'
    return {
      loading,
      billing,
      error,
      status,
      isInactive: status === 'inactive',
    }
  }, [billing, error, loading])
}
