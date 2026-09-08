import { describe, expect, test } from 'vitest'
import { EVENT_TYPES, getEventProductionTemplate } from './eventProductionTemplates'
import {
  calculateProductionReadiness,
  clockFromOffset,
  getProductionTimelinePreset,
  nextProductionItem,
} from './eventProductionOperations'

describe('event production operations', () => {
  test.each(EVENT_TYPES)('provides a useful run-sheet preset for %s', eventType => {
    const preset = getProductionTimelinePreset(eventType)
    expect(preset.length).toBeGreaterThanOrEqual(5)
    expect(preset.every(item => item.activity.trim().length > 0)).toBe(true)
  })

  test('builds timeline clock values around the registered start time', () => {
    expect(clockFromOffset('18:00', -90)).toBe('16:30')
    expect(clockFromOffset('00:30', -60)).toBe('23:30')
    expect(clockFromOffset('23:30', 90)).toBe('01:00')
  })

  test('production readiness increases when setup and run sheet are complete', () => {
    const template = getEventProductionTemplate('Birthday')
    const empty = calculateProductionReadiness({
      eventDate: '2026-12-05',
      startTime: '18:00',
      venue: 'Accra',
      guestCount: 100,
      fields: template.fields,
      setup: {},
      timeline: [],
      suggestedTimelineLength: getProductionTimelinePreset('Birthday').length,
    })
    const setup = Object.fromEntries(template.fields.map(field => [field.key, 'set']))
    const timeline = getProductionTimelinePreset('Birthday').map((item, index) => ({
      time: clockFromOffset('18:00', item.offsetMinutes),
      coordinator: `Coordinator ${index + 1}`,
      contactNumber: '',
      progressStatus: 'planned',
    }))
    const ready = calculateProductionReadiness({
      eventDate: '2026-12-05',
      startTime: '18:00',
      venue: 'Accra',
      guestCount: 100,
      fields: template.fields,
      setup,
      timeline,
      suggestedTimelineLength: timeline.length,
    })
    expect(empty.score).toBeLessThan(ready.score)
    expect(ready.score).toBe(100)
    expect(ready.missing).toEqual([])
  })

  test('selects a different next item as wall time crosses a boundary', () => {
    const rows = [
      { time: '09:00', progressStatus: 'done', sortOrder: 1 },
      { time: '12:00', progressStatus: 'planned', sortOrder: 2 },
      { time: '15:00', progressStatus: 'planned', sortOrder: 3 },
    ]
    expect(nextProductionItem(rows, new Date(2026, 8, 8, 11, 50), '2026-09-08', '09:00')?.time).toBe('12:00')
    expect(nextProductionItem(rows, new Date(2026, 8, 8, 12, 30), '2026-09-08', '09:00')?.time).toBe('15:00')
  })

  test('does not resurface completed rows when the run sheet is finished', () => {
    const rows = [
      { time: '09:00', progressStatus: 'done', sortOrder: 1 },
      { time: '12:00', progressStatus: 'done', sortOrder: 2 },
    ]
    expect(nextProductionItem(rows, new Date(2026, 8, 8, 13, 0), '2026-09-08', '09:00')).toBeNull()
  })

  test('preserves run-sheet ordering across midnight', () => {
    const rows = [
      { time: '22:00', progressStatus: 'done', sortOrder: 1 },
      { time: '00:00', progressStatus: 'planned', sortOrder: 2 },
      { time: '01:30', progressStatus: 'planned', sortOrder: 3 },
    ]
    expect(nextProductionItem(rows, new Date(2026, 8, 8, 23, 0), '2026-09-08', '22:00')?.time).toBe('00:00')
    expect(nextProductionItem(rows, new Date(2026, 8, 9, 0, 30), '2026-09-08', '22:00')?.time).toBe('01:30')
  })

  test('anchors pre-midnight setup to the previous day for early-morning events', () => {
    const rows = [
      { time: '22:00', progressStatus: 'planned', sortOrder: 1 },
      { time: '00:30', progressStatus: 'planned', sortOrder: 2 },
      { time: '01:00', progressStatus: 'planned', sortOrder: 3 },
    ]
    expect(nextProductionItem(rows, new Date(2026, 8, 7, 23, 0), '2026-09-08', '01:00')?.time).toBe('00:30')
  })
})
