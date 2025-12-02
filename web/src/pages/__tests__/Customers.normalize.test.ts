import { describe, expect, it } from 'vitest'

import { normalizePhoneNumber } from '../Customers'

describe('normalizePhoneNumber', () => {
  it('preserves leading zeros for local numbers', () => {
    expect(normalizePhoneNumber('0245022743')).toBe('0245022743')
  })

  it('keeps leading zeros when a plus prefix is present', () => {
    expect(normalizePhoneNumber('+00245022743')).toBe('+00245022743')
  })

  it('strips formatting characters without removing leading zeros', () => {
    expect(normalizePhoneNumber('0 245-022-743')).toBe('0245022743')
  })

  it('returns an empty string when no digits are provided', () => {
    expect(normalizePhoneNumber(' ( ) ')).toBe('')
  })
})
