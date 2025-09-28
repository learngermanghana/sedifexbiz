import { useEffect, useMemo, useState } from 'react'
import { useMemberships } from './useMemberships'

interface ActiveStoreState {
  storeId: string | null
  isLoading: boolean
  error: string | null
}

const STORE_ERROR_MESSAGE = 'We could not load your workspace access. Some features may be limited.'

export function useActiveStore(): ActiveStoreState {
  const { memberships, loading: membershipLoading, error } = useMemberships()
  const [persistedStoreId, setPersistedStoreId] = useState<string | null>(null)
  const [isPersistedLoading, setIsPersistedLoading] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedId = window.localStorage.getItem('activeStoreId')
    setPersistedStoreId(storedId)
    setIsPersistedLoading(false)
  }, [])

  const membershipStoreId = memberships.find(m => m.storeId)?.storeId ?? null
  const normalizedPersistedStoreId =
    persistedStoreId && persistedStoreId.trim() !== '' ? persistedStoreId : null
  const activeStoreId = isPersistedLoading
    ? membershipStoreId
    : normalizedPersistedStoreId ?? membershipStoreId
  const hasError = error != null

  return useMemo(
    () => ({
      storeId: activeStoreId ?? null,
      isLoading: membershipLoading || isPersistedLoading,
      error: hasError ? STORE_ERROR_MESSAGE : null,
    }),
    [activeStoreId, hasError, isPersistedLoading, membershipLoading],
  )
}
