import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './EventPlanning.css'

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
  createdAt: Date | null
  updatedAt: Date | null
}

type EventForm = {
  title: string
  eventType: string
  clientName: string
  clientPhone: string
  clientEmail: string
  eventDate: string
  startTime: string
  venue: string
  guestCount: string
  planningPackage: PlanningPackage
  complexity: Complexity
  estimatedBudget: string
  status: EventStatus
  progress: string
  notes: string
}

const EMPTY_FORM: EventForm = {
  title: '',
  eventType: 'Traditional wedding',
  clientName: '',
  clientPhone: '',
  clientEmail: '',
  eventDate: '',
  startTime: '',
  venue: '',
  guestCount: '',
  planningPackage: 'full_planning',
  complexity: 'standard',
  estimatedBudget: '',
  status: 'new',
  progress: '5',
  notes: '',
}

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

const EVENT_TYPES = [
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

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate()
  if (value && typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate()
  }
  return null
}

function isEventStatus(value: unknown): value is EventStatus {
  return ['new', 'planning', 'awaiting_client', 'confirmed', 'completed', 'cancelled'].includes(String(value))
}

function isPlanningPackage(value: unknown): value is PlanningPackage {
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
    planningPackage: isPlanningPackage(data.planningPackage) ? data.planningPackage : 'full_planning',
    complexity: isComplexity(data.complexity) ? data.complexity : 'standard',
    estimatedBudget: typeof data.estimatedBudget === 'number' ? data.estimatedBudget : null,
    status: isEventStatus(data.status) ? data.status : 'new',
    progress: Math.max(0, Math.min(100, numberValue(data.progress, 0))),
    notes: text(data.notes),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function formatDate(value: string) {
  if (!value) return 'Date not set'
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(value: number | null) {
  if (value === null) return 'Not set'
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(value)
}

function buildEventCode(date: string) {
  const year = date.slice(0, 4) || String(new Date().getFullYear())
  return `ECE-${year}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
}

function EventFormModal({
  event,
  onClose,
  onSave,
}: {
  event: EventRecord | null
  onClose: () => void
  onSave: (form: EventForm) => Promise<void>
}) {
  const [form, setForm] = useState<EventForm>(() =>
    event
      ? {
          title: event.title,
          eventType: event.eventType,
          clientName: event.clientName === 'Client not assigned' ? '' : event.clientName,
          clientPhone: event.clientPhone,
          clientEmail: event.clientEmail,
          eventDate: event.eventDate,
          startTime: event.startTime,
          venue: event.venue,
          guestCount: String(event.guestCount || ''),
          planningPackage: event.planningPackage,
          complexity: event.complexity,
          estimatedBudget: event.estimatedBudget === null ? '' : String(event.estimatedBudget),
          status: event.status,
          progress: String(event.progress),
          notes: event.notes,
        }
      : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function update<K extends keyof EventForm>(key: K, value: EventForm[K]) {
    setForm(previous => ({ ...previous, [key]: value }))
  }

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    const guests = Number(form.guestCount)
    if (!Number.isInteger(guests) || guests < 1) {
      setFormError('Enter a valid expected guest count.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await onSave(form)
    } catch (error) {
      console.error('[event-planning] Unable to save event', error)
      setFormError('The event could not be saved. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="event-planning__modal-backdrop" onMouseDown={onClose}>
      <section
        className="event-planning__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-form-title"
        onMouseDown={modalEvent => modalEvent.stopPropagation()}
      >
        <header className="event-planning__modal-heading">
          <div>
            <p className="event-planning__eyebrow">{event ? 'Update event' : 'New event'}</p>
            <h2 id="event-form-title">{event ? 'Edit event details' : 'Create an event'}</h2>
            <p>Capture the essential details now. Checklists, vendors and timelines will be attached from the event workspace.</p>
          </div>
          <button type="button" className="event-planning__icon-button" onClick={onClose} aria-label="Close form">×</button>
        </header>

        {formError ? <p className="event-planning__alert event-planning__alert--error">{formError}</p> : null}

        <form onSubmit={submit}>
          <div className="event-planning__form-grid">
            <label className="event-planning__field--wide">
              Event name
              <input required value={form.title} onChange={e => update('title', e.target.value)} placeholder="e.g. Ama & Kojo’s Traditional Wedding" />
            </label>
            <label>
              Event type
              <select value={form.eventType} onChange={e => update('eventType', e.target.value)}>
                {EVENT_TYPES.map(type => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label>
              Planning package
              <select value={form.planningPackage} onChange={e => update('planningPackage', e.target.value as PlanningPackage)}>
                {Object.entries(PACKAGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Client name
              <input required value={form.clientName} onChange={e => update('clientName', e.target.value)} placeholder="Full name or company" />
            </label>
            <label>
              Client phone
              <input value={form.clientPhone} onChange={e => update('clientPhone', e.target.value)} placeholder="e.g. 024 000 0000" />
            </label>
            <label>
              Client email
              <input type="email" value={form.clientEmail} onChange={e => update('clientEmail', e.target.value)} placeholder="client@example.com" />
            </label>
            <label>
              Expected guests
              <input required type="number" min="1" value={form.guestCount} onChange={e => update('guestCount', e.target.value)} placeholder="250" />
            </label>
            <label>
              Event date
              <input required type="date" value={form.eventDate} onChange={e => update('eventDate', e.target.value)} />
            </label>
            <label>
              Start time
              <input required type="time" value={form.startTime} onChange={e => update('startTime', e.target.value)} />
            </label>
            <label className="event-planning__field--wide">
              Venue or location
              <input required value={form.venue} onChange={e => update('venue', e.target.value)} placeholder="Venue, town or city" />
            </label>
            <label>
              Event complexity
              <select value={form.complexity} onChange={e => update('complexity', e.target.value as Complexity)}>
                {Object.entries(COMPLEXITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Estimated client budget (GHS)
              <input type="number" min="0" step="0.01" value={form.estimatedBudget} onChange={e => update('estimatedBudget', e.target.value)} placeholder="20000" />
            </label>
            <label>
              Status
              <select value={form.status} onChange={e => update('status', e.target.value as EventStatus)}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Planning progress
              <div className="event-planning__progress-input">
                <input type="range" min="0" max="100" value={form.progress} onChange={e => update('progress', e.target.value)} />
                <strong>{form.progress}%</strong>
              </div>
            </label>
            <label className="event-planning__field--wide">
              Internal notes
              <textarea rows={3} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Important requirements, preferences or early planning notes" />
            </label>
          </div>
          <footer className="event-planning__modal-actions">
            <button type="button" className="button button--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={saving}>
              {saving ? 'Saving…' : event ? 'Save changes' : 'Create event'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export default function EventPlanning() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [queryText, setQueryText] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | EventStatus>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null)
  const [deletingId, setDeletingId] = useState('')

  const loadEvents = useCallback(async () => {
    if (!storeId) {
      setEvents([])
      setLoading(false)
      return
    }
    setLoading(true)
    setPageError(null)
    try {
      const snapshot = await getDocs(query(collection(db, 'stores', storeId, 'events'), orderBy('eventDate', 'asc')))
      setEvents(snapshot.docs.map(eventDoc => mapEvent(eventDoc.id, eventDoc.data())))
    } catch (error) {
      console.error('[event-planning] Unable to load events', error)
      setPageError('We could not load the events for this workspace.')
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  const filteredEvents = useMemo(() => {
    const search = queryText.trim().toLowerCase()
    return events.filter(event => {
      const matchesStatus = statusFilter === 'all' || event.status === statusFilter
      const matchesSearch = !search || [
        event.title,
        event.eventCode,
        event.eventType,
        event.clientName,
        event.venue,
      ].join(' ').toLowerCase().includes(search)
      return matchesStatus && matchesSearch
    })
  }, [events, queryText, statusFilter])

  const upcomingEvents = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return events.filter(event => event.eventDate >= today && !['cancelled', 'completed'].includes(event.status)).length
  }, [events])

  const awaitingClient = events.filter(event => event.status === 'awaiting_client').length
  const activePlanning = events.filter(event => ['new', 'planning', 'awaiting_client', 'confirmed'].includes(event.status)).length
  const averageProgress = events.length
    ? Math.round(events.reduce((sum, event) => sum + event.progress, 0) / events.length)
    : 0

  async function saveEvent(form: EventForm) {
    if (!storeId) throw new Error('No active workspace')
    const payload = {
      title: form.title.trim(),
      eventType: form.eventType,
      clientName: form.clientName.trim(),
      clientPhone: form.clientPhone.trim(),
      clientEmail: form.clientEmail.trim().toLowerCase(),
      eventDate: form.eventDate,
      startTime: form.startTime,
      venue: form.venue.trim(),
      guestCount: Number(form.guestCount),
      planningPackage: form.planningPackage,
      complexity: form.complexity,
      estimatedBudget: form.estimatedBudget ? Number(form.estimatedBudget) : null,
      status: form.status,
      progress: Number(form.progress),
      notes: form.notes.trim(),
      updatedAt: serverTimestamp(),
    }

    if (editingEvent) {
      await updateDoc(doc(db, 'stores', storeId, 'events', editingEvent.id), payload)
      setSuccessMessage('Event updated successfully.')
    } else {
      await addDoc(collection(db, 'stores', storeId, 'events'), {
        ...payload,
        eventCode: buildEventCode(form.eventDate),
        createdAt: serverTimestamp(),
      })
      setSuccessMessage('Event created successfully.')
    }

    setModalOpen(false)
    setEditingEvent(null)
    await loadEvents()
  }

  function openCreate() {
    setEditingEvent(null)
    setModalOpen(true)
  }

  function openEdit(event: EventRecord) {
    setEditingEvent(event)
    setModalOpen(true)
  }

  async function removeEvent(event: EventRecord) {
    if (!storeId) return
    const confirmed = window.confirm(`Delete “${event.title}”? This cannot be undone.`)
    if (!confirmed) return
    setDeletingId(event.id)
    setPageError(null)
    try {
      await deleteDoc(doc(db, 'stores', storeId, 'events', event.id))
      setEvents(previous => previous.filter(item => item.id !== event.id))
      if (selectedEvent?.id === event.id) setSelectedEvent(null)
      setSuccessMessage('Event deleted.')
    } catch (error) {
      console.error('[event-planning] Unable to delete event', error)
      setPageError('The event could not be deleted.')
    } finally {
      setDeletingId('')
    }
  }

  if (storeLoading || loading) {
    return (
      <main className="event-planning workspace-page">
        <section className="event-planning__loading workspace-card">
          <span className="event-planning__spinner" />
          <p>Loading event workspace…</p>
        </section>
      </main>
    )
  }

  return (
    <main className="event-planning workspace-page">
      <header className="event-planning__hero">
        <div>
          <p className="event-planning__eyebrow">Planning and coordination</p>
          <h1>Events</h1>
          <p>Create, organise and monitor every client event from one workspace.</p>
        </div>
        <button type="button" className="button button--primary event-planning__create" onClick={openCreate}>
          <span aria-hidden="true">＋</span> Create event
        </button>
      </header>

      {storeError ? <p className="event-planning__alert event-planning__alert--error">{storeError}</p> : null}
      {pageError ? <p className="event-planning__alert event-planning__alert--error">{pageError}</p> : null}
      {successMessage ? (
        <p className="event-planning__alert event-planning__alert--success">
          {successMessage}
          <button type="button" onClick={() => setSuccessMessage(null)} aria-label="Dismiss message">×</button>
        </p>
      ) : null}

      <section className="event-planning__metrics" aria-label="Event summary">
        <article>
          <span>Upcoming events</span>
          <strong>{upcomingEvents}</strong>
          <small>Scheduled ahead</small>
        </article>
        <article>
          <span>Active planning</span>
          <strong>{activePlanning}</strong>
          <small>Open client events</small>
        </article>
        <article>
          <span>Awaiting client</span>
          <strong>{awaitingClient}</strong>
          <small>Requires follow-up</small>
        </article>
        <article>
          <span>Average readiness</span>
          <strong>{averageProgress}%</strong>
          <small>Across all events</small>
        </article>
      </section>

      <section className="event-planning__panel workspace-card">
        <header className="event-planning__panel-heading">
          <div>
            <h2>Event workspace</h2>
            <p>{filteredEvents.length} of {events.length} events shown</p>
          </div>
          <div className="event-planning__filters">
            <label>
              <span className="sr-only">Search events</span>
              <input value={queryText} onChange={e => setQueryText(e.target.value)} placeholder="Search event, client or venue" />
            </label>
            <label>
              <span className="sr-only">Filter by status</span>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | EventStatus)}>
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </header>

        {filteredEvents.length === 0 ? (
          <div className="event-planning__empty">
            <div aria-hidden="true">EC</div>
            <h3>{events.length ? 'No matching events' : 'Create your first event'}</h3>
            <p>{events.length ? 'Try a different search or status filter.' : 'Start with the client, date, venue and expected guest count.'}</p>
            {!events.length ? <button type="button" className="button button--primary" onClick={openCreate}>Create event</button> : null}
          </div>
        ) : (
          <div className="event-planning__table-wrap">
            <table className="event-planning__table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date and venue</th>
                  <th>Guests</th>
                  <th>Package</th>
                  <th>Readiness</th>
                  <th>Status</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map(event => (
                  <tr key={event.id}>
                    <td>
                      <button type="button" className="event-planning__event-link" onClick={() => setSelectedEvent(event)}>
                        {event.title}
                      </button>
                      <span>{event.eventType} · {event.eventCode}</span>
                      <small>{event.clientName}</small>
                    </td>
                    <td>
                      <strong>{formatDate(event.eventDate)}{event.startTime ? ` · ${event.startTime}` : ''}</strong>
                      <span>{event.venue || 'Venue not set'}</span>
                    </td>
                    <td><strong>{event.guestCount.toLocaleString()}</strong></td>
                    <td><span>{PACKAGE_LABELS[event.planningPackage]}</span></td>
                    <td>
                      <div className="event-planning__readiness">
                        <span><small>Checklist</small><strong>{event.progress}%</strong></span>
                        <i><b style={{ width: `${event.progress}%` }} /></i>
                      </div>
                    </td>
                    <td><span className={`event-planning__status event-planning__status--${event.status}`}>{STATUS_LABELS[event.status]}</span></td>
                    <td>
                      <div className="event-planning__row-actions">
                        <button type="button" onClick={() => openEdit(event)}>Edit</button>
                        <button type="button" className="event-planning__danger" disabled={deletingId === event.id} onClick={() => void removeEvent(event)}>
                          {deletingId === event.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedEvent ? (
        <aside className="event-planning__drawer-backdrop" onMouseDown={() => setSelectedEvent(null)}>
          <section className="event-planning__drawer" onMouseDown={event => event.stopPropagation()} aria-label="Event overview">
            <header>
              <div>
                <p className="event-planning__eyebrow">{selectedEvent.eventCode}</p>
                <h2>{selectedEvent.title}</h2>
                <p>{selectedEvent.clientName}</p>
              </div>
              <button type="button" className="event-planning__icon-button" onClick={() => setSelectedEvent(null)} aria-label="Close event details">×</button>
            </header>
            <div className="event-planning__drawer-status">
              <span className={`event-planning__status event-planning__status--${selectedEvent.status}`}>{STATUS_LABELS[selectedEvent.status]}</span>
              <strong>{selectedEvent.progress}% ready</strong>
            </div>
            <dl className="event-planning__details">
              <div><dt>Event type</dt><dd>{selectedEvent.eventType}</dd></div>
              <div><dt>Date</dt><dd>{formatDate(selectedEvent.eventDate)}{selectedEvent.startTime ? ` at ${selectedEvent.startTime}` : ''}</dd></div>
              <div><dt>Venue</dt><dd>{selectedEvent.venue || 'Not set'}</dd></div>
              <div><dt>Expected guests</dt><dd>{selectedEvent.guestCount.toLocaleString()}</dd></div>
              <div><dt>Package</dt><dd>{PACKAGE_LABELS[selectedEvent.planningPackage]}</dd></div>
              <div><dt>Complexity</dt><dd>{COMPLEXITY_LABELS[selectedEvent.complexity]}</dd></div>
              <div><dt>Estimated budget</dt><dd>{formatMoney(selectedEvent.estimatedBudget)}</dd></div>
              <div><dt>Client contact</dt><dd>{selectedEvent.clientPhone || selectedEvent.clientEmail || 'Not provided'}</dd></div>
            </dl>
            {selectedEvent.notes ? <div className="event-planning__notes"><strong>Internal notes</strong><p>{selectedEvent.notes}</p></div> : null}
            <div className="event-planning__workspace-preview">
              <h3>Event workspace</h3>
              <p>The next phase will connect the checklist, client brief, vendors, staff, timeline, guest list, invoices and messages to this event.</p>
              <div>
                {['Overview', 'Checklist', 'Client brief', 'Vendors', 'Staff', 'Timeline', 'Invoices'].map(item => <span key={item}>{item}</span>)}
              </div>
            </div>
            <footer>
              <button type="button" className="button button--ghost" onClick={() => setSelectedEvent(null)}>Close</button>
              <button type="button" className="button button--primary" onClick={() => { setSelectedEvent(null); openEdit(selectedEvent) }}>Edit event</button>
            </footer>
          </section>
        </aside>
      ) : null}

      {modalOpen ? (
        <EventFormModal
          event={editingEvent}
          onClose={() => { setModalOpen(false); setEditingEvent(null) }}
          onSave={saveEvent}
        />
      ) : null}
    </main>
  )
}
