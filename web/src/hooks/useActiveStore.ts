// web/src/hooks/useActiveStore.ts
import { useEffect, useState } from 'react'
import { useMemberships } from './useMemberships'
import { useAuthUser } from './useAuthUser'
import {
  getActiveStoreIdForUser,
  persistActiveStoreIdForUser
} from '../utils/activeStoreStorage'

export function useActiveStore() {
  const user = useAuthUser()
  const { memberships, loading } = useMemberships()
  const [storeId, setStoreId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) {
      setStoreId(null)
      setError(null)
      return
    }

    if (loading) return

    const persisted = getActiveStoreIdForUser(user.uid)
    if (persisted) {
      setStoreId(persisted)
      return
    }

    const first = memberships[0]
    if (first?.storeId) {
      setStoreId(first.storeId)
      persistActiveStoreIdForUser(user.uid, first.storeId)
      return
    }

    if (!first) {
      setError('We could not find a workspace assignment for your account.')
    } else {
      setError('This workspace is not fully configured yet.')
    }
  }, [user?.uid, loading, memberships])

  return { storeId, isLoading: loading, error }
}
