import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from './useActiveStore'
import { extractWorkspaceName } from '../utils/workspaceName'

type WorkspaceIdentityState = {
  name: string | null
  loading: boolean
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
