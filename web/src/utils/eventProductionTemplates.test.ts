import { describe, expect, test } from 'vitest'
import { EVENT_PRODUCTION_TEMPLATES, getEventProductionTemplate } from './eventProductionTemplates'

const REGISTERED_EVENT_TYPES = [
  'Traditional wedding',
  'White wedding',
  'Naming ceremony',
  'Funeral',
  'Corporate event',
  'Birthday',
  'Engagement',
  'Graduation',
  'Other',
]

describe('event production templates', () => {
  test.each(REGISTERED_EVENT_TYPES)('opens the matching template for %s', eventType => {
    expect(getEventProductionTemplate(eventType).eventType).toBe(eventType)
  })

  test('also supports the charity/community event workspace already used by Sedifex', () => {
    expect(getEventProductionTemplate('Charity / community').eventType).toBe('Charity / community')
  })

  test('detects common event type aliases', () => {
    expect(getEventProductionTemplate('Corporate Conference').eventType).toBe('Corporate event')
    expect(getEventProductionTemplate('Memorial Service').eventType).toBe('Funeral')
    expect(getEventProductionTemplate('Christening').eventType).toBe('Naming ceremony')
    expect(getEventProductionTemplate('Community Fundraiser').eventType).toBe('Charity / community')
  })

  test('falls back to the flexible general template for an unknown event type', () => {
    expect(getEventProductionTemplate('Product launch party').eventType).toBe('Other')
  })

  test('non-wedding templates do not expose bride or groom production fields', () => {
    const nonWeddingTypes = ['Naming ceremony', 'Funeral', 'Corporate event', 'Birthday', 'Graduation', 'Charity / community', 'Other']
    nonWeddingTypes.forEach(eventType => {
      const labels = EVENT_PRODUCTION_TEMPLATES[eventType].fields.map(field => field.label.toLowerCase()).join(' ')
      expect(labels).not.toContain('bride')
      expect(labels).not.toContain('groom')
      expect(labels).not.toContain('bridal')
    })
  })
})
