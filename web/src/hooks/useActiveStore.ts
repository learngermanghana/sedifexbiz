import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null)

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
      setActiveStoreIdState(null)
      return
    }

    const stored = readActiveStoreId(user.uid)
    if (stored) {
      setActiveStoreIdState(stored)
    }
  }, [user?.uid])

  useEffect(() => {
    if (loading) {
      return
    }

    if (membershipStoreIds.length === 0) {
      setActiveStoreIdState(null)
      return
    }

    setActiveStoreIdState(previous => {
      let nextStoreId = previous

      if (!previous || !membershipStoreIds.includes(previous)) {
        const stored = user?.uid ? readActiveStoreId(user.uid) : null

        if (stored && membershipStoreIds.includes(stored)) {
          nextStoreId = stored
        } else {
          nextStoreId = membershipStoreIds[0]
        }
      }

      if (nextStoreId && nextStoreId !== previous && user?.uid) {
        persistActiveStoreIdForUser(user.uid, nextStoreId)
      }

      return nextStoreId
    })
  }, [loading, membershipStoreIds, user?.uid])

  const setActiveStoreId = useCallback(
    (storeId: string | null) => {
      if (!storeId) {
        return
      }

      if (!membershipStoreIds.includes(storeId)) {
        return
      }

      setActiveStoreIdState(previous => {
        if (previous === storeId) {
          return previous
        }

        if (user?.uid) {
          persistActiveStoreIdForUser(user.uid, storeId)
        }

        return storeId
      })
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
      setActiveStoreId,
    }),
    [activeStoreId, hasError, loading, memberships, setActiveStoreId],
  )
}
