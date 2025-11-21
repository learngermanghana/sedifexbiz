const STORAGE_KEY = 'sedifex.activeStore'

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

export function getActiveStoreIdForUser(userId: string | null | undefined) {
  if (!userId || !isStorageAvailable()) return null
  const value = window.localStorage.getItem(getUserKey(userId))
  return value && value.trim() ? value.trim() : null
}

export function persistActiveStoreIdForUser(userId: string, storeId: string) {
  if (!userId || !storeId || !isStorageAvailable()) return
  window.localStorage.setItem(getUserKey(userId), storeId)
}
