import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { INDUSTRY_ENABLED_MODULE_PRESETS, NAV_ITEMS, type Industry } from '../config/navigation'
import type { StorePreferences } from '../hooks/useStorePreferences'
import MarketplaceCatalogSyncCard from './MarketplaceCatalogSyncCard'

type Props = {
  preferences: StorePreferences['navigation']
  onSave: (navigation: StorePreferences['navigation']) => Promise<void>
  canEdit: boolean
}

type ValidationError = string | null

type PageGroup = {
  title: string
  ids: string[]
}

const INDUSTRY_OPTIONS: Array<{ value: Industry; label: string }> = [
  { value: 'shop', label: 'Retail / Shop' },
  { value: 'travel', label: 'Travel' },
  { value: 'ngo', label: 'NGO' },
  { value: 'school', label: 'School' },
  { value: 'event', label: 'Event Planning / Coordination' },
]

const PAGE_GROUPS: PageGroup[] = [
  { title: 'Daily work', ids: ['dashboard', 'reports', 'products', 'sell', 'marketplace-orders', 'customers', 'bookings'] },
  { title: 'Documents, payments & expenses', ids: ['quick-pay', 'invoices', 'receipts', 'expenses', 'settlement', 'donor-management', 'funds-ledger'] },
  { title: 'Bookings, registration & cases', ids: ['upcoming-events', 'student-registration', 'volunteers', 'support-requests'] },
  { title: 'Website & marketing', ids: ['integrations', 'automations', 'website-builder', 'blog', 'bulk-messaging', 'bulk-email'] },
  { title: 'Account', ids: ['account'] },
]

const CONFIGURABLE_NAV_ITEMS = NAV_ITEMS.filter(item => !item.hideFromPrimaryNav)

function uniqueList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function effectiveModules(industry: Industry, enabledModules: string[]) {
  const selected = enabledModules.length > 0
    ? enabledModules
    : INDUSTRY_ENABLED_MODULE_PRESETS[industry] ?? []
  return uniqueList([...selected, 'account'])
}

function moduleSummary(enabledModules: string[]) {
  const count = CONFIGURABLE_NAV_ITEMS.filter(item => enabledModules.includes(item.id)).length
  return `${count} ${count === 1 ? 'page' : 'pages'} active`
}

function findNavItem(id: string) {
  return CONFIGURABLE_NAV_ITEMS.find(item => item.id === id)
}

export default function NavigationSettingsSection({ preferences, onSave, canEdit }: Props) {
  const [draft, setDraft] = useState({
    ...preferences,
    enabledModules: Array.isArray(preferences.enabledModules) ? preferences.enabledModules : [],
    customNavItems: [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ValidationError>(null)

  useEffect(() => {
    setDraft({
      ...preferences,
      enabledModules: Array.isArray(preferences.enabledModules) ? preferences.enabledModules : [],
      customNavItems: [],
    })
  }, [preferences])

  const selectedIndustry = INDUSTRY_OPTIONS.find(option => option.value === draft.industry) ?? INDUSTRY_OPTIONS[0]

  const enabledModuleIds = useMemo(
    () => effectiveModules(draft.industry, draft.enabledModules),
    [draft.enabledModules, draft.industry],
  )

  const enabledModulesByIndustry = useMemo(() => new Set(INDUSTRY_ENABLED_MODULE_PRESETS[draft.industry] ?? []), [draft.industry])

  const ungroupedItems = useMemo(() => {
    const groupedIds = new Set(PAGE_GROUPS.flatMap(group => group.ids))
    return CONFIGURABLE_NAV_ITEMS.filter(item => !groupedIds.has(item.id))
  }, [])

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      await onSave({
        ...draft,
        enabledModules: uniqueList(draft.enabledModules),
        customNavItems: [],
      })
    } finally {
      setSaving(false)
    }
  }

  const applyIndustryTemplate = (industry: Industry) => {
    setDraft(current => ({
      ...current,
      industry,
      enabledModules: uniqueList(INDUSTRY_ENABLED_MODULE_PRESETS[industry] ?? []),
      customNavItems: [],
    }))
    setError(null)
  }

  const toggleModule = (id: string) => {
    if (id === 'account') return
    setDraft(current => {
      const currentEnabled = effectiveModules(current.industry, current.enabledModules)
      const enabled = currentEnabled.includes(id) ? currentEnabled.filter(item => item !== id) : [...currentEnabled, id]
      return { ...current, enabledModules: uniqueList(enabled), customNavItems: [] }
    })
  }

  const resetToTemplate = () => {
    setDraft(current => ({ ...current, enabledModules: uniqueList(INDUSTRY_ENABLED_MODULE_PRESETS[current.industry] ?? []), customNavItems: [] }))
    setError(null)
  }

  const showAllPages = () => {
    setDraft(current => ({ ...current, enabledModules: CONFIGURABLE_NAV_ITEMS.map(item => item.id), customNavItems: [] }))
    setError(null)
  }

  const hideAllPages = () => {
    setDraft(current => ({ ...current, enabledModules: ['account'], customNavItems: [] }))
    setError('All optional pages are hidden. Account stays available so you can change navigation later.')
  }

  const renderPageRow = (item: typeof NAV_ITEMS[number]) => {
    const checked = enabledModuleIds.includes(item.id)
    const recommended = enabledModulesByIndustry.has(item.id)
    const isAccount = item.id === 'account'
    return (
      <div key={item.id} className="account-overview__integration-key-item">
        <label style={{ alignItems: 'center', display: 'flex', flex: 1, gap: 12, margin: 0 }}>
          <input type="checkbox" disabled={!canEdit || isAccount} checked={checked} onChange={() => toggleModule(item.id)} />
          <span>
            <Link to={item.target} style={{ color: 'inherit', fontWeight: 700, textDecoration: 'none' }}>{item.label}</Link>
            {isAccount ? <small className="account-overview__hint" style={{ display: 'block' }}>Always available to workspace owners</small> : recommended ? <small className="account-overview__hint" style={{ display: 'block' }}>Recommended for {selectedIndustry.label}</small> : null}
          </span>
        </label>
        <Link className="button button--secondary" to={item.target}>Open</Link>
      </div>
    )
  }

  return <section aria-labelledby="account-nav-settings" className="account-overview__nav-settings">
    <div className="account-overview__section-header">
      <h2 id="account-nav-settings">Navigation settings</h2>
      <p className="account-overview__subtitle">
        Sedifex starts with recommended pages for your selected business type. Tick more pages whenever you need them, or remove optional pages to keep the sidebar focused.
      </p>
    </div>

    <MarketplaceCatalogSyncCard canSync={canEdit} />

    <div className="account-overview__form-grid">
      <label><span>Business type</span>
        <select value={draft.industry} disabled={!canEdit} onChange={event => applyIndustryTemplate(event.target.value as Industry)}>
          {INDUSTRY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <small className="account-overview__hint">Changing business type selects its recommended pages automatically. You can customize them here at any time.</small>
      </label>
      <div className="account-overview__card" role="status">
        <strong>{moduleSummary(enabledModuleIds)}</strong>
        <p className="account-overview__hint">Only selected pages show in the sidebar. Account remains available so you can always return to Navigation settings.</p>
      </div>
    </div>

    <div className="account-overview__website-sync-actions">
      <button type="button" className="button button--secondary" disabled={!canEdit} onClick={resetToTemplate}>Use recommended pages</button>
      <button type="button" className="button button--secondary" disabled={!canEdit} onClick={showAllPages}>Show all pages</button>
      <button type="button" className="button button--ghost" disabled={!canEdit} onClick={hideAllPages}>Hide optional pages</button>
    </div>

    <div className="account-overview__nav-groups">
      {PAGE_GROUPS.map(group => {
        const groupItems = group.ids.map(findNavItem).filter(Boolean) as typeof NAV_ITEMS
        if (groupItems.length === 0) return null
        return <div className="account-overview__card" key={group.title}>
          <h3>{group.title}</h3>
          <div className="account-overview__toggle-list">
            {groupItems.map(renderPageRow)}
          </div>
        </div>
      })}

      {ungroupedItems.length ? <div className="account-overview__card">
        <h3>Other pages</h3>
        <div className="account-overview__toggle-list">
          {ungroupedItems.map(renderPageRow)}
        </div>
      </div> : null}
    </div>

    {error && <p className="account-overview__error-text">{error}</p>}
    {canEdit && <button type="button" className="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save navigation settings'}</button>}
  </section>
}
