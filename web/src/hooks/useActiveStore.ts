import { useMemo } from 'react'
import { useMemberships } from './useMemberships'

interface ActiveStoreState {
  storeId: string | null
  isLoading: boolean
  error: string | null
}

const STORE_ERROR_MESSAGE = 'We could not load your workspace access. Some features may be limited.'

export function useActiveStore(): ActiveStoreState {
  const { memberships, loading, error } = useMemberships()
  const persistedStoreId =
    typeof window !== 'undefined' ? window.localStorage.getItem('activeStoreId') : null

  const membershipStoreId = memberships.find(m => m.storeId)?.storeId ?? null
  const activeStoreId =
    persistedStoreId && persistedStoreId.trim() !== '' ? persistedStoreId : membershipStoreId
  const hasError = error != null

  return useMemo(
    () => ({
      storeId: activeStoreId ?? null,
      isLoading: loading,
      error: hasError ? STORE_ERROR_MESSAGE : null,
    }),
    [activeStoreId, hasError, loading],
  )
}
