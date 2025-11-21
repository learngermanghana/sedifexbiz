export type OnboardingStatus = 'pending' | 'completed'

const STORAGE_KEY = 'sedifex.onboardingStatus'

function isStorageAvailable() {
  if (typeof window === 'undefined') return false
  try {
    const key = '__storage_test__'
    window.localStorage.setItem(key, 'ok')
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function getUserKey(userId: string) {
  return `${STORAGE_KEY}.${userId}`
}

export function getOnboardingStatus(userId: string | null) {
  if (!userId || !isStorageAvailable()) return null
  const value = window.localStorage.getItem(getUserKey(userId))
  if (value === 'pending' || value === 'completed') return value
  return null
}

export function setOnboardingStatus(userId: string, status: OnboardingStatus) {
  if (!userId || !isStorageAvailable()) return
  window.localStorage.setItem(getUserKey(userId), status)
}
