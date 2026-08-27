import { describe, expect, test } from 'vitest'
import { buildEventPdfDocument, pdfSafeText, wrapPdfText } from './eventPdfDocument'

describe('event PDF document builder', () => {
  test('normalizes unsupported punctuation for core PDF fonts', () => {
    expect(pdfSafeText('Décor — Sandra’s “event”')).toBe("Decor - Sandra's \"event\"")
  })

  test('wraps long content without losing words', () => {
    const lines = wrapPdfText('one two three four five six seven eight', 12)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toContain('one two three')
    expect(lines.join(' ')).toContain('seven eight')
  })

  test('creates a valid multi-page event pack', () => {
    const entries = Array.from({ length: 180 }, (_, index) => ({
      text: `Checklist item ${index + 1}: confirm vendor responsibility and event-day readiness before the client arrival.`,
      style: 'bullet' as const,
    }))

    const pdf = buildEventPdfDocument({
      title: 'Sandra & Kojo Wedding - Event Pack',
      subtitle: 'Elite Core Events | Client: Sandra Asante',
      reference: 'ECE-2026-12345',
      sections: [
        { title: 'Event summary', entries: [{ text: 'Venue: Accra' }] },
        { title: 'Planning checklist', entries, pageBreakBefore: true },
      ],
    })

    const text = new TextDecoder('latin1').decode(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('PLANNING CHECKLIST')
    expect(text).toMatch(/\/Count [2-9]/)
  })
})
