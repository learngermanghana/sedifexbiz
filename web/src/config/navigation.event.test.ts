import { describe, expect, it } from 'vitest'
import { INDUSTRY_ENABLED_MODULE_PRESETS, resolveNavigation } from './navigation'

describe('event business navigation preset', () => {
  it('keeps the default event sidebar focused and ordered', () => {
    const items = resolveNavigation({
      role: 'owner',
      workspaceProfile: {
        industry: 'event',
        labelPolicy: 'industry_aliases',
        enabledModules: [],
      },
    })

    expect(INDUSTRY_ENABLED_MODULE_PRESETS.event).toEqual([
      'events',
      'customers',
      'invoices',
      'bulk-email',
    ])
    expect(items.map(item => item.id)).toEqual([
      'events',
      'customers',
      'invoices',
      'bulk-email',
      'account',
    ])
    expect(items.find(item => item.id === 'events')?.label).toBe('Event Management')
    expect(items.find(item => item.id === 'bulk-email')?.label).toBe('Email')
  })
})
