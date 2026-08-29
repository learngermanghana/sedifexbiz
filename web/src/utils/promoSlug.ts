const RESERVED_PUBLIC_SLUGS = new Set([
  '',
  'account',
  'billing',
  'close-day',
  'cookies',
  'customer-display',
  'customers',
  'dashboard',
  'data-transfer',
  'display',
  'docs',
  'expenses',
  'finance',
  'inventory-system-ghana',
  'legal',
  'logi',
  'onboarding',
  'privacy',
  'products',
  'promo',
  'receipt',
  'refund',
  'reset-password',
  'sell',
  'staff',
  'support',
  'verify-email',
])

export function normalizePromoSlug(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || null
}

export function isReservedPublicSlug(value: string): boolean {
  const normalized = normalizePromoSlug(value)
  if (!normalized) return true
  return RESERVED_PUBLIC_SLUGS.has(normalized)
}

function isOpaqueIdLikeSlug(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length < 20) return false
  if (!/^[a-z0-9]+$/.test(trimmed)) return false
  return /[a-z]/.test(trimmed) && /[0-9]/.test(trimmed)
}

export function buildPromoSlug(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (!candidate) continue
    if (isOpaqueIdLikeSlug(candidate)) continue
    const normalized = normalizePromoSlug(candidate)
    if (!normalized) continue
    if (!isReservedPublicSlug(normalized)) return normalized
    const suffixed = normalizePromoSlug(`${normalized}-store`)
    if (suffixed && !isReservedPublicSlug(suffixed)) return suffixed
  }
  return 'store'
}
