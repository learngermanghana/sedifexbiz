import { buildPromoSlug, isReservedPublicSlug, normalizePromoSlug } from './promoSlug'

describe('promoSlug utils', () => {
  it('normalizes a human-readable store name', () => {
    expect(normalizePromoSlug(' Bright Mart ')).toBe('bright-mart')
  })

  it('treats reserved app routes as reserved slugs', () => {
    expect(isReservedPublicSlug('dashboard')).toBe(true)
    expect(isReservedPublicSlug('promo')).toBe(true)
  })

  it('builds fallback slug when preferred candidate is reserved', () => {
    expect(buildPromoSlug('dashboard', 'Bright Mart')).toBe('dashboard-store')
    expect(buildPromoSlug(null, 'Bright Mart')).toBe('bright-mart')
  })

  it('ignores opaque id-like candidates and prefers store names', () => {
    expect(buildPromoSlug('37mjqg20mjoriggaiaoouahdsgj1', 'Bright Mart')).toBe('bright-mart')
  })
})
