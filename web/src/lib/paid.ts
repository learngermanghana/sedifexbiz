// web/src/lib/paid.ts
const STORAGE_KEY = 'sfx_paid_plan'

export type PaidMarker = {
  plan: 'starter' | 'pro' | 'enterprise' | string
  at: number // epoch millis
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
      return null
    }

    return window.localStorage
  } catch (error) {
    console.warn('[paid] Unable to access localStorage', error)
    return null
  }
}

export function markPaid(plan: PaidMarker['plan']) {
  const storage = getStorage()
  if (!storage) return

  const marker: PaidMarker = { plan, at: Date.now() }
  storage.setItem(STORAGE_KEY, JSON.stringify(marker))
}

export function getPaidMarker(): PaidMarker | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as PaidMarker | null
    if (!parsed || typeof parsed.plan !== 'string' || typeof parsed.at !== 'number') {
      return null
    }

    return parsed
  } catch (error) {
    console.warn('[paid] Failed to parse payment marker', error)
    return null
  }
}

export function hasRecentPayment(maxAgeHours = 48): boolean {
  const marker = getPaidMarker()
  if (!marker) return false

  const ageMs = Date.now() - marker.at
  return ageMs <= maxAgeHours * 60 * 60 * 1000
}

export function clearPaidMarker() {
  const storage = getStorage()
  if (!storage) return

  storage.removeItem(STORAGE_KEY)
}
