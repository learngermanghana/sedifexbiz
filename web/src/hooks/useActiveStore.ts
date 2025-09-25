import { useEffect, useState } from 'react'
import type { IdTokenResult } from 'firebase/auth'
import { useAuthUser } from './useAuthUser'

type StoreRole = 'owner' | 'manager' | 'cashier' | string

interface ActiveStoreState {
  storeId: string | null
  role: StoreRole | null
  isLoading: boolean
  error: string | null
}

interface StoreClaims {
  stores?: unknown
  activeStoreId?: unknown
  roleByStore?: unknown
}

function normalizeStoreList(claims: StoreClaims): string[] {
  if (!Array.isArray(claims.stores)) {
    return []
  }

  return claims.stores.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function resolveRole(claims: StoreClaims, storeId: string | null): StoreRole | null {
  if (!storeId || typeof claims.roleByStore !== 'object' || claims.roleByStore === null) {
    return null
  }

  const role = (claims.roleByStore as Record<string, unknown>)[storeId]
  return typeof role === 'string' ? role : null
}

function resolveStoreId(result: IdTokenResult, fallbackUid: string | null): string | null {
  const claims: StoreClaims = result.claims as StoreClaims
  const stores = normalizeStoreList(claims)
  const activeClaim = typeof claims.activeStoreId === 'string' ? claims.activeStoreId : null

  if (activeClaim && stores.includes(activeClaim)) {
    return activeClaim
  }

  if (stores.length > 0) {
    return stores[0]
  }

  return fallbackUid ?? null
}

export function useActiveStore(): ActiveStoreState {
  const user = useAuthUser()
  const [state, setState] = useState<ActiveStoreState>({
    storeId: null,
    role: null,
    isLoading: Boolean(user),
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    if (!user) {
      setState({ storeId: null, role: null, isLoading: false, error: null })
      return
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    user
      .getIdTokenResult()
      .then(result => {
        if (cancelled) return
        const resolvedStoreId = resolveStoreId(result, user.uid)
        const claims: StoreClaims = result.claims as StoreClaims
        const role = resolveRole(claims, resolvedStoreId)
        setState({ storeId: resolvedStoreId, role, isLoading: false, error: null })
      })
      .catch(error => {
        console.warn('[store] Unable to resolve store from auth claims', error)
        if (cancelled) return
        setState({
          storeId: user.uid ?? null,
          role: null,
          isLoading: false,
          error: 'We could not determine your store access. Some actions may fail.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [user])

  return state
}

