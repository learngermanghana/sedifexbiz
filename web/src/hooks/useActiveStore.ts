import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useMemberships, type Membership } from './useMemberships'
import { useAuthUser } from './useAuthUser'
import { persistActiveStoreIdForUser, readActiveStoreId } from '../utils/activeStoreStorage'

interface ActiveStoreState {
  storeId: string | null
  isLoading: boolean
  error: string | null
  memberships: Membership[]
  setActiveStoreId: (storeId: string | null) => void
}

const STORE_ERROR_MESSAGE = 'We could not load your workspace access. Some features may be limited.'

export function useActiveStore(): ActiveStoreState {
  const { memberships, loading, error } = useMemberships()
  const user = useAuthUser()
  const activeStoreId = useSyncExternalStore(
    subscribeToActiveStoreId,
    getActiveStoreIdSnapshot,
    getActiveStoreIdSnapshot,
  )

  const membershipStoreIds = useMemo(() => {
    const seen = new Set<string>()
    return memberships
      .map(membership => membership.storeId)
      .filter((storeId): storeId is string => Boolean(storeId && storeId.trim()))
      .filter(storeId => {
        if (seen.has(storeId)) return false
        seen.add(storeId)
        return true
      })
  }, [memberships])

  useEffect(() => {
    if (!user?.uid) {
      setActiveStoreId(null)
      return
    }

    const stored = readActiveStoreId(user.uid)
    if (stored) {
      setActiveStoreId(stored)
    }
  }, [user?.uid])

  useEffect(() => {
    if (loading) {
      return
    }

    if (membershipStoreIds.length === 0) {
      if (!error) {
        setActiveStoreId(null)
      }
      return
    }

    const currentActiveStoreId = getActiveStoreIdSnapshot()
    let nextStoreId = currentActiveStoreId

    if (!currentActiveStoreId || !membershipStoreIds.includes(currentActiveStoreId)) {
      const stored = user?.uid ? readActiveStoreId(user.uid) : null

      if (stored && membershipStoreIds.includes(stored)) {
        nextStoreId = stored
      } else {
        nextStoreId = membershipStoreIds[0]
      }
    }

    if (nextStoreId && nextStoreId !== currentActiveStoreId && user?.uid) {
      persistActiveStoreIdForUser(user.uid, nextStoreId)
    }

    setActiveStoreId(nextStoreId)
  }, [error, loading, membershipStoreIds, user?.uid])

  const selectActiveStoreId = useCallback(
    (storeId: string | null) => {
      if (!storeId) {
        return
      }

      if (!membershipStoreIds.includes(storeId)) {
        return
      }

      const currentActiveStoreId = getActiveStoreIdSnapshot()
      if (currentActiveStoreId === storeId) {
        return
      }

      if (user?.uid) {
        persistActiveStoreIdForUser(user.uid, storeId)
      }

      setActiveStoreId(storeId)
    },
    [membershipStoreIds, user?.uid],
  )

  const hasError = error != null

  return useMemo(
    () => ({
      storeId: activeStoreId,
      isLoading: loading,
      error: hasError ? STORE_ERROR_MESSAGE : null,
      memberships,
      setActiveStoreId: selectActiveStoreId,
    }),
    [activeStoreId, hasError, loading, memberships, selectActiveStoreId],
  )
}

type ActiveStoreListener = () => void

let activeStoreIdSnapshot: string | null = null
const listeners = new Set<ActiveStoreListener>()

function getActiveStoreIdSnapshot() {
  return activeStoreIdSnapshot
}

function setActiveStoreId(storeId: string | null) {
  if (activeStoreIdSnapshot === storeId) {
    return
  }

  activeStoreIdSnapshot = storeId
  listeners.forEach(listener => listener())
}

function subscribeToActiveStoreId(listener: ActiveStoreListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
