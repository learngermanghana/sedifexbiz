import { getFunctions, httpsCallable } from 'firebase/functions'
import { useEffect } from 'react'
import { useAuthUser } from './useAuthUser'

export function useStoreBootstrap() {
  const user = useAuthUser()

  useEffect(() => {
    async function syncStoreAccess() {
      if (!user) return
      const functions = getFunctions()
      const resolveStoreAccessFn = httpsCallable(functions, 'resolveStoreAccess')
      try {
        await resolveStoreAccessFn({}) // ✅ Don’t pass user.uid
        console.log('[bootstrap] store access resolved')
      } catch (err) {
        console.error('[bootstrap] resolveStoreAccess failed', err)
      }
    }

    syncStoreAccess()
  }, [user])
}
