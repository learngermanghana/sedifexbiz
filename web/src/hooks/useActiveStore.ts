import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthUser } from './useAuthUser'
import { useMemberships, type Membership } from './useMemberships'
import {
  clearActiveStoreIdForUser,
  clearLegacyActiveStoreId,
  persistActiveStoreIdForUser,
  readActiveStoreId,
} from '../utils/activeStoreStorage'

interface ActiveStoreState {
  storeId: string | null
  isLoading: boolean
  error: string | null
  memberships: Membership[]
  setActiveStoreId: (storeId: string | null) => void
}

const STORE_ERROR_MESSAGE = 'We could not load your workspace access. Some features may be limited.'

function uniqueStoreIds(memberships: Membership[]): string[] {
  const seen = new Set<string>()

  return memberships.reduce<string[]>((acc, membership) => {
    const { storeId } = membership
    if (!storeId || seen.has(storeId)) {
      return acc
    }

    seen.add(storeId)
    acc.push(storeId)
    return acc
  }, [])
}

export function useActiveStore(): ActiveStoreState {
  const user = useAuthUser()
  const [persistedStoreId, setPersistedStoreId] = useState<string | null>(() => readActiveStoreId(user?.uid ?? null))
  const { memberships, loading, error } = useMemberships(persistedStoreId)

  useEffect(() => {
    clearLegacyActiveStoreId()
  }, [])

  useEffect(() => {
    if (!user?.uid) {
      setPersistedStoreId(null)
      return
    }

    setPersistedStoreId(readActiveStoreId(user.uid))
  }, [user?.uid])

  const availableStoreIds = useMemo(() => uniqueStoreIds(memberships), [memberships])

  const resolvedStoreId = useMemo(() => {
    if (availableStoreIds.length === 0) {
      return null
    }

    if (persistedStoreId && availableStoreIds.includes(persistedStoreId)) {
      return persistedStoreId
    }

    return availableStoreIds[0] ?? null
  }, [availableStoreIds, persistedStoreId])

  useEffect(() => {
    if (!user?.uid) {
      return
    }

    if (resolvedStoreId && persistedStoreId !== resolvedStoreId) {
      persistActiveStoreIdForUser(user.uid, resolvedStoreId)
      setPersistedStoreId(resolvedStoreId)
    }

    if (!resolvedStoreId && persistedStoreId) {
      clearActiveStoreIdForUser(user.uid)
      setPersistedStoreId(null)
    }
  }, [resolvedStoreId, persistedStoreId, user?.uid])

  const handleSetActiveStoreId = useCallback(
    (nextStoreId: string | null) => {
      const validNextStoreId = nextStoreId && availableStoreIds.includes(nextStoreId) ? nextStoreId : null

      if (!user?.uid) {
        setPersistedStoreId(validNextStoreId)
        return
      }

      if (validNextStoreId) {
        setPersistedStoreId(validNextStoreId)
        persistActiveStoreIdForUser(user.uid, validNextStoreId)
        return
      }

      setPersistedStoreId(null)
      clearActiveStoreIdForUser(user.uid)
    },
    [availableStoreIds, user?.uid],
  )

  const hasError = error != null

  return useMemo(
    () => ({
      storeId: resolvedStoreId,
      isLoading: loading,
      error: hasError ? STORE_ERROR_MESSAGE : null,
      memberships,
      setActiveStoreId: handleSetActiveStoreId,
    }),
    [resolvedStoreId, loading, hasError, memberships, handleSetActiveStoreId],
  )
}
