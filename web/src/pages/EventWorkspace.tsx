import React, { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './EventWorkspace.css'

type EventStatus = 'new' | 'planning' | 'awaiting_client' | 'confirmed' | 'completed' | 'cancelled'
type PlanningPackage = 'full_planning' | 'partial_planning' | 'coordination_only' | 'staffing_only'
type Complexity = 'standard' | 'moderate' | 'complex' | 'premium'

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
}

type TabKey =
  | 'overview'
  | 'client-brief'
  | 'package'
  | 'checklist'
  | 'timeline'
  | 'program'
  | 'guest-list'
  | 'vendors'
  | 'staff'
  | 'finance'
  | 'documents'
  | 'messages'
  | 'evaluation'

const TABS: Array<{ key: TabKey; label: string; description: string }> = [
  { key: 'overview', label: 'Overview', description: 'Event summary and readiness' },
  { key: 'client-brief', label: 'Client Brief', description: 'Requirements, preferences and approvals' },
  { key: 'package', label: 'Package', description: 'Scope and package inclusions' },
  { key: 'checklist', label: 'Checklist', description: 'Planning tasks and deadlines' },
  { key: 'timeline', label: 'Timeline', description: 'Internal day-of run sheet' },
  { key: 'program', label: 'Program', description: 'Client-approved event program' },
  { key: 'guest-list', label: 'Guest List', description: 'RSVP and attendance management' },
  { key: 'vendors', label: 'Vendors', description: 'Suppliers and commitments' },
  { key: 'staff', label: 'Staff', description: 'Team roles and assignments' },
  { key: 'finance', label: 'Finance', description: 'Budget, payments and expenses' },
  { key: 'documents', label: 'Documents', description: 'Contracts, invoices and files' },
  { key: 'messages', label: 'Messages', description: 'Client, vendor and staff communication' },
  { key: 'evaluation', label: 'Evaluation', description: 'Post-event reviews and feedback' },
]

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

function PlaceholderPanel({ tab }: { tab: Exclude<TabKey, 'overview'> }) {
  const meta = TABS.find(item => item.key === tab)!
  const hints: Record<Exclude<TabKey, 'overview'>, string[]> = {
    'client-brief': ['Client requirements and priorities', 'Theme, colours and preferences', 'Approval history and change requests'],
    package: ['Purchased planning package', 'Included services and deliverables', 'Optional items and additional-cost requests'],
    checklist: ['Planning tasks and owners', 'Due dates and priorities', 'Completion status feeding event readiness'],
    timeline: ['Vendor arrival times', 'Internal staff responsibilities', 'Minute-by-minute event-day run sheet'],
    program: ['Client-facing program outline', 'Approval status', 'Printable final program'],
    'guest-list': ['Guest and household records', 'RSVP status and table/group', 'Check-in and attendance status'],
    vendors: ['Vendor contacts and categories', 'Quotes, deposits and balances', 'Confirmation and delivery status'],
    staff: ['Assigned Sedifex staff', 'Event-day roles and call times', 'Responsibility and handover notes'],
    finance: ['Client budget and contract value', 'Payments received and balances', 'Vendor commitments, expenses and margin'],
    documents: ['Contracts and signed agreements', 'Invoices and receipts', 'Approved files and printable documents'],
    messages: ['Client communication', 'Vendor and staff notices', 'Event reminders and follow-up history'],
    evaluation: ['Client satisfaction review', 'Vendor performance review', 'Internal team post-event evaluation'],
  }

  return (
    <section className="event-workspace__content-card">
      <div className="event-workspace__empty-icon" aria-hidden="true">{meta.label.slice(0, 2).toUpperCase()}</div>
      <div>
        <p className="event-workspace__eyebrow">Workspace section</p>
        <h2>{meta.label}</h2>
        <p>{meta.description}. This tab is now part of the event workspace foundation and is ready for its event-specific data model.</p>
        <ul className="event-workspace__hint-list">
          {hints[tab].map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
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

  if (storeLoading || loading) {
    return (
      <main className="event-workspace workspace-page">
        <section className="workspace-card event-workspace__loading">
          <span className="event-workspace__spinner" />
          <p>Loading event workspace…</p>
        </section>
      </main>
    )
  }

  if (storeError || error || !event) {
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

  return (
    <main className="event-workspace workspace-page">
      <div className="event-workspace__breadcrumb">
        <Link to="/event-planning">Events</Link>
        <span aria-hidden="true">/</span>
        <span>{event.eventCode}</span>
      </div>

      <header className="event-workspace__hero workspace-card">
        <div className="event-workspace__hero-copy">
          <div className="event-workspace__hero-topline">
            <p className="event-workspace__eyebrow">{event.eventType} · {event.eventCode}</p>
            <span className={`event-workspace__status event-workspace__status--${event.status}`}>{STATUS_LABELS[event.status]}</span>
          </div>
          <h1>{event.title}</h1>
          <p>{event.clientName}</p>
          <div className="event-workspace__meta-grid">
            {eventMeta.map(item => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="event-workspace__readiness-card">
          <span>Event readiness</span>
          <strong>{event.progress}%</strong>
          <div><i style={{ width: `${event.progress}%` }} /></div>
          <small>Current planning progress</small>
        </div>
      </header>

      <nav className="event-workspace__tabs" aria-label="Event workspace sections">
        {TABS.map(tab => (
          <button
            type="button"
            key={tab.key}
            className={activeTab === tab.key ? 'is-active' : ''}
            aria-current={activeTab === tab.key ? 'page' : undefined}
            onClick={() => selectTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' ? (
        <div className="event-workspace__overview-grid">
          <section className="workspace-card event-workspace__content-card event-workspace__overview-main">
            <div>
              <p className="event-workspace__eyebrow">Event summary</p>
              <h2>Planning overview</h2>
            </div>
            <dl className="event-workspace__details">
              <div><dt>Client</dt><dd>{event.clientName}</dd></div>
              <div><dt>Client phone</dt><dd>{event.clientPhone || 'Not provided'}</dd></div>
              <div><dt>Client email</dt><dd>{event.clientEmail || 'Not provided'}</dd></div>
              <div><dt>Event type</dt><dd>{event.eventType}</dd></div>
              <div><dt>Complexity</dt><dd>{COMPLEXITY_LABELS[event.complexity]}</dd></div>
              <div><dt>Estimated budget</dt><dd>{formatMoney(event.estimatedBudget)}</dd></div>
            </dl>
            {event.notes ? (
              <div className="event-workspace__notes">
                <strong>Internal notes</strong>
                <p>{event.notes}</p>
              </div>
            ) : null}
          </section>

          <aside className="workspace-card event-workspace__quick-actions">
            <p className="event-workspace__eyebrow">Quick access</p>
            <h2>Work on this event</h2>
            <button type="button" onClick={() => selectTab('checklist')}>Open checklist <span>→</span></button>
            <button type="button" onClick={() => selectTab('timeline')}>Build timeline <span>→</span></button>
            <button type="button" onClick={() => selectTab('guest-list')}>Manage guest list <span>→</span></button>
            <button type="button" onClick={() => selectTab('vendors')}>Manage vendors <span>→</span></button>
            <button type="button" onClick={() => selectTab('finance')}>Review finance <span>→</span></button>
          </aside>
        </div>
      ) : (
        <PlaceholderPanel tab={activeTab} />
      )}
    </main>
  )
}
