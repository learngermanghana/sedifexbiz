import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from './useActiveStore'

type WorkspaceIdentityState = {
  name: string | null
  loading: boolean
}

function extractWorkspaceName(data: any): string | null {
  const candidates = [
    data?.company,
    data?.name,
    data?.companyName,
    data?.storeName,
    data?.businessName,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

export function useWorkspaceIdentity(): WorkspaceIdentityState {
  const { storeId } = useActiveStore()
  const [state, setState] = useState<WorkspaceIdentityState>({
    name: null,
    loading: true,
  })

  useEffect(() => {
    if (!storeId) {
      setState({ name: null, loading: false })
      return
    }

    setState(prev => ({ ...prev, loading: true }))

    const refs = [doc(db, 'stores', storeId), doc(db, 'workspaces', storeId)]

    const unsubscribers = refs.map(ref =>
      onSnapshot(
        ref,
        snapshot => {
          const name = extractWorkspaceName(snapshot.data())

          setState(prev => ({
            name: name ?? prev.name ?? null,
            loading: false,
          }))
        },
        () =>
          setState(prev => ({
            name: prev.name ?? null,
            loading: false,
          })),
      ),
    )

    return () => {
      unsubscribers.forEach(unsub => unsub())
    }
  }, [storeId])

  return state
}
