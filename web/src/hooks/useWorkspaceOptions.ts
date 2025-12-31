import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useMemberships, type Membership } from './useMemberships'
import { extractWorkspaceName } from '../utils/workspaceName'

export type WorkspaceOption = {
  storeId: string
  name: string | null
  role: Membership['role']
}

export function useWorkspaceOptions() {
  const { memberships, loading, error } = useMemberships()
  const [options, setOptions] = useState<WorkspaceOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadOptions() {
      if (loading) {
        setLoadingOptions(true)
        return
      }

      const entries = memberships
        .map(member => ({
          role: member.role,
          storeId: typeof member.storeId === 'string' ? member.storeId.trim() : '',
        }))
        .filter(member => member.storeId)

      if (entries.length === 0) {
        if (!cancelled) {
          setOptions([])
          setLoadingOptions(false)
        }
        return
      }

      setLoadingOptions(true)

      try {
        const results = await Promise.all(
          entries.map(async entry => {
            const workspaceRef = doc(db, 'workspaces', entry.storeId)
            const storeRef = doc(db, 'stores', entry.storeId)
            const [workspaceSnap, storeSnap] = await Promise.all([
              getDoc(workspaceRef),
              getDoc(storeRef),
            ])

            const name =
              extractWorkspaceName(workspaceSnap.data()) ??
              extractWorkspaceName(storeSnap.data())

            return {
              storeId: entry.storeId,
              name,
              role: entry.role,
            }
          }),
        )

        if (!cancelled) {
          setOptions(results)
        }
      } catch {
        if (!cancelled) {
          setOptions([])
        }
      } finally {
        if (!cancelled) {
          setLoadingOptions(false)
        }
      }
    }

    loadOptions()

    return () => {
      cancelled = true
    }
  }, [loading, memberships])

  const sortedOptions = useMemo(
    () =>
      [...options].sort((a, b) => {
        const nameA = (a.name ?? a.storeId).toLowerCase()
        const nameB = (b.name ?? b.storeId).toLowerCase()
        return nameA.localeCompare(nameB)
      }),
    [options],
  )

  return {
    options: sortedOptions,
    loading: loading || loadingOptions,
    error,
  }
}
