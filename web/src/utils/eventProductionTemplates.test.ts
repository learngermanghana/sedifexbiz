import { describe, expect, test } from 'vitest'
import { EVENT_PRODUCTION_TEMPLATES, EVENT_TYPES, getEventProductionTemplate } from './eventProductionTemplates'

describe('event production templates', () => {
  test.each(EVENT_TYPES)('opens the matching template for %s', eventType => {
    expect(getEventProductionTemplate(eventType).eventType).toBe(eventType)
    expect(EVENT_PRODUCTION_TEMPLATES[eventType]).toBeDefined()
  })

  test('detects common event type aliases', () => {
    expect(getEventProductionTemplate('Memorial Service').eventType).toBe('Funeral')
    expect(getEventProductionTemplate('Christening').eventType).toBe('Naming ceremony')
    expect(getEventProductionTemplate('Outdooring').eventType).toBe('Naming ceremony')
    expect(getEventProductionTemplate('Community Fundraiser').eventType).toBe('Charity / community')
    expect(getEventProductionTemplate('Business Product Launch').eventType).toBe('Corporate event')
    expect(getEventProductionTemplate('Professional Workshop').eventType).toBe('Conference / seminar')
    expect(getEventProductionTemplate('Church Crusade').eventType).toBe('Church / religious event')
    expect(getEventProductionTemplate('School Awards Day').eventType).toBe('School / educational event')
    expect(getEventProductionTemplate('Music Festival').eventType).toBe('Concert / entertainment')
    expect(getEventProductionTemplate('End of Year Party').eventType).toBe('Party / social event')
  })

  test('falls back to the flexible general template for an unknown event type', () => {
    expect(getEventProductionTemplate('Completely custom gathering').eventType).toBe('Other')
  })

  test('non-wedding templates do not expose bride or groom production fields', () => {
    const weddingRelated = new Set(['Traditional wedding', 'White wedding', 'Engagement'])
    EVENT_TYPES.filter(eventType => !weddingRelated.has(eventType)).forEach(eventType => {
      const labels = EVENT_PRODUCTION_TEMPLATES[eventType].fields.map(field => field.label.toLowerCase()).join(' ')
      expect(labels).not.toContain('bride')
      expect(labels).not.toContain('groom')
      expect(labels).not.toContain('bridal')
    })
  })
})
