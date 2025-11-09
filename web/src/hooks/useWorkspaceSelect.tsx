import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react'

const WORKSPACE_STORAGE_KEY = 'sedifex.workspace'

type WorkspaceSelectContextValue = {
  workspaceSlug: string | null
  setWorkspaceSlug: (slug: string | null) => void
}

const WorkspaceSelectContext = createContext<WorkspaceSelectContextValue | undefined>(undefined)

function getStoredWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const params = new URLSearchParams(window.location.search)
    const slugFromQuery = params.get('workspace')
    if (slugFromQuery) {
      window.localStorage?.setItem(WORKSPACE_STORAGE_KEY, slugFromQuery)
      return slugFromQuery
    }

    return window.localStorage?.getItem(WORKSPACE_STORAGE_KEY) ?? null
  } catch (error) {
    console.warn('[WorkspaceSelect] Unable to read workspace slug', error)
    return null
  }
}

export function WorkspaceSelectProvider({ children }: { children: React.ReactNode }) {
  const [workspaceSlug, setWorkspaceSlugState] = useState<string | null>(() => getStoredWorkspaceSlug())

  useEffect(() => {
    if (workspaceSlug !== null) {
      return
    }

    // Lazily hydrate when state initializes to null during SSR or first render.
    const slug = getStoredWorkspaceSlug()
    if (slug !== workspaceSlug) {
      setWorkspaceSlugState(slug)
    }
  }, [workspaceSlug])

  const setWorkspaceSlug = useCallback((slug: string | null) => {
    setWorkspaceSlugState(slug)

    if (typeof window === 'undefined') {
      return
    }

    try {
      if (slug) {
        window.localStorage?.setItem(WORKSPACE_STORAGE_KEY, slug)
      } else {
        window.localStorage?.removeItem(WORKSPACE_STORAGE_KEY)
      }
    } catch (error) {
      console.warn('[WorkspaceSelect] Unable to persist workspace slug', error)
    }
  }, [])

  const value = useMemo(
    () => ({
      workspaceSlug,
      setWorkspaceSlug,
    }),
    [workspaceSlug, setWorkspaceSlug],
  )

  return (
    <WorkspaceSelectContext.Provider value={value}>
      {children}
    </WorkspaceSelectContext.Provider>
  )
}

export function useWorkspaceSelect() {
  const context = useContext(WorkspaceSelectContext)
  if (!context) {
    throw new Error('useWorkspaceSelect must be used within a WorkspaceSelectProvider')
  }
  return context
}

export function useSelectedWorkspaceSlug() {
  return useWorkspaceSelect().workspaceSlug
}
