import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useMemberships } from '../hooks/useMemberships'

type NullableString = string | null

export type ActiveStoreContextValue = {
  storeId: NullableString
  isLoading: boolean
  error: string | null
  setActiveStoreId: (storeId: NullableString) => void
}

const STORE_ERROR_MESSAGE =
  'We could not load your workspace access. Some features may be limited.'

const ACTIVE_STORE_STORAGE_KEY = 'activeStoreId'

const listeners = new Set<(storeId: NullableString) => void>()

function normalizeStoreId(value: NullableString | undefined): NullableString {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function writeStoreId(storeId: NullableString) {
  const storage = getStorage()
  if (!storage) return
  try {
    if (storeId) {
      storage.setItem(ACTIVE_STORE_STORAGE_KEY, storeId)
    } else {
      storage.removeItem(ACTIVE_STORE_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures (e.g. private browsing)
  }
}

function notify(storeId: NullableString) {
  listeners.forEach(listener => {
    try {
      listener(storeId)
    } catch {
      // Listener errors should not break the provider flow
    }
  })
}

export function getPersistedActiveStoreId(): NullableString {
  const storage = getStorage()
  if (!storage) return null
  try {
    const value = storage.getItem(ACTIVE_STORE_STORAGE_KEY)
    return normalizeStoreId(value)
  } catch {
    return null
  }
}

export function setPersistedActiveStoreId(storeId: NullableString) {
  const normalized = normalizeStoreId(storeId)
  writeStoreId(normalized)
  notify(normalized)
}

export function subscribeToPersistedActiveStore(
  listener: (storeId: NullableString) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const ActiveStoreContext = createContext<ActiveStoreContextValue | undefined>(undefined)

export function ActiveStoreProvider({ children }: { children: ReactNode }) {
  const [persistedStoreId, setPersistedStoreIdState] = useState<NullableString>(null)
  const [persistedReady, setPersistedReady] = useState(false)

  useEffect(() => {
    setPersistedStoreIdState(getPersistedActiveStoreId())
    setPersistedReady(true)

    const unsubscribe = subscribeToPersistedActiveStore(next => {
      setPersistedStoreIdState(prev => (prev === next ? prev : next))
    })

    if (typeof window === 'undefined') {
      return unsubscribe
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return
      if (event.key !== ACTIVE_STORE_STORAGE_KEY) return
      setPersistedStoreIdState(getPersistedActiveStoreId())
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      unsubscribe()
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const normalizedPersistedStoreId = normalizeStoreId(persistedStoreId)
  const membershipsStoreId = persistedReady ? normalizedPersistedStoreId ?? null : undefined

  const {
    memberships,
    loading: membershipLoading,
    error,
  } = useMemberships(membershipsStoreId)

  const membershipStoreId = useMemo(
    () => memberships.find(m => m.storeId)?.storeId ?? null,
    [memberships],
  )

  const hasPersistedMembership = useMemo(
    () =>
      normalizedPersistedStoreId
        ? memberships.some(m => m.storeId === normalizedPersistedStoreId)
        : false,
    [memberships, normalizedPersistedStoreId],
  )

  const resolvedStoreId = hasPersistedMembership ? normalizedPersistedStoreId : membershipStoreId

  useEffect(() => {
    if (!persistedReady || membershipLoading) return
    if (!normalizedPersistedStoreId) return
    if (hasPersistedMembership) return

    setPersistedStoreIdState(null)
    setPersistedActiveStoreId(null)
  }, [hasPersistedMembership, membershipLoading, normalizedPersistedStoreId, persistedReady])

  useEffect(() => {
    if (!persistedReady || membershipLoading) return

    if (!resolvedStoreId) {
      if (normalizedPersistedStoreId !== null) {
        setPersistedStoreIdState(null)
        setPersistedActiveStoreId(null)
      }
      return
    }

    if (normalizedPersistedStoreId === resolvedStoreId) {
      return
    }

    setPersistedStoreIdState(resolvedStoreId)
    setPersistedActiveStoreId(resolvedStoreId)
  }, [membershipLoading, normalizedPersistedStoreId, persistedReady, resolvedStoreId])

  const setActiveStoreId = useCallback((storeId: NullableString) => {
    const normalized = normalizeStoreId(storeId)
    setPersistedStoreIdState(normalized)
    setPersistedActiveStoreId(normalized)
  }, [])

  const contextValue = useMemo<ActiveStoreContextValue>(
    () => ({
      storeId: resolvedStoreId ?? null,
      isLoading: membershipLoading || !persistedReady,
      error: error ? STORE_ERROR_MESSAGE : null,
      setActiveStoreId,
    }),
    [error, membershipLoading, persistedReady, resolvedStoreId, setActiveStoreId],
  )

  return <ActiveStoreContext.Provider value={contextValue}>{children}</ActiveStoreContext.Provider>
}

export function useActiveStoreContext(): ActiveStoreContextValue {
  const context = useContext(ActiveStoreContext)
  if (!context) {
    throw new Error('useActiveStoreContext must be used within an ActiveStoreProvider')
  }
  return context
}

export const STORE_ACCESS_ERROR_MESSAGE = STORE_ERROR_MESSAGE
