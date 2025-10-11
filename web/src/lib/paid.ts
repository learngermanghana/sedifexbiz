// web/src/lib/paid.ts
const KEY = 'sfx_paid_plan'

export type PaidMarker = {
  plan: 'starter' | 'pro' | 'enterprise' | string
  at: number // epoch millis
}

export function markPaid(plan: PaidMarker['plan']) {
  const marker: PaidMarker = { plan, at: Date.now() }
  localStorage.setItem(KEY, JSON.stringify(marker))
}

export function getPaidMarker(): PaidMarker | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PaidMarker
    if (!parsed?.plan || !parsed?.at) return null
    return parsed
  } catch {
    return null
  }
}

export function hasRecentPayment(maxAgeHours = 48): boolean {
  const m = getPaidMarker()
  if (!m) return false
  const ageMs = Date.now() - m.at
  return ageMs <= maxAgeHours * 60 * 60 * 1000
}

export function clearPaidMarker() {
  localStorage.removeItem(KEY)
}
