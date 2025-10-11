import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'

export interface StoreDirectoryOption {
  id: string
  label: string
}

interface StoreDirectoryState {
  options: StoreDirectoryOption[]
  loading: boolean
  error: string | null
}

function normalizeStoreId(storeId: string): string {
  return storeId.trim()
}

function extractStoreLabel(data: Record<string, unknown> | undefined, fallback: string): string {
  if (!data) return fallback

  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : ''
  const name = typeof data.name === 'string' ? data.name.trim() : ''

  return displayName || name || fallback
}

export function useStoreDirectory(storeIds: string[]): StoreDirectoryState {
  const normalizedIds = useMemo(() => {
    const seen = new Set<string>()
    return storeIds
      .map(storeId => normalizeStoreId(storeId))
      .filter(storeId => {
        if (!storeId) return false
        if (seen.has(storeId)) return false
        seen.add(storeId)
        return true
      })
  }, [storeIds])

  const [labels, setLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (normalizedIds.length === 0) {
      setLabels({})
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    async function load() {
      try {
        const entries = await Promise.all(
          normalizedIds.map(async storeId => {
            try {
              const snapshot = await getDoc(doc(db, 'stores', storeId))
              if (!snapshot.exists()) {
                return [storeId, storeId] as const
              }

              return [storeId, extractStoreLabel(snapshot.data(), storeId)] as const
            } catch (innerError) {
              console.error('Failed to load store label', innerError)
              return [storeId, storeId] as const
            }
          }),
        )

        if (cancelled) return

        const next: Record<string, string> = {}
        for (const [storeId, label] of entries) {
          next[storeId] = label
        }

        setLabels(next)
        setLoading(false)
      } catch (fetchError) {
        if (cancelled) return
        console.error('Failed to load store directory', fetchError)
        setLoading(false)
        setError('We could not load workspace names.')
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [normalizedIds])

  const options = useMemo<StoreDirectoryOption[]>(
    () => normalizedIds.map(storeId => ({ id: storeId, label: labels[storeId] ?? storeId })),
    [labels, normalizedIds],
  )

  return { options, loading, error }
}
