import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(dirname, '../components/EventProductionTimeline.tsx'), 'utf8')

describe('event production Firebase cost regressions', () => {
  test('only performs the full event/timeline load from the mount effect', () => {
    expect(source.match(/await load\(\)/g) || []).toHaveLength(0)
    expect(source.match(/void load\(\)/g) || []).toHaveLength(1)
  })

  test('event-day wall-clock refresh stays browser-local', () => {
    expect(source).toContain('window.setInterval(() => setEventDayClock(new Date()), 15_000)')
  })
})
