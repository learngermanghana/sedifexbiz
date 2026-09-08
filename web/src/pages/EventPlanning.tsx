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
import { useNavigate } from 'react-router-dom'
import EventContractApprovals from '../components/EventContractApprovals'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './EventPlanning.css'

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

type ClientBriefForm = Omit<ClientBrief, 'packageItems'> & {
  packageItems: Array<Omit<PackageItem, 'amount'> & { amount: string }>
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

const PACKAGE_PRICING_LABELS: Record<PackagePricing, string> = {
  included: 'Included',
  optional: 'Optional',
  additional: 'Additional cost',
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
  'Engagement',
  'Birthday',
  'Funeral',
  'Naming ceremony',
  'Baby shower',
  'Anniversary',
  'Graduation',
  'Corporate event',
  'Conference / seminar',
  'Church / religious event',
  'School / educational event',
  'Concert / entertainment',
  'Party / social event',
  'Charity / community',
  'Other',
]

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
    planningPackage: isPlanningPackage(data.planningPackage) ? data.planningPackage : 'full_planning',
    complexity: isComplexity(data.complexity) ? data.complexity : 'standard',
    estimatedBudget: typeof data.estimatedBudget === 'number' ? data.estimatedBudget : null,
    status: isEventStatus(data.status) ? data.status : 'new',
    progress: Math.max(0, Math.min(100, numberValue(data.progress, 0))),
    notes: text(data.notes),
    clientBrief: mapClientBrief(data.clientBrief),
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

function briefToForm(brief: ClientBrief): ClientBriefForm {
  return {
    ...brief,
    packageItems: brief.packageItems.map(item => ({
      ...item,
      amount: item.amount === null ? '' : String(item.amount),
    })),
  }
}

function createPackageItem(): ClientBriefForm['packageItems'][number] {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    category: 'Planning',
    pricing: 'included',
    amount: '',
    notes: '',
  }
}

function EventFormModal({ event, onClose, onSave }: {
  event: EventRecord | null
  onClose: () => void
  onSave: (form: EventForm) => Promise<void>
}) {
  const [form, setForm] = useState<EventForm>(() => event ? {
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
  } : EMPTY_FORM)
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
      <section className="event-planning__modal" role="dialog" aria-modal="true" aria-labelledby="event-form-title" onMouseDown={modalEvent => modalEvent.stopPropagation()}>
        <header className="event-planning__modal-heading">
          <div>
            <p className="event-planning__eyebrow">{event ? 'Update event' : 'New event'}</p>
            <h2 id="event-form-title">{event ? 'Edit event details' : 'Create an event'}</h2>
            <p>Capture the essential details now. Client requirements, package terms and approvals are managed from the event workspace.</p>
          </div>
          <button type="button" className="event-planning__icon-button" onClick={onClose} aria-label="Close form">×</button>
        </header>

        {formError ? <p className="event-planning__alert event-planning__alert--error">{formError}</p> : null}

        <form onSubmit={submit}>
          <div className="event-planning__form-grid">
            <label className="event-planning__field--wide">Event name<input required value={form.title} onChange={e => update('title', e.target.value)} placeholder="e.g. Ama & Kojo’s Traditional Wedding" /></label>
            <label>Event type<select value={form.eventType} onChange={e => update('eventType', e.target.value)}>{EVENT_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
            <label>Planning package<select value={form.planningPackage} onChange={e => update('planningPackage', e.target.value as PlanningPackage)}>{Object.entries(PACKAGE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Client name<input required value={form.clientName} onChange={e => update('clientName', e.target.value)} placeholder="Full name or company" /></label>
            <label>Client phone<input value={form.clientPhone} onChange={e => update('clientPhone', e.target.value)} placeholder="e.g. 024 000 0000" /></label>
            <label>Client email<input type="email" value={form.clientEmail} onChange={e => update('clientEmail', e.target.value)} placeholder="client@example.com" /></label>
            <label>Expected guests<input required type="number" min="1" value={form.guestCount} onChange={e => update('guestCount', e.target.value)} placeholder="250" /></label>
            <label>Event date<input required type="date" value={form.eventDate} onChange={e => update('eventDate', e.target.value)} /></label>
            <label>Start time<input required type="time" value={form.startTime} onChange={e => update('startTime', e.target.value)} /></label>
            <label className="event-planning__field--wide">Venue or location<input required value={form.venue} onChange={e => update('venue', e.target.value)} placeholder="Venue, town or city" /></label>
            <label>Event complexity<select value={form.complexity} onChange={e => update('complexity', e.target.value as Complexity)}>{Object.entries(COMPLEXITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Estimated client budget (GHS)<input type="number" min="0" step="0.01" value={form.estimatedBudget} onChange={e => update('estimatedBudget', e.target.value)} placeholder="20000" /></label>
            <label>Status<select value={form.status} onChange={e => update('status', e.target.value as EventStatus)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Planning progress<div className="event-planning__progress-input"><input type="range" min="0" max="100" value={form.progress} onChange={e => update('progress', e.target.value)} /><strong>{form.progress}%</strong></div></label>
            <label className="event-planning__field--wide">Internal notes<textarea rows={3} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Important internal planning notes" /></label>
          </div>
          <footer className="event-planning__modal-actions">
            <button type="button" className="button button--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : event ? 'Save changes' : 'Create event'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

function ClientBriefModal({ event, onClose, onSave }: {
  event: EventRecord
  onClose: () => void
  onSave: (brief: ClientBrief) => Promise<void>
}) {
  const [form, setForm] = useState<ClientBriefForm>(() => briefToForm(event.clientBrief))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function updateField<K extends Exclude<keyof ClientBriefForm, 'packageItems'>>(key: K, value: ClientBriefForm[K]) {
    setForm(previous => ({ ...previous, [key]: value }))
  }

  function updatePackageItem(index: number, patch: Partial<ClientBriefForm['packageItems'][number]>) {
    setForm(previous => ({
      ...previous,
      packageItems: previous.packageItems.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }))
  }

  function removePackageItem(index: number) {
    setForm(previous => ({ ...previous, packageItems: previous.packageItems.filter((_, itemIndex) => itemIndex !== index) }))
  }

  function addPackageItem() {
    setForm(previous => ({ ...previous, packageItems: [...previous.packageItems, createPackageItem()] }))
  }

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault()
    const packageItems: PackageItem[] = []
    for (const item of form.packageItems) {
      const title = item.title.trim()
      if (!title) continue
      const amount = item.amount.trim() ? Number(item.amount) : null
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        setFormError(`Enter a valid amount for “${title}”.`)
        return
      }
      packageItems.push({ id: item.id, title, category: item.category, pricing: item.pricing, amount, notes: item.notes.trim() })
    }

    setSaving(true)
    setFormError(null)
    try {
      await onSave({
        requirements: form.requirements.trim(),
        themeColours: form.themeColours.trim(),
        venueRequirements: form.venueRequirements.trim(),
        catering: form.catering.trim(),
        decor: form.decor.trim(),
        entertainment: form.entertainment.trim(),
        photography: form.photography.trim(),
        transport: form.transport.trim(),
        accommodation: form.accommodation.trim(),
        specialInstructions: form.specialInstructions.trim(),
        packageItems,
      })
    } catch (error) {
      console.error('[event-planning] Unable to save client brief', error)
      setFormError('The client brief could not be saved. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="event-planning__modal-backdrop" onMouseDown={onClose}>
      <section className="event-planning__modal" role="dialog" aria-modal="true" aria-labelledby="client-brief-title" onMouseDown={modalEvent => modalEvent.stopPropagation()}>
        <header className="event-planning__modal-heading">
          <div><p className="event-planning__eyebrow">{event.eventCode}</p><h2 id="client-brief-title">Client brief & package</h2><p>Record the client’s requirements and clearly separate what is included, optional, or charged additionally.</p></div>
          <button type="button" className="event-planning__icon-button" onClick={onClose} aria-label="Close client brief">×</button>
        </header>
        {formError ? <p className="event-planning__alert event-planning__alert--error">{formError}</p> : null}
        <form onSubmit={submit}>
          <div className="event-planning__form-grid">
            <label className="event-planning__field--wide">Main client requirements<textarea rows={4} value={form.requirements} onChange={e => updateField('requirements', e.target.value)} placeholder="Key priorities, must-haves and non-negotiables" /></label>
            <label>Theme / colours<textarea rows={3} value={form.themeColours} onChange={e => updateField('themeColours', e.target.value)} placeholder="Theme, palette, dress code" /></label>
            <label>Venue requirements<textarea rows={3} value={form.venueRequirements} onChange={e => updateField('venueRequirements', e.target.value)} placeholder="Layout, capacity, accessibility, parking" /></label>
            <label>Catering<textarea rows={3} value={form.catering} onChange={e => updateField('catering', e.target.value)} placeholder="Menu, drinks, dietary needs" /></label>
            <label>Décor<textarea rows={3} value={form.decor} onChange={e => updateField('decor', e.target.value)} placeholder="Flowers, stage, tables, signage" /></label>
            <label>Entertainment<textarea rows={3} value={form.entertainment} onChange={e => updateField('entertainment', e.target.value)} placeholder="MC, DJ, band, performers" /></label>
            <label>Photography / video<textarea rows={3} value={form.photography} onChange={e => updateField('photography', e.target.value)} placeholder="Coverage, deliverables, shot list" /></label>
            <label>Transport<textarea rows={3} value={form.transport} onChange={e => updateField('transport', e.target.value)} placeholder="Client, guest, vendor or staff transport" /></label>
            <label>Accommodation<textarea rows={3} value={form.accommodation} onChange={e => updateField('accommodation', e.target.value)} placeholder="Rooms, guest or vendor accommodation" /></label>
            <label className="event-planning__field--wide">Special instructions<textarea rows={3} value={form.specialInstructions} onChange={e => updateField('specialInstructions', e.target.value)} placeholder="Cultural protocols, VIP handling, accessibility, security" /></label>
          </div>

          <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--event-line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div><h3 style={{ margin: 0, color: 'var(--event-ink)' }}>Package inclusions</h3><p style={{ margin: '4px 0 0', color: 'var(--event-muted)', fontSize: '.76rem' }}>Add each service or deliverable and identify how it is priced.</p></div>
              <button type="button" className="button button--ghost" onClick={addPackageItem}>＋ Add item</button>
            </div>
            {form.packageItems.length === 0 ? <div className="event-planning__notes" style={{ marginTop: 0 }}><strong>No package items yet</strong><p>Add the agreed services so staff and the client can see exactly what the package covers.</p></div> : null}
            {form.packageItems.map((item, index) => (
              <div key={item.id} className="event-planning__notes" style={{ marginTop: 10 }}>
                <div className="event-planning__form-grid">
                  <label className="event-planning__field--wide">Service / deliverable<input value={item.title} onChange={e => updatePackageItem(index, { title: e.target.value })} placeholder="e.g. Event-day coordination" /></label>
                  <label>Category<select value={item.category} onChange={e => updatePackageItem(index, { category: e.target.value })}>{PACKAGE_ITEM_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
                  <label>Pricing<select value={item.pricing} onChange={e => updatePackageItem(index, { pricing: e.target.value as PackagePricing })}>{Object.entries(PACKAGE_PRICING_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label>Amount (GHS)<input type="number" min="0" step="0.01" value={item.amount} onChange={e => updatePackageItem(index, { amount: e.target.value })} placeholder={item.pricing === 'included' ? 'Leave blank if included' : '0.00'} /></label>
                  <label>Notes<input value={item.notes} onChange={e => updatePackageItem(index, { notes: e.target.value })} placeholder="Limits, quantity, scope or conditions" /></label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button type="button" className="event-planning__danger" style={{ border: 0, background: 'transparent' }} onClick={() => removePackageItem(index)}>Remove item</button></div>
              </div>
            ))}
          </div>
          <footer className="event-planning__modal-actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save client brief'}</button></footer>
        </form>
      </section>
    </div>
  )
}

function BriefSummary({ brief }: { brief: ClientBrief }) {
  const details: Array<[string, string]> = [
    ['Main requirements', brief.requirements],
    ['Theme / colours', brief.themeColours],
    ['Venue requirements', brief.venueRequirements],
    ['Catering', brief.catering],
    ['Décor', brief.decor],
    ['Entertainment', brief.entertainment],
    ['Photography / video', brief.photography],
    ['Transport', brief.transport],
    ['Accommodation', brief.accommodation],
    ['Special instructions', brief.specialInstructions],
  ].filter(([, value]) => Boolean(value))
  const additionalTotal = brief.packageItems.reduce((sum, item) => sum + (item.pricing === 'additional' && item.amount ? item.amount : 0), 0)

  return (
    <div className="event-planning__workspace-preview">
      <h3>Client brief</h3>
      {details.length === 0 && brief.packageItems.length === 0 ? <p>No client brief has been added yet.</p> : (
        <>
          {details.length ? <dl className="event-planning__details" style={{ marginTop: 12 }}>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{value}</dd></div>)}</dl> : null}
          <div style={{ marginTop: 16 }}>
            <strong style={{ color: 'var(--event-ink)', fontSize: '.82rem' }}>Package inclusions</strong>
            {brief.packageItems.length === 0 ? <p>No package items added.</p> : (
              <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                {brief.packageItems.map(item => (
                  <div key={item.id} style={{ padding: 10, border: '1px solid var(--event-line)', borderRadius: 9, background: '#fafbf9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong style={{ color: 'var(--event-ink)', fontSize: '.78rem' }}>{item.title}</strong>
                      <span className={`event-planning__status event-planning__status--${item.pricing === 'additional' ? 'awaiting_client' : item.pricing === 'optional' ? 'new' : 'planning'}`}>{PACKAGE_PRICING_LABELS[item.pricing]}{item.amount !== null ? ` · ${formatMoney(item.amount)}` : ''}</span>
                    </div>
                    <small style={{ display: 'block', marginTop: 3, color: 'var(--event-muted)' }}>{item.category}{item.notes ? ` · ${item.notes}` : ''}</small>
                  </div>
                ))}
              </div>
            )}
            {additionalTotal > 0 ? <p><strong>Additional-cost items total:</strong> {formatMoney(additionalTotal)}</p> : null}
          </div>
        </>
      )}
    </div>
  )
}

export default function EventPlanning() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const navigate = useNavigate()
  const [events, setEvents] = useState<EventRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [queryText, setQueryText] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | EventStatus>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null)
  const [briefEvent, setBriefEvent] = useState<EventRecord | null>(null)
  const [approvalEvent, setApprovalEvent] = useState<EventRecord | null>(null)
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

  useEffect(() => { void loadEvents() }, [loadEvents])

  const filteredEvents = useMemo(() => {
    const search = queryText.trim().toLowerCase()
    return events.filter(event => {
      const matchesStatus = statusFilter === 'all' || event.status === statusFilter
      const matchesSearch = !search || [event.title, event.eventCode, event.eventType, event.clientName, event.venue].join(' ').toLowerCase().includes(search)
      return matchesStatus && matchesSearch
    })
  }, [events, queryText, statusFilter])

  const upcomingEvents = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return events.filter(event => event.eventDate >= today && !['cancelled', 'completed'].includes(event.status)).length
  }, [events])

  const awaitingClient = events.filter(event => event.status === 'awaiting_client').length
  const activePlanning = events.filter(event => ['new', 'planning', 'awaiting_client', 'confirmed'].includes(event.status)).length
  const averageProgress = events.length ? Math.round(events.reduce((sum, event) => sum + event.progress, 0) / events.length) : 0

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
        clientBrief: EMPTY_BRIEF,
        createdAt: serverTimestamp(),
      })
      setSuccessMessage('Event created successfully.')
    }
    setModalOpen(false)
    setEditingEvent(null)
    await loadEvents()
  }

  async function saveClientBrief(brief: ClientBrief) {
    if (!storeId || !briefEvent) throw new Error('No active event')
    await updateDoc(doc(db, 'stores', storeId, 'events', briefEvent.id), { clientBrief: brief, updatedAt: serverTimestamp() })
    const updated = { ...briefEvent, clientBrief: brief }
    setEvents(previous => previous.map(event => event.id === updated.id ? updated : event))
    if (selectedEvent?.id === updated.id) setSelectedEvent(updated)
    setBriefEvent(null)
    setSuccessMessage('Client brief and package updated.')
  }

  function openCreate() {
    setEditingEvent(null)
    setModalOpen(true)
  }

  function openEdit(event: EventRecord) {
    setEditingEvent(event)
    setModalOpen(true)
  }

  function openWorkspace(event: EventRecord) {
    navigate(`/event-planning/${encodeURIComponent(event.id)}`)
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
      if (briefEvent?.id === event.id) setBriefEvent(null)
      if (approvalEvent?.id === event.id) setApprovalEvent(null)
      setSuccessMessage('Event deleted.')
    } catch (error) {
      console.error('[event-planning] Unable to delete event', error)
      setPageError('The event could not be deleted.')
    } finally {
      setDeletingId('')
    }
  }

  if (storeLoading || loading) {
    return <main className="event-planning workspace-page"><section className="event-planning__loading workspace-card"><span className="event-planning__spinner" /><p>Loading event workspace…</p></section></main>
  }

  return (
    <main className="event-planning workspace-page">
      <header className="event-planning__hero">
        <div><p className="event-planning__eyebrow">Planning and coordination</p><h1>Events</h1><p>Create, organise and monitor every client event from one workspace.</p></div>
        <button type="button" className="button button--primary event-planning__create" onClick={openCreate}><span aria-hidden="true">＋</span> Create event</button>
      </header>

      {storeError ? <p className="event-planning__alert event-planning__alert--error">{storeError}</p> : null}
      {pageError ? <p className="event-planning__alert event-planning__alert--error">{pageError}</p> : null}
      {successMessage ? <p className="event-planning__alert event-planning__alert--success">{successMessage}<button type="button" onClick={() => setSuccessMessage(null)} aria-label="Dismiss message">×</button></p> : null}

      <section className="event-planning__metrics" aria-label="Event summary">
        <article><span>Upcoming events</span><strong>{upcomingEvents}</strong><small>Scheduled ahead</small></article>
        <article><span>Active planning</span><strong>{activePlanning}</strong><small>Open client events</small></article>
        <article><span>Awaiting client</span><strong>{awaitingClient}</strong><small>Requires follow-up</small></article>
        <article><span>Average readiness</span><strong>{averageProgress}%</strong><small>Across all events</small></article>
      </section>

      <section className="event-planning__panel workspace-card">
        <header className="event-planning__panel-heading">
          <div><h2>Event workspace</h2><p>{filteredEvents.length} of {events.length} events shown</p></div>
          <div className="event-planning__filters">
            <label><span className="sr-only">Search events</span><input value={queryText} onChange={e => setQueryText(e.target.value)} placeholder="Search event, client or venue" /></label>
            <label><span className="sr-only">Filter by status</span><select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | EventStatus)}><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>
        </header>

        {filteredEvents.length === 0 ? (
          <div className="event-planning__empty"><div aria-hidden="true">EC</div><h3>{events.length ? 'No matching events' : 'Create your first event'}</h3><p>{events.length ? 'Try a different search or status filter.' : 'Start with the client, date, venue and expected guest count.'}</p>{!events.length ? <button type="button" className="button button--primary" onClick={openCreate}>Create event</button> : null}</div>
        ) : (
          <div className="event-planning__table-wrap">
            <table className="event-planning__table">
              <thead><tr><th>Event</th><th>Date and venue</th><th>Guests</th><th>Package</th><th>Readiness</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {filteredEvents.map(event => (
                  <tr key={event.id}>
                    <td><button type="button" className="event-planning__event-link" onClick={() => openWorkspace(event)} aria-label={`Open ${event.title} workspace`}>{event.title}</button><span>{event.eventType} · {event.eventCode}</span><small>{event.clientName}</small></td>
                    <td><strong>{formatDate(event.eventDate)}{event.startTime ? ` · ${event.startTime}` : ''}</strong><span>{event.venue || 'Venue not set'}</span></td>
                    <td><strong>{event.guestCount.toLocaleString()}</strong></td>
                    <td><span>{PACKAGE_LABELS[event.planningPackage]}</span><small>{event.clientBrief.packageItems.length} package item{event.clientBrief.packageItems.length === 1 ? '' : 's'}</small></td>
                    <td><div className="event-planning__readiness"><span><small>Checklist</small><strong>{event.progress}%</strong></span><i><b style={{ width: `${event.progress}%` }} /></i></div></td>
                    <td><span className={`event-planning__status event-planning__status--${event.status}`}>{STATUS_LABELS[event.status]}</span></td>
                    <td><div className="event-planning__row-actions"><button type="button" className="event-planning__workspace-action" onClick={() => openWorkspace(event)}>Open workspace</button><button type="button" onClick={() => setBriefEvent(event)}>Client brief</button><button type="button" onClick={() => setApprovalEvent(event)}>Contract & approval</button><button type="button" onClick={() => openEdit(event)}>Edit</button><button type="button" className="event-planning__danger" disabled={deletingId === event.id} onClick={() => void removeEvent(event)}>{deletingId === event.id ? 'Deleting…' : 'Delete'}</button></div></td>
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
            <header><div><p className="event-planning__eyebrow">{selectedEvent.eventCode}</p><h2>{selectedEvent.title}</h2><p>{selectedEvent.clientName}</p></div><button type="button" className="event-planning__icon-button" onClick={() => setSelectedEvent(null)} aria-label="Close event details">×</button></header>
            <div className="event-planning__drawer-status"><span className={`event-planning__status event-planning__status--${selectedEvent.status}`}>{STATUS_LABELS[selectedEvent.status]}</span><strong>{selectedEvent.progress}% ready</strong></div>
            <dl className="event-planning__details">
              <div><dt>Event type</dt><dd>{selectedEvent.eventType}</dd></div><div><dt>Date</dt><dd>{formatDate(selectedEvent.eventDate)}{selectedEvent.startTime ? ` at ${selectedEvent.startTime}` : ''}</dd></div><div><dt>Venue</dt><dd>{selectedEvent.venue || 'Not set'}</dd></div><div><dt>Expected guests</dt><dd>{selectedEvent.guestCount.toLocaleString()}</dd></div><div><dt>Package</dt><dd>{PACKAGE_LABELS[selectedEvent.planningPackage]}</dd></div><div><dt>Complexity</dt><dd>{COMPLEXITY_LABELS[selectedEvent.complexity]}</dd></div><div><dt>Estimated budget</dt><dd>{formatMoney(selectedEvent.estimatedBudget)}</dd></div><div><dt>Client contact</dt><dd>{selectedEvent.clientPhone || selectedEvent.clientEmail || 'Not provided'}</dd></div>
            </dl>
            {selectedEvent.notes ? <div className="event-planning__notes"><strong>Internal notes</strong><p>{selectedEvent.notes}</p></div> : null}
            <BriefSummary brief={selectedEvent.clientBrief} />
            <div className="event-planning__workspace-preview">
              <h3>Contracts & approvals</h3>
              <p>Prepare the service agreement, scope, payment terms and cancellation policy. Track client changes, approval and typed e-signature with revision history.</p>
              <button type="button" className="button button--ghost" style={{ marginTop: 10 }} onClick={() => setApprovalEvent(selectedEvent)}>Open contract & approval</button>
            </div>
            <div className="event-planning__workspace-preview">
              <h3>Full event workspace</h3>
              <p>Open the event workspace to manage the checklist, timeline, program, guest list, vendors, staff, finance, documents, messages and evaluation.</p>
              <div>{['Overview', 'Client brief', 'Package', 'Checklist', 'Timeline', 'Program', 'Guest list', 'Vendors', 'Staff', 'Finance', 'Documents', 'Messages', 'Evaluation'].map(item => <span key={item}>{item}</span>)}</div>
              <button type="button" className="button button--primary" style={{ marginTop: 12 }} onClick={() => openWorkspace(selectedEvent)}>Open full workspace</button>
            </div>
            <footer><button type="button" className="button button--ghost" onClick={() => setSelectedEvent(null)}>Close</button><button type="button" className="button button--ghost" onClick={() => setBriefEvent(selectedEvent)}>Edit client brief</button><button type="button" className="button button--ghost" onClick={() => setApprovalEvent(selectedEvent)}>Contract & approval</button><button type="button" className="button button--primary" onClick={() => openWorkspace(selectedEvent)}>Open workspace</button></footer>
          </section>
        </aside>
      ) : null}

      {modalOpen ? <EventFormModal event={editingEvent} onClose={() => { setModalOpen(false); setEditingEvent(null) }} onSave={saveEvent} /> : null}
      {briefEvent ? <ClientBriefModal event={briefEvent} onClose={() => setBriefEvent(null)} onSave={saveClientBrief} /> : null}
      {approvalEvent && storeId ? (
        <EventContractApprovals
          storeId={storeId}
          event={{ id: approvalEvent.id, eventCode: approvalEvent.eventCode, title: approvalEvent.title, clientName: approvalEvent.clientName, clientEmail: approvalEvent.clientEmail }}
          onClose={() => setApprovalEvent(null)}
          onChanged={loadEvents}
        />
      ) : null}
    </main>
  )
}
