import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { getOnboardingStatus, setOnboardingStatus } from '../utils/onboarding'

export function useOnboardingRedirect(user: User | null) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!user) return
    let status = getOnboardingStatus(user.uid)
    if (!status) {
      status = 'pending'
      setOnboardingStatus(user.uid, 'pending')
    }
    if (status === 'pending' && location.pathname !== '/onboarding') {
      navigate('/onboarding', { replace: true })
    }
  }, [location.pathname, navigate, user])
}
