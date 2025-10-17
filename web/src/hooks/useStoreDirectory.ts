import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'

export interface StoreDirectoryOption {
  storeId: string
  slug: string
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

function extractCompanyName(data: Record<string, unknown> | undefined, fallback: string): string {
  if (!data) return fallback

  const company = typeof data.company === 'string' ? data.company.trim() : ''
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : ''
  const name = typeof data.name === 'string' ? data.name.trim() : ''

  return company || displayName || name || fallback
}

function extractWorkspaceSlug(data: Record<string, unknown> | undefined, fallback: string): string {
  if (!data) return fallback

  const workspaceSlug = typeof data.workspaceSlug === 'string' ? data.workspaceSlug.trim() : ''
  const slug = typeof data.slug === 'string' ? data.slug.trim() : ''
  const storeSlug = typeof data.storeSlug === 'string' ? data.storeSlug.trim() : ''

  return workspaceSlug || slug || storeSlug || fallback
}

function buildOptionLabel(company: string, slug: string, fallback: string): string {
  const companyLabel = company.trim()
  const slugLabel = slug.trim()

  if (companyLabel && slugLabel && companyLabel !== slugLabel) {
    return `${companyLabel} (${slugLabel})`
  }

  return companyLabel || slugLabel || fallback
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

  const [directory, setDirectory] = useState<Record<string, StoreDirectoryOption>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (normalizedIds.length === 0) {
      setDirectory({})
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
                return {
                  storeId,
                  slug: storeId,
                  label: storeId,
                }
              }

              const data = snapshot.data()
              const slug = extractWorkspaceSlug(data, storeId)
              const company = extractCompanyName(data, slug)
              const label = buildOptionLabel(company, slug, storeId)

              return { storeId, slug, label }
            } catch (innerError) {
              console.error('Failed to load store label', innerError)
              return {
                storeId,
                slug: storeId,
                label: storeId,
              }
            }
          }),
        )

        if (cancelled) return

        const next: Record<string, StoreDirectoryOption> = {}
        for (const entry of entries) {
          next[entry.storeId] = entry
        }

        setDirectory(next)
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
    () =>
      normalizedIds.map(storeId =>
        directory[storeId] ?? {
          storeId,
          slug: storeId,
          label: storeId,
        },
      ),
    [directory, normalizedIds],
  )

  return { options, loading, error }
}
