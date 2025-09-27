import { useCallback, useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { useAuthUser } from './useAuthUser'

interface ActiveStoreState {
  storeId: string | null
  stores: string[]
  isLoading: boolean
  error: string | null
  selectStore: (storeId: string) => void
  needsStoreResolution: boolean
  resolveStoreAccess: (storeCode: string) => Promise<{ ok: boolean; error: string | null }>
  isResolvingStoreAccess: boolean
  resolutionError: string | null
}

interface StoreClaims {
  stores?: unknown
  activeStoreId?: unknown
}

interface InternalStoreState {
  storeId: string | null
  stores: string[]
  isLoading: boolean
  error: string | null
  requiresManualEntry: boolean
  isResolving: boolean
  resolutionError: string | null
}

const ACTIVE_STORE_STORAGE_PREFIX = 'sedifex.activeStore.'
const STORE_CODE_PATTERN = /^[A-Z]{6}$/
const NO_STORE_MESSAGE =
  'We could not find any stores linked to your account. Enter your store code to restore access.'

type ResolveStoreAccessPayload = {
  storeCode: string
}

type ResolveStoreAccessResponse = {
  ok: boolean
  storeId: string | null
  claims?: StoreClaims
}

type StoreResolutionResult = {
  ok: boolean
  error: string | null
}

function normalizeStoreList(claims: StoreClaims): string[] {
  if (!Array.isArray(claims.stores)) {
    return []
  }

  return claims.stores.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function getStorageKey(uid: string) {
  return `${ACTIVE_STORE_STORAGE_PREFIX}${uid}`
}

function readPersistedStoreId(uid: string | null): string | null {
  if (!uid || typeof window === 'undefined' || !window?.localStorage) {
    return null
  }

  try {
    const stored = window.localStorage.getItem(getStorageKey(uid))
    return typeof stored === 'string' && stored.trim().length > 0 ? stored : null
  } catch (error) {
    console.warn('[store] Failed to read persisted store preference', error)
    return null
  }
}

function persistStoreId(uid: string, storeId: string | null) {
  if (typeof window === 'undefined' || !window?.localStorage) {
    return
  }

  const key = getStorageKey(uid)
  try {
    if (storeId) {
      window.localStorage.setItem(key, storeId)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch (error) {
    console.warn('[store] Failed to persist store preference', error)
  }
}

function resolveStoreId(
  stores: string[],
  activeClaim: string | null,
  persistedStoreId: string | null,
): string | null {
  if (activeClaim && stores.includes(activeClaim)) {
    return activeClaim
  }

  if (persistedStoreId && stores.includes(persistedStoreId)) {
    return persistedStoreId
  }

  if (stores.length > 0) {
    return stores[0]
  }

  return null
}

export function useActiveStore(): ActiveStoreState {
  const user = useAuthUser()
  const [state, setState] = useState<InternalStoreState>({
    storeId: null,
    stores: [],
    isLoading: Boolean(user),
    error: null,
    requiresManualEntry: false,
    isResolving: false,
    resolutionError: null,
  })

  const selectStore = useCallback(
    (storeId: string) => {
      if (!user) {
        return
      }

      setState(prev => {
        if (!prev.stores.includes(storeId)) {
          return prev
        }

        persistStoreId(user.uid, storeId)
        return {
          ...prev,
          storeId,
          resolutionError: null,
        }
      })
    },
    [user],
  )

  useEffect(() => {
    let cancelled = false

    if (!user) {
      setState({
        storeId: null,
        stores: [],
        isLoading: false,
        error: null,
        requiresManualEntry: false,
        isResolving: false,
        resolutionError: null,
      })
      return
    }

    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      resolutionError: null,
    }))

    const persistedStoreId = readPersistedStoreId(user.uid)

    user
      .getIdTokenResult()
      .then(result => {
        if (cancelled) return
        const claims: StoreClaims = result.claims as StoreClaims
        const stores = normalizeStoreList(claims)
        const activeClaim = typeof claims.activeStoreId === 'string' ? claims.activeStoreId : null
        const resolvedStoreId = resolveStoreId(stores, activeClaim, persistedStoreId)

        if (resolvedStoreId && stores.includes(resolvedStoreId)) {
          persistStoreId(user.uid, resolvedStoreId)
        } else if (stores.length === 0) {
          persistStoreId(user.uid, null)
        }

        setState({
          storeId: resolvedStoreId,
          stores,
          isLoading: false,
          error: stores.length === 0 ? NO_STORE_MESSAGE : null,
          requiresManualEntry: stores.length === 0,
          isResolving: false,
          resolutionError: null,
        })
      })
      .catch(error => {
        console.warn('[store] Unable to resolve store from auth claims', error)
        if (cancelled) return
        setState({
          storeId: null,
          stores: [],
          isLoading: false,
          error: 'We could not determine your store access. Some actions may fail.',
          requiresManualEntry: false,
          isResolving: false,
          resolutionError: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [user])

  const resolveStoreAccess = useCallback(
    async (rawCode: string): Promise<StoreResolutionResult> => {
      if (!user) {
        setState(prev => ({
          ...prev,
          resolutionError: 'Sign in again to restore store access.',
        }))
        return { ok: false, error: 'Sign in again to restore store access.' }
      }

      const normalizedCode = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
      if (!STORE_CODE_PATTERN.test(normalizedCode)) {
        setState(prev => ({
          ...prev,
          resolutionError: 'Store codes must be exactly six letters.',
        }))
        return { ok: false, error: 'Store codes must be exactly six letters.' }
      }

      setState(prev => ({ ...prev, isResolving: true, resolutionError: null }))

      try {
        const callable = httpsCallable<ResolveStoreAccessPayload, ResolveStoreAccessResponse>(
          functions,
          'resolveStoreAccess',
        )
        await callable({ storeCode: normalizedCode })

        const tokenResult = await user.getIdTokenResult(true)
        const claims: StoreClaims = tokenResult.claims as StoreClaims
        const stores = normalizeStoreList(claims)
        const activeClaim =
          typeof claims.activeStoreId === 'string' && stores.includes(claims.activeStoreId)
            ? claims.activeStoreId
            : null
        const persistedStoreId = readPersistedStoreId(user.uid)
        const resolvedStoreId = resolveStoreId(
          stores,
          activeClaim ?? (stores.includes(normalizedCode) ? normalizedCode : null),
          stores.includes(normalizedCode) ? normalizedCode : persistedStoreId,
        )

        if (resolvedStoreId && stores.includes(resolvedStoreId)) {
          persistStoreId(user.uid, resolvedStoreId)
        } else {
          persistStoreId(user.uid, null)
        }

        setState({
          storeId: resolvedStoreId,
          stores,
          isLoading: false,
          error: stores.length === 0 ? NO_STORE_MESSAGE : null,
          requiresManualEntry: stores.length === 0,
          isResolving: false,
          resolutionError: stores.length === 0 ? 'We could not link that store code.' : null,
        })

        const success = stores.length > 0
        return {
          ok: success,
          error: success ? null : 'We could not link that store code.',
        }
      } catch (error) {
        console.warn('[store] Unable to resolve store manually', error)
        const message = (() => {
          if (error && typeof error === 'object' && 'code' in error) {
            const code = String((error as { code?: unknown }).code ?? '')
            if (code.endsWith('/not-found')) {
              return 'We could not find a store with that code.'
            }
            if (code.endsWith('/permission-denied')) {
              return 'You do not have access to that store.'
            }
            if (code.endsWith('/already-exists')) {
              return 'That store is already linked to another account.'
            }
          }
          if (error instanceof Error && error.message) {
            return error.message
          }
          return 'We could not verify that store code. Try again.'
        })()

        setState(prev => ({ ...prev, isResolving: false, resolutionError: message }))
        return { ok: false, error: message }
      }
    },
    [user],
  )

  return useMemo(
    () => ({
      storeId: state.storeId,
      stores: state.stores,
      isLoading: state.isLoading,
      error: state.error,
      selectStore,
      needsStoreResolution: state.requiresManualEntry,
      resolveStoreAccess,
      isResolvingStoreAccess: state.isResolving,
      resolutionError: state.resolutionError,
    }),
    [
      resolveStoreAccess,
      selectStore,
      state.error,
      state.isLoading,
      state.isResolving,
      state.resolutionError,
      state.requiresManualEntry,
      state.storeId,
      state.stores,
    ],
  )
}

