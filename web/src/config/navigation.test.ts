import { describe, expect, it } from 'vitest'
import { INDUSTRY_ENABLED_MODULE_PRESETS, resolveNavigation } from './navigation'

describe('resolveNavigation', () => {
  it('uses the selected industry preset when no enabled modules are stored', () => {
    const items = resolveNavigation({
      role: 'owner',
      workspaceProfile: {
        industry: 'ngo',
        labelPolicy: 'industry_aliases',
        enabledModules: [],
      },
    })

    expect(items.map(item => item.id)).toContain('volunteers')
    expect(items.map(item => item.id)).not.toContain('sell')
  })

  it('keeps Automations hidden until the owner enables it', () => {
    const hidden = resolveNavigation({
      role: 'owner',
      workspaceProfile: {
        industry: 'shop',
        labelPolicy: 'shared',
        enabledModules: ['dashboard', 'products'],
      },
    })
    expect(hidden.map(item => item.id)).not.toContain('automations')

    const enabled = resolveNavigation({
      role: 'owner',
      workspaceProfile: {
        industry: 'shop',
        labelPolicy: 'shared',
        enabledModules: ['dashboard', 'products', 'automations'],
      },
    })
    expect(enabled.map(item => item.id)).toContain('automations')
  })

  it('applies industry preset aliases, module toggles, custom items, role and permissions', () => {
    const items = resolveNavigation({
      role: 'staff',
      permissions: ['view_reports'],
      workspaceProfile: {
        industry: 'travel',
        labelPolicy: 'industry_aliases',
        enabledModules: ['sell', 'customers', 'blog'],
        customNavItems: [
          {
            id: 'reports',
            label: ' Reports ',
            type: 'internal',
            target: '/reports',
            sort_order: 5,
            roles_allowed: ['staff'],
            required_permissions: ['view_reports'],
          },
          {
            id: 'admin',
            label: 'Admin',
            type: 'internal',
            target: '/admin',
            sort_order: 1,
            roles_allowed: ['staff'],
            required_permissions: ['manage_admin'],
          },
        ],
      },
    })

    expect(items.map(item => item.id)).toEqual(['reports', 'sell', 'customers', 'blog'])
    expect(items.find(item => item.id === 'customers')?.label).toBe('Customers')
  })

  it('prefers custom labels over industry aliases', () => {
    const items = resolveNavigation({
      role: 'owner',
      workspaceProfile: {
        industry: 'school',
        labelPolicy: 'industry_aliases',
        customLabels: {
          '/customers': 'Learners',
        },
      },
    })

    expect(items.find(item => item.target === '/customers')?.label).toBe('Learners')
    expect(items.find(item => item.target === '/bookings')?.label).toBe('Classes')
  })

  it('groups website content behind the website builder nav item', () => {
    const items = resolveNavigation({
      role: 'staff',
      workspaceProfile: {
        industry: 'shop',
        labelPolicy: 'shared',
        enabledModules: ['promo', 'gallery', 'website-hero-slides', 'social-links'],
      },
    })

    expect(items.map(item => item.id)).toEqual(['website-builder'])
    expect(items[0].target).toBe('/website-builder')
  })

  it('keeps signup presets focused on the selected business type', () => {
    expect(INDUSTRY_ENABLED_MODULE_PRESETS.shop).toEqual([
      'dashboard',
      'products',
      'sell',
      'marketplace-orders',
      'invoices',
      'receipts',
      'customers',
    ])
    expect(INDUSTRY_ENABLED_MODULE_PRESETS.travel).toEqual([
      'dashboard',
      'customers',
      'bookings',
      'upcoming-events',
      'invoices',
      'receipts',
    ])
    expect(INDUSTRY_ENABLED_MODULE_PRESETS.ngo).toEqual([
      'dashboard',
      'customers',
      'bookings',
      'upcoming-events',
      'donor-management',
      'funds-ledger',
      'volunteers',
    ])
    expect(INDUSTRY_ENABLED_MODULE_PRESETS.school).toEqual([
      'dashboard',
      'students',
      'customers',
      'bookings',
      'upcoming-events',
      'student-registration',
      'invoices',
    ])
    expect(INDUSTRY_ENABLED_MODULE_PRESETS.event).toEqual([
      'dashboard',
      'events',
      'customers',
      'invoices',
      'reports',
      'bulk-email',
    ])
  })

  it('leaves advanced pages available for opt-in instead of enabling them at signup', () => {
    for (const industry of ['shop', 'travel', 'ngo', 'school'] as const) {
      expect(INDUSTRY_ENABLED_MODULE_PRESETS[industry]).not.toContain('reports')
      expect(INDUSTRY_ENABLED_MODULE_PRESETS[industry]).not.toContain('integrations')
      expect(INDUSTRY_ENABLED_MODULE_PRESETS[industry]).not.toContain('automations')
      expect(INDUSTRY_ENABLED_MODULE_PRESETS[industry]).not.toContain('website-builder')
      expect(INDUSTRY_ENABLED_MODULE_PRESETS[industry]).not.toContain('bulk-email')
      expect(INDUSTRY_ENABLED_MODULE_PRESETS[industry]).not.toContain('bulk-messaging')
    }
  })
})
