import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import {
  fetchOnboardingStatus,
  getOnboardingStatus,
  setOnboardingStatus,
} from '../utils/onboarding'

export function useOnboardingRedirect(user: User | null) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!user) return

    let isActive = true

    const run = async () => {
      const status =
        (await fetchOnboardingStatus(user.uid)) ?? getOnboardingStatus(user.uid) ?? 'pending'

      if (!isActive) return

      await setOnboardingStatus(user.uid, status)

      if (status === 'pending' && location.pathname !== '/onboarding') {
        navigate('/onboarding', { replace: true })
      }
    }

    void run()

    return () => {
      isActive = false
    }
  }, [location.pathname, navigate, user])
}
