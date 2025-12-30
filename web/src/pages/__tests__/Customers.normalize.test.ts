import { describe, expect, it } from 'vitest'

import { normalizePhoneNumber } from '../Customers'

describe('normalizePhoneNumber', () => {
  it('normalizes local Ghana numbers into E.164 format', () => {
    expect(normalizePhoneNumber('0245022743')).toBe('+233245022743')
  })

  it('keeps leading zeros when a plus prefix is present', () => {
    expect(normalizePhoneNumber('+00245022743')).toBe('+00245022743')
  })

  it('strips formatting characters while normalizing to E.164', () => {
    expect(normalizePhoneNumber('0 245-022-743')).toBe('+233245022743')
  })

  it('returns an empty string when no digits are provided', () => {
    expect(normalizePhoneNumber(' ( ) ')).toBe('')
  })

  it('adds a plus prefix when a country code is present without one', () => {
    expect(normalizePhoneNumber('233245022743')).toBe('+233245022743')
  })
})
