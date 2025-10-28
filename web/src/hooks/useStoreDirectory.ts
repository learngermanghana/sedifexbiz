import { useEffect, useMemo, useState } from 'react'

import { loadWorkspaceProfile, mapAccount } from '../data/loadWorkspace'

export interface StoreDirectoryOption {
  storeId: string
  slug: string
  company: string
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

function buildOptionLabel(company: string, slug: string, fallback: string): string {
  const trimmedCompany = company.trim()
  const slugLabel = slug.trim() || fallback

  if (trimmedCompany) {
    return `${trimmedCompany} (${slugLabel})`
  }

  if (slugLabel) {
    return slugLabel
  }

  return fallback
}

function fallbackOption(storeId: string): StoreDirectoryOption {
  const label = buildOptionLabel(storeId, storeId, storeId)
  return { storeId, slug: storeId, company: storeId, label }
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
              const workspace = await loadWorkspaceProfile({ slug: storeId, storeId })
              if (!workspace) {
                return fallbackOption(storeId)
              }

              const profile = mapAccount(workspace)
              const slug = profile.slug ?? storeId
              const company = profile.company ?? profile.displayName ?? slug
              const resolvedCompany = company ?? slug
              const label = buildOptionLabel(resolvedCompany, slug, storeId)

              return { storeId, slug, company: resolvedCompany, label }
            } catch (innerError) {
              console.error('Failed to load store label', innerError)
              return fallbackOption(storeId)
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
      normalizedIds.map(storeId => directory[storeId] ?? fallbackOption(storeId)),
    [directory, normalizedIds],
  )

  return { options, loading, error }
}
