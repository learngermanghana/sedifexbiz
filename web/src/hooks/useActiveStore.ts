import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMemberships } from './useMemberships'
import { useAuthUser } from './useAuthUser'
import { persistActiveStoreIdForUser, readActiveStoreId } from '../utils/activeStoreStorage'

interface ActiveStoreState {
  storeId: string | null
  isLoading: boolean
  error: string | null
  setActiveStoreId: (storeId: string | null) => void
}

const STORE_ERROR_MESSAGE = 'We could not load your workspace access. Some features may be limited.'

export function useActiveStore(): ActiveStoreState {
  const user = useAuthUser()
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(() => readActiveStoreId(user?.uid))
  const { memberships, loading, error } = useMemberships(selectedStoreId)

  const membershipStoreIds = useMemo(
    () => memberships.map(m => m.storeId).filter((storeId): storeId is string => Boolean(storeId)),
    [memberships],
  )
  const fallbackStoreId = membershipStoreIds[0] ?? null
  const activeStoreId = selectedStoreId ?? fallbackStoreId
  const hasError = error != null

  useEffect(() => {
    setSelectedStoreId(readActiveStoreId(user?.uid))
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return

    if (!selectedStoreId && fallbackStoreId) {
      setSelectedStoreId(fallbackStoreId)
      persistActiveStoreIdForUser(user.uid, fallbackStoreId)
      return
    }

    if (selectedStoreId && membershipStoreIds.length > 0 && !membershipStoreIds.includes(selectedStoreId)) {
      setSelectedStoreId(fallbackStoreId)
      persistActiveStoreIdForUser(user.uid, fallbackStoreId)
    }
  }, [fallbackStoreId, membershipStoreIds, selectedStoreId, user?.uid])

  const setActiveStoreId = useCallback(
    (storeId: string | null) => {
      if (!user?.uid) return
      const normalized = typeof storeId === 'string' ? storeId.trim() : ''
      if (!normalized || membershipStoreIds.length === 0 || !membershipStoreIds.includes(normalized)) {
        return
      }
      setSelectedStoreId(normalized)
      persistActiveStoreIdForUser(user.uid, normalized)
    },
    [membershipStoreIds, user?.uid],
  )

  return useMemo(
    () => ({
      storeId: activeStoreId,
      isLoading: loading,
      error: hasError ? STORE_ERROR_MESSAGE : null,
      setActiveStoreId,
    }),
    [activeStoreId, hasError, loading, setActiveStoreId],
  )
}
