import React, { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import EventGuestList from '../components/EventGuestList'
import EventSeatingPlanner from '../components/EventSeatingPlanner'
import EventModuleIntegrations, { type EventIntegrationTab } from '../components/EventModuleIntegrations'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './EventWorkspace.css'
import './EventWorkspaceClientBrief.css'

type EventStatus = 'new' | 'planning' | 'awaiting_client' | 'confirmed' | 'completed' | 'cancelled'
type PlanningPackage = 'full_planning' | 'partial_planning' | 'coordination_only' | 'staffing_only'
type Complexity = 'standard' | 'moderate' | 'complex' | 'premium'
type PackagePricing = 'included' | 'optional' | 'additional'

type PackageItem = {
  id: string
  title: string
  category: string
  pricing: PackagePricing
  amount: number | null
  notes: string
}

type ClientBrief = {
  requirements: string
  themeColours: string
  venueRequirements: string
  catering: string
  decor: string
  entertainment: string
  photography: string
  transport: string
  accommodation: string
  specialInstructions: string
  packageItems: PackageItem[]
}

type EventRecord = {
  id: string
  eventCode: string
  title: string
  eventType: string
  clientName: string
  clientPhone: string
  clientEmail: string
  eventDate: string
  startTime: string
  venue: string
  guestCount: number
  planningPackage: PlanningPackage
  complexity: Complexity
  estimatedBudget: number | null
  status: EventStatus
  progress: number
  notes: string
  clientBrief: ClientBrief
}

type TabKey =
  | 'overview'
  | 'client-brief'
  | 'package'
  | 'checklist'
  | 'timeline'
  | 'program'
  | 'guest-list'
  | 'seating'
  | 'vendors'
  | 'staff'
  | 'finance'
  | 'documents'
  | 'messages'
  | 'evaluation'

type PlaceholderTab = Exclude<TabKey, 'overview' | 'client-brief' | 'package' | 'guest-list' | 'seating' | EventIntegrationTab>

const TABS: Array<{ key: TabKey; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Event summary and readiness' },
  { key: 'client-brief', label: 'Client Brief', description: 'Requirements, preferences and approvals' },
  { key: 'package', label: 'Package', description: 'Scope and package inclusions' },
  { key: 'checklist', label: 'Checklist', description: 'Planning tasks and deadlines' },
  { key: 'timeline', label: 'Timeline', description: 'Internal day-of run sheet' },
  { key: 'program', label: 'Program', description: 'Client-approved event program' },
  { key: 'guest-list', label: 'Guest List', description: 'RSVP and attendance management' },
  { key: 'seating', label: 'Seating', description: 'Tables, assignments and capacity' },
  { key: 'vendors', label: 'Vendors', description: 'Suppliers and commitments' },
  { key: 'staff', label: 'Staff', description: 'Team roles and assignments' },
  { key: 'finance', label: 'Finance', description: 'Budget, payments and expenses' },
  { key: 'documents', label: 'Documents', description: 'Contracts, invoices and files' },
  { key: 'messages', label: 'Messages', description: 'Client, vendor and staff communication' },
  { key: 'evaluation', label: 'Evaluation', description: 'Post-event reviews and feedback' },
]

const INTEGRATION_TABS: EventIntegrationTab[] = ['vendors', 'staff', 'finance', 'documents', 'messages']

const STATUS_LABELS: Record<EventStatus, string> = {
  new: 'New enquiry',
  planning: 'Planning',
  awaiting_client: 'Awaiting client',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const PACKAGE_LABELS: Record<PlanningPackage, string> = {
  full_planning: 'Full planning',
  partial_planning: 'Partial planning',
  coordination_only: 'Coordination only',
  staffing_only: 'Staffing only',
}

const COMPLEXITY_LABELS: Record<Complexity, string> = {
  standard: 'Standard',
  moderate: 'Moderate',
  complex: 'Complex',
  premium: 'Premium / highly complex',
}

const PACKAGE_PRICING_LABELS: Record<PackagePricing, string> = {
  included: 'Included',
  optional: 'Optional',
  additional: 'Additional cost',
}

const PACKAGE_ITEM_CATEGORIES = [
  'Planning',
  'Venue',
  'Catering',
  'Decor',
  'Entertainment',
  'Photography / Video',
  'Transport',
  'Accommodation',
  'Staffing',
  'Other',
]

const EMPTY_BRIEF: ClientBrief = {
  requirements: '',
  themeColours: '',
  venueRequirements: '',
  catering: '',
  decor: '',
  entertainment: '',
  photography: '',
  transport: '',
  accommodation: '',
  specialInstructions: '',
  packageItems: [],
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isStatus(value: unknown): value is EventStatus {
  return ['new', 'planning', 'awaiting_client', 'confirmed', 'completed', 'cancelled'].includes(String(value))
}

function isPackage(value: unknown): value is PlanningPackage {
  return ['full_planning', 'partial_planning', 'coordination_only', 'staffing_only'].includes(String(value))
}

function isComplexity(value: unknown): value is Complexity {
  return ['standard', 'moderate', 'complex', 'premium'].includes(String(value))
}

function isPackagePricing(value: unknown): value is PackagePricing {
  return ['included', 'optional', 'additional'].includes(String(value))
}

function mapPackageItem(value: unknown, index: number): PackageItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const title = text(item.title)
  if (!title) return null
  return {
    id: text(item.id) || `package-item-${index}`,
    title,
    category: text(item.category) || 'Other',
    pricing: isPackagePricing(item.pricing) ? item.pricing : 'included',
    amount: typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : null,
    notes: text(item.notes),
  }
}

function mapClientBrief(value: unknown): ClientBrief {
  if (!value || typeof value !== 'object') return { ...EMPTY_BRIEF, packageItems: [] }
  const brief = value as Record<string, unknown>
  const rawItems = Array.isArray(brief.packageItems) ? brief.packageItems : []
  return {
    requirements: text(brief.requirements),
    themeColours: text(brief.themeColours),
    venueRequirements: text(brief.venueRequirements),
    catering: text(brief.catering),
    decor: text(brief.decor),
    entertainment: text(brief.entertainment),
    photography: text(brief.photography),
    transport: text(brief.transport),
    accommodation: text(brief.accommodation),
    specialInstructions: text(brief.specialInstructions),
    packageItems: rawItems.map(mapPackageItem).filter((item): item is PackageItem => Boolean(item)),
  }
}

function mapEvent(id: string, data: Record<string, unknown>): EventRecord {
  return {
    id,
    eventCode: text(data.eventCode) || `EVT-${id.slice(0, 6).toUpperCase()}`,
    title: text(data.title) || 'Untitled event',
    eventType: text(data.eventType) || 'Other',
    clientName: text(data.clientName) || 'Client not assigned',
    clientPhone: text(data.clientPhone),
    clientEmail: text(data.clientEmail),
    eventDate: text(data.eventDate),
    startTime: text(data.startTime),
    venue: text(data.venue),
    guestCount: Math.max(0, Math.floor(numberValue(data.guestCount))),
    planningPackage: isPackage(data.planningPackage) ? data.planningPackage : 'full_planning',
    complexity: isComplexity(data.complexity) ? data.complexity : 'standard',
    estimatedBudget: typeof data.estimatedBudget === 'number' ? data.estimatedBudget : null,
    status: isStatus(data.status) ? data.status : 'new',
    progress: Math.max(0, Math.min(100, numberValue(data.progress, 0))),
    notes: text(data.notes),
    clientBrief: mapClientBrief(data.clientBrief),
  }
}

function formatDate(value: string) {
  if (!value) return 'Date not set'
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(value: number | null) {
  if (value === null) return 'Not set'
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(value)
}

function PlaceholderPanel({ tab }: { tab: PlaceholderTab }) {
  const meta = TABS.find(item => item.key === tab)!
  const hints: Record<PlaceholderTab, string[]> = {
    checklist: ['Planning tasks and owners', 'Due dates and priorities', 'Completion status feeding event readiness'],
    timeline: ['Vendor arrival times', 'Internal staff responsibilities', 'Minute-by-minute event-day run sheet'],
    program: ['Client-facing program outline', 'Approval status', 'Printable final program'],
    evaluation: ['Client satisfaction review', 'Vendor performance review', 'Internal team post-event evaluation'],
  }

  return (
    <section className="event-workspace__content-card workspace-card">
      <div className="event-workspace__empty-icon" aria-hidden="true">{meta.label.slice(0, 2).toUpperCase()}</div>
      <div>
        <p className="event-workspace__eyebrow">Workspace section</p>
        <h2>{meta.label}</h2>
        <p>{meta.description}. This section is part of the event workspace foundation and is ready for its event-specific workflow.</p>
        <ul className="event-workspace__hint-list">
          {hints[tab].map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </section>
  )
}

type BriefTextKey = Exclude<keyof ClientBrief, 'packageItems'>

function ClientBriefPanel({ brief, saving, onSave }: { brief: ClientBrief; saving: boolean; onSave: (brief: ClientBrief) => Promise<void> }) {
  const [draft, setDraft] = useState<ClientBrief>(() => ({ ...brief, packageItems: [...brief.packageItems] }))
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setDraft({ ...brief, packageItems: [...brief.packageItems] })
  }, [brief])

  function update(key: BriefTextKey, value: string) {
    setDraft(previous => ({ ...previous, [key]: value }))
  }

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    setMessage(null)
    try {
      await onSave({
        ...draft,
        requirements: draft.requirements.trim(),
        themeColours: draft.themeColours.trim(),
        venueRequirements: draft.venueRequirements.trim(),
        catering: draft.catering.trim(),
        decor: draft.decor.trim(),
        entertainment: draft.entertainment.trim(),
        photography: draft.photography.trim(),
        transport: draft.transport.trim(),
        accommodation: draft.accommodation.trim(),
        specialInstructions: draft.specialInstructions.trim(),
      })
      setMessage('Client brief saved.')
    } catch {
      setMessage('Could not save the client brief.')
    }
  }

  return (
    <section className="workspace-card event-workspace__editor-card">
      <header className="event-workspace__editor-heading">
        <div>
          <p className="event-workspace__eyebrow">Client brief</p>
          <h2>Requirements & preferences</h2>
          <p>Keep the client’s priorities separate from internal notes so the planning team can work from one agreed brief.</p>
        </div>
        <span className="event-workspace__editor-badge">Saved with this event</span>
      </header>

      {message ? <p className="event-workspace__editor-message">{message}</p> : null}

      <form onSubmit={submit}>
        <div className="event-workspace__editor-grid">
          <label className="event-workspace__editor-wide">Main client requirements<textarea rows={5} value={draft.requirements} onChange={e => update('requirements', e.target.value)} placeholder="Priorities, must-haves, non-negotiables, expected experience" /></label>
          <label>Theme / colours<textarea rows={4} value={draft.themeColours} onChange={e => update('themeColours', e.target.value)} placeholder="Theme, colour palette, styling, dress code" /></label>
          <label>Venue requirements<textarea rows={4} value={draft.venueRequirements} onChange={e => update('venueRequirements', e.target.value)} placeholder="Layout, accessibility, parking, power, permits" /></label>
          <label>Catering<textarea rows={4} value={draft.catering} onChange={e => update('catering', e.target.value)} placeholder="Menu, drinks, dietary needs, service style" /></label>
          <label>Décor<textarea rows={4} value={draft.decor} onChange={e => update('decor', e.target.value)} placeholder="Stage, flowers, tables, signage, lighting" /></label>
          <label>Entertainment<textarea rows={4} value={draft.entertainment} onChange={e => update('entertainment', e.target.value)} placeholder="MC, DJ, band, performers, music preferences" /></label>
          <label>Photography / video<textarea rows={4} value={draft.photography} onChange={e => update('photography', e.target.value)} placeholder="Coverage, deliverables, shot list, livestream" /></label>
          <label>Transport<textarea rows={4} value={draft.transport} onChange={e => update('transport', e.target.value)} placeholder="Client, guest, staff or vendor transport" /></label>
          <label>Accommodation<textarea rows={4} value={draft.accommodation} onChange={e => update('accommodation', e.target.value)} placeholder="Rooms, check-in, guest or vendor accommodation" /></label>
          <label className="event-workspace__editor-wide">Special instructions<textarea rows={4} value={draft.specialInstructions} onChange={e => update('specialInstructions', e.target.value)} placeholder="Cultural protocols, VIP handling, accessibility, security or other instructions" /></label>
        </div>
        <footer className="event-workspace__editor-actions">
          <button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save client brief'}</button>
        </footer>
      </form>
    </section>
  )
}

type PackageDraftItem = Omit<PackageItem, 'amount'> & { amount: string }

function makePackageDraftItem(): PackageDraftItem {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    category: 'Planning',
    pricing: 'included',
    amount: '',
    notes: '',
  }
}

function PackagePanel({ event, saving, onSave }: { event: EventRecord; saving: boolean; onSave: (brief: ClientBrief) => Promise<void> }) {
  const [items, setItems] = useState<PackageDraftItem[]>(() => event.clientBrief.packageItems.map(item => ({ ...item, amount: item.amount === null ? '' : String(item.amount) })))
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setItems(event.clientBrief.packageItems.map(item => ({ ...item, amount: item.amount === null ? '' : String(item.amount) })))
  }, [event.clientBrief.packageItems])

  const includedCount = items.filter(item => item.title.trim() && item.pricing === 'included').length
  const optionalCount = items.filter(item => item.title.trim() && item.pricing === 'optional').length
  const additionalTotal = items.reduce((sum, item) => {
    const parsed = Number(item.amount)
    return item.pricing === 'additional' && Number.isFinite(parsed) ? sum + parsed : sum
  }, 0)

  function updateItem(index: number, patch: Partial<PackageDraftItem>) {
    setItems(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    setMessage(null)
    const packageItems: PackageItem[] = []

    for (const item of items) {
      const title = item.title.trim()
      if (!title) continue
      const itemAmount = item.amount.trim() ? Number(item.amount) : null
      if (itemAmount !== null && (!Number.isFinite(itemAmount) || itemAmount < 0)) {
        setMessage(`Enter a valid amount for “${title}”.`)
        return
      }
      packageItems.push({
        id: item.id,
        title,
        category: item.category,
        pricing: item.pricing,
        amount: itemAmount,
        notes: item.notes.trim(),
      })
    }

    try {
      await onSave({ ...event.clientBrief, packageItems })
      setMessage('Package inclusions saved.')
    } catch {
      setMessage('Could not save package inclusions.')
    }
  }

  return (
    <section className="workspace-card event-workspace__editor-card">
      <header className="event-workspace__editor-heading">
        <div>
          <p className="event-workspace__eyebrow">{PACKAGE_LABELS[event.planningPackage]}</p>
          <h2>Package inclusions</h2>
          <p>Spell out the scope. Each item can be included, optional, or an additional client cost.</p>
        </div>
        <button type="button" className="button button--ghost" onClick={() => setItems(previous => [...previous, makePackageDraftItem()])}>＋ Add package item</button>
      </header>

      <div className="event-workspace__package-summary">
        <div><span>Included</span><strong>{includedCount}</strong></div>
        <div><span>Optional</span><strong>{optionalCount}</strong></div>
        <div><span>Additional-cost total</span><strong>{formatMoney(additionalTotal)}</strong></div>
      </div>

      {message ? <p className="event-workspace__editor-message">{message}</p> : null}

      <form onSubmit={submit}>
        {items.length === 0 ? (
          <div className="event-workspace__package-empty"><strong>No package items yet</strong><p>Add the services and deliverables agreed with the client.</p></div>
        ) : (
          <div className="event-workspace__package-list">
            {items.map((item, index) => (
              <article key={item.id} className="event-workspace__package-item">
                <div className="event-workspace__editor-grid">
                  <label className="event-workspace__editor-wide">Service / deliverable<input value={item.title} onChange={e => updateItem(index, { title: e.target.value })} placeholder="e.g. Event-day coordination" /></label>
                  <label>Category<select value={item.category} onChange={e => updateItem(index, { category: e.target.value })}>{PACKAGE_ITEM_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
                  <label>Pricing<select value={item.pricing} onChange={e => updateItem(index, { pricing: e.target.value as PackagePricing })}>{Object.entries(PACKAGE_PRICING_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label>Amount (GHS)<input type="number" min="0" step="0.01" value={item.amount} onChange={e => updateItem(index, { amount: e.target.value })} placeholder={item.pricing === 'included' ? 'Leave blank if included' : '0.00'} /></label>
                  <label>Scope / notes<input value={item.notes} onChange={e => updateItem(index, { notes: e.target.value })} placeholder="Quantity, limit, conditions or exclusions" /></label>
                </div>
                <button type="button" className="event-workspace__remove-item" onClick={() => setItems(previous => previous.filter((_, itemIndex) => itemIndex !== index))}>Remove item</button>
              </article>
            ))}
          </div>
        )}
        <footer className="event-workspace__editor-actions"><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save package'}</button></footer>
      </form>
    </section>
  )
}

export default function EventWorkspace() {
  const { eventId = '' } = useParams()
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<EventRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingBrief, setSavingBrief] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestedTab = searchParams.get('tab') as TabKey | null
  const activeTab: TabKey = TABS.some(item => item.key === requestedTab) ? requestedTab! : 'overview'

  useEffect(() => {
    let active = true

    async function loadEvent() {
      if (storeLoading) return
      if (!storeId || !eventId) {
        if (active) {
          setLoading(false)
          setError('This event workspace could not be opened.')
        }
        return
      }

      setLoading(true)
      setError(null)
      try {
        const snapshot = await getDoc(doc(db, 'stores', storeId, 'events', eventId))
        if (!active) return
        if (!snapshot.exists()) {
          setEvent(null)
          setError('Event not found in this workspace.')
          return
        }
        setEvent(mapEvent(snapshot.id, snapshot.data()))
      } catch (loadError) {
        console.error('[event-workspace] Unable to load event', loadError)
        if (active) setError('We could not load this event workspace.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadEvent()
    return () => { active = false }
  }, [eventId, storeId, storeLoading])

  const eventMeta = useMemo(() => {
    if (!event) return []
    return [
      { label: 'Date', value: `${formatDate(event.eventDate)}${event.startTime ? ` · ${event.startTime}` : ''}` },
      { label: 'Venue', value: event.venue || 'Not set' },
      { label: 'Guests', value: event.guestCount ? event.guestCount.toLocaleString() : 'Not set' },
      { label: 'Package', value: PACKAGE_LABELS[event.planningPackage] },
    ]
  }, [event])

  function selectTab(tab: TabKey) {
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true })
  }

  async function saveClientBrief(brief: ClientBrief) {
    if (!storeId || !event) throw new Error('No active event')
    setSavingBrief(true)
    try {
      await updateDoc(doc(db, 'stores', storeId, 'events', event.id), {
        clientBrief: brief,
        updatedAt: serverTimestamp(),
      })
      setEvent(previous => previous ? { ...previous, clientBrief: brief } : previous)
    } finally {
      setSavingBrief(false)
    }
  }

  if (storeLoading || loading) {
    return <main className="event-workspace workspace-page"><section className="workspace-card event-workspace__loading"><span className="event-workspace__spinner" /><p>Loading event workspace…</p></section></main>
  }

  if (storeError || error || !event || !storeId) {
    return (
      <main className="event-workspace workspace-page">
        <section className="workspace-card event-workspace__error">
          <p className="event-workspace__eyebrow">Event workspace</p>
          <h1>Unable to open event</h1>
          <p>{storeError || error || 'Event not found.'}</p>
          <button type="button" className="button button--primary" onClick={() => navigate('/event-planning')}>Back to events</button>
        </section>
      </main>
    )
  }

  const integrationTab = INTEGRATION_TABS.includes(activeTab as EventIntegrationTab) ? activeTab as EventIntegrationTab : null

  return (
    <main className="event-workspace workspace-page">
      <div className="event-workspace__breadcrumb"><Link to="/event-planning">Events</Link><span aria-hidden="true">/</span><span>{event.eventCode}</span></div>

      <header className="event-workspace__hero workspace-card">
        <div className="event-workspace__hero-copy">
          <div className="event-workspace__hero-topline"><p className="event-workspace__eyebrow">{event.eventType} · {event.eventCode}</p><span className={`event-workspace__status event-workspace__status--${event.status}`}>{STATUS_LABELS[event.status]}</span></div>
          <h1>{event.title}</h1>
          <p>{event.clientName}</p>
          <div className="event-workspace__meta-grid">{eventMeta.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
        </div>
        <div className="event-workspace__readiness-card"><span>Event readiness</span><strong>{event.progress}%</strong><div><i style={{ width: `${event.progress}%` }} /></div><small>Current planning progress</small></div>
      </header>

      <nav className="event-workspace__tabs" aria-label="Event workspace sections">
        {TABS.map(tab => <button type="button" key={tab.key} className={activeTab === tab.key ? 'is-active' : ''} aria-current={activeTab === tab.key ? 'page' : undefined} onClick={() => selectTab(tab.key)}>{tab.label}</button>)}
      </nav>

      {activeTab === 'overview' ? (
        <div className="event-workspace__overview-grid">
          <section className="workspace-card event-workspace__content-card event-workspace__overview-main">
            <div><p className="event-workspace__eyebrow">Event summary</p><h2>Planning overview</h2></div>
            <dl className="event-workspace__details">
              <div><dt>Client</dt><dd>{event.clientName}</dd></div>
              <div><dt>Client phone</dt><dd>{event.clientPhone || 'Not provided'}</dd></div>
              <div><dt>Client email</dt><dd>{event.clientEmail || 'Not provided'}</dd></div>
              <div><dt>Event type</dt><dd>{event.eventType}</dd></div>
              <div><dt>Complexity</dt><dd>{COMPLEXITY_LABELS[event.complexity]}</dd></div>
              <div><dt>Estimated budget</dt><dd>{formatMoney(event.estimatedBudget)}</dd></div>
              <div><dt>Client brief</dt><dd>{event.clientBrief.requirements || event.clientBrief.themeColours || event.clientBrief.packageItems.length ? 'Started' : 'Not started'}</dd></div>
              <div><dt>Package items</dt><dd>{event.clientBrief.packageItems.length}</dd></div>
            </dl>
            {event.notes ? <div className="event-workspace__notes"><strong>Internal notes</strong><p>{event.notes}</p></div> : null}
          </section>
          <aside className="workspace-card event-workspace__quick-actions">
            <p className="event-workspace__eyebrow">Quick access</p><h2>Work on this event</h2>
            <button type="button" onClick={() => selectTab('client-brief')}>Edit client brief <span>→</span></button>
            <button type="button" onClick={() => selectTab('package')}>Manage package <span>→</span></button>
            <button type="button" onClick={() => selectTab('checklist')}>Open checklist <span>→</span></button>
            <button type="button" onClick={() => selectTab('timeline')}>Build timeline <span>→</span></button>
            <button type="button" onClick={() => selectTab('guest-list')}>Manage guest list <span>→</span></button>
            <button type="button" onClick={() => selectTab('seating')}>Plan seating <span>→</span></button>
            <button type="button" onClick={() => selectTab('vendors')}>Manage vendors <span>→</span></button>
            <button type="button" onClick={() => selectTab('finance')}>Review finance <span>→</span></button>
          </aside>
        </div>
      ) : activeTab === 'client-brief' ? (
        <ClientBriefPanel brief={event.clientBrief} saving={savingBrief} onSave={saveClientBrief} />
      ) : activeTab === 'package' ? (
        <PackagePanel event={event} saving={savingBrief} onSave={saveClientBrief} />
      ) : activeTab === 'guest-list' ? (
        <EventGuestList storeId={storeId} eventId={event.id} eventTitle={event.title} expectedGuestCount={event.guestCount} />
      ) : activeTab === 'seating' ? (
        <EventSeatingPlanner storeId={storeId} eventId={event.id} eventTitle={event.title} expectedGuestCount={event.guestCount} />
      ) : integrationTab ? (
        <EventModuleIntegrations
          tab={integrationTab}
          storeId={storeId}
          event={{
            id: event.id,
            eventCode: event.eventCode,
            title: event.title,
            clientName: event.clientName,
            clientPhone: event.clientPhone,
            clientEmail: event.clientEmail,
            estimatedBudget: event.estimatedBudget,
          }}
        />
      ) : (
        <PlaceholderPanel tab={activeTab as PlaceholderTab} />
      )}
    </main>
  )
}
