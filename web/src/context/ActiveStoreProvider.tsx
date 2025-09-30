import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'

import { auth, db } from '../firebase'

const ACTIVE_STORE_STORAGE_KEY = 'activeStoreId'

interface ActiveStoreContextValue {
  storeId: string | null
  setStoreId: (nextStoreId: string | null) => void
}

const ActiveStoreContext = createContext<ActiveStoreContextValue | undefined>(undefined)

interface ActiveStoreProviderProps {
  children: ReactNode
}

function hasWindow(): boolean {
  return typeof window !== 'undefined'
}

function readStoredStoreId(): string | null {
  if (!hasWindow()) {
    return null
  }

  try {
    const value = window.localStorage.getItem(ACTIVE_STORE_STORAGE_KEY)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function persistStoreId(storeId: string | null) {
  if (!hasWindow()) {
    return
  }

  try {
    if (storeId && storeId.trim()) {
      window.localStorage.setItem(ACTIVE_STORE_STORAGE_KEY, storeId.trim())
    } else {
      window.localStorage.removeItem(ACTIVE_STORE_STORAGE_KEY)
    }
  } catch {
    /* noop */
  }
}

export function ActiveStoreProvider({ children }: ActiveStoreProviderProps) {
  const [storeId, setStoreIdState] = useState<string | null>(() => readStoredStoreId())

  useEffect(() => {
    let isMounted = true

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (!isMounted) {
        return
      }

      if (!user) {
        persistStoreId(null)
        setStoreIdState(null)
        return
      }

      const existingStoreId = readStoredStoreId()
      if (existingStoreId) {
        setStoreIdState(existingStoreId)
        return
      }

      ;(async () => {
        try {
          const memberDoc = await getDoc(doc(db, 'teamMembers', user.uid))
          if (!isMounted) {
            return
          }

          if (!memberDoc.exists()) {
            setStoreIdState(null)
            return
          }

          const data = memberDoc.data() as { storeId?: unknown } | undefined
          const documentStoreId =
            typeof data?.storeId === 'string' && data.storeId.trim().length > 0
              ? data.storeId.trim()
              : null

          if (documentStoreId) {
            persistStoreId(documentStoreId)
            setStoreIdState(documentStoreId)
          } else {
            setStoreIdState(null)
          }
        } catch (error) {
          console.error('[ActiveStoreProvider] Failed to load team member document', error)
          if (isMounted) {
            setStoreIdState(null)
          }
        }
      })()
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const setStoreId = useCallback((nextStoreId: string | null) => {
    const normalized = nextStoreId && nextStoreId.trim() ? nextStoreId.trim() : null
    setStoreIdState(normalized)
    persistStoreId(normalized)
  }, [])

  const value = useMemo<ActiveStoreContextValue>(
    () => ({
      storeId,
      setStoreId,
    }),
    [setStoreId, storeId],
  )

  return <ActiveStoreContext.Provider value={value}>{children}</ActiveStoreContext.Provider>
}

export function useActiveStoreContext() {
  const context = useContext(ActiveStoreContext)

  if (context === undefined) {
    throw new Error('useActiveStoreContext must be used within an ActiveStoreProvider')
  }

  return context
}
