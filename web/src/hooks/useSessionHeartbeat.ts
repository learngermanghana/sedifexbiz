import { useEffect } from 'react'
import type { User } from 'firebase/auth'
import { refreshSessionHeartbeat } from '../controllers/sessionController'

export function useSessionHeartbeat(user: User | null) {
  useEffect(() => {
    if (!user) return
    refreshSessionHeartbeat(user).catch(error => {
      console.warn('[session] Unable to refresh session', error)
    })
  }, [user])
}
