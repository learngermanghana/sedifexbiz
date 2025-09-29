import { useEffect, useMemo, useState } from 'react'
import { useMemberships } from './useMemberships'
import { useAuthUser } from './useAuthUser'
import {
  clearLegacyActiveStoreId,
  persistActiveStoreIdForUser,
  readActiveStoreId,
} from '../utils/activeStoreStorage'

interface ActiveStoreState {
  storeId: string | null
  isLoading: boolean
  error: string | null
}

const STORE_ERROR_MESSAGE = 'We could not load your workspace access. Some features may be limited.'

export function useActiveStore(): ActiveStoreState {
  const user = useAuthUser()
  const uid = user?.uid ?? null

  const [persistedStoreId, setPersistedStoreId] = useState<string | null>(null)
  const [isPersistedLoading, setIsPersistedLoading] = useState(true)

  const normalizedPersistedStoreId =
    persistedStoreId && persistedStoreId.trim() !== '' ? persistedStoreId.trim() : null
  const membershipsHookStoreId = isPersistedLoading
    ? undefined
    : normalizedPersistedStoreId ?? null
  const {
    memberships,
    loading: membershipLoading,
    error,
  } = useMemberships(membershipsHookStoreId)

  useEffect(() => {
    if (typeof window === 'undefined') {
      setPersistedStoreId(null)
      setIsPersistedLoading(false)
      return
    }

    setIsPersistedLoading(true)
    setPersistedStoreId(null)
    clearLegacyActiveStoreId()

    if (!uid) {
      setIsPersistedLoading(false)
      return
    }

    const storedId = readActiveStoreId(uid)
    setPersistedStoreId(storedId)
    setIsPersistedLoading(false)
  }, [uid])

  const membershipStoreId = memberships.find(m => m.storeId)?.storeId ?? null

  useEffect(() => {
    if (membershipLoading) {
      return
    }

    if (typeof window === 'undefined' || !uid) {
      return
    }

    if (!membershipStoreId) {
      return
    }

    const trimmedPersistedStoreId =
      persistedStoreId && persistedStoreId.trim() !== ''
        ? persistedStoreId.trim()
        : null

    if (trimmedPersistedStoreId === membershipStoreId) {
      return
    }

    setPersistedStoreId(membershipStoreId)
    persistActiveStoreIdForUser(uid, membershipStoreId)
  }, [membershipLoading, membershipStoreId, persistedStoreId, uid])
  const activeStoreId = isPersistedLoading
    ? null
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
