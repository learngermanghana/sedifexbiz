import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import {
  getEventProductionTemplate,
  type EventProductionTemplate,
  type ProductionField,
} from '../utils/eventProductionTemplates'
import {
  calculateProductionReadiness,
  clockFromOffset,
  getProductionTimelinePreset,
  nextProductionItem,
} from '../utils/eventProductionOperations'

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
}

type ProductionSetup = Record<string, string>

type EventBasics = {
  eventDate: string
  startTime: string
  venue: string
  guestCount: number
}

type TimelineRow = {
  id: string
  phase: string
  time: string
  activity: string
  coordinator: string
  contactNumber: string
  progressStatus: string
  remarks: string
  sortOrder: number
}

type RowForm = Omit<TimelineRow, 'id' | 'sortOrder'>

const EMPTY_BASICS: EventBasics = { eventDate: '', startTime: '', venue: '', guestCount: 0 }
const EMPTY_ROW: RowForm = {
  phase: '',
  time: '',
  activity: '',
  coordinator: '',
  contactNumber: '',
  progressStatus: 'planned',
  remarks: '',
}

const PROGRESS_LABELS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  issue: 'Issue / attention',
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return text(value)
}

function setupFrom(value: unknown, fallbackColours: string, template: EventProductionTemplate): ProductionSetup {
  const source = record(value)
  const setup: ProductionSetup = {}
  template.fields.forEach(field => {
    let current = stringValue(source[field.key])
    if (!current && field.key === 'eventColours') current = fallbackColours
    setup[field.key] = current
  })
  return setup
}

function mapRow(id: string, data: Record<string, unknown>): TimelineRow {
  return {
    id,
    phase: text(data.phase),
    time: text(data.time),
    activity: text(data.activity) || 'Untitled activity',
    coordinator: text(data.coordinator),
    contactNumber: text(data.contactNumber),
    progressStatus: text(data.progressStatus) || 'planned',
    remarks: text(data.remarks),
    sortOrder: numberValue(data.sortOrder),
  }
}

function sortRows(rows: TimelineRow[]) {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time) || a.phase.localeCompare(b.phase))
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function fieldDisplayValue(field: ProductionField, rawValue: string) {
  if (!rawValue) return ''
  if (field.type === 'select') return field.options?.find(option => option.value === rawValue)?.label || rawValue
  return rawValue
}

function setupRows(setup: ProductionSetup, template: EventProductionTemplate) {
  return template.fields
    .map(field => [field.label, fieldDisplayValue(field, setup[field.key] || '')] as [string, string])
    .filter(([, value]) => Boolean(value))
}

function formatEventDate(value: string) {
  if (!value) return 'Date not set'
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function EventProductionTimeline({ storeId, eventId, eventTitle }: Props) {
  const eventRef = useMemo(() => doc(db, 'stores', storeId, 'events', eventId), [storeId, eventId])
  const timelineRef = useMemo(() => collection(eventRef, 'productionTimeline'), [eventRef])
  const [eventType, setEventType] = useState('Other')
  const template = useMemo(() => getEventProductionTemplate(eventType), [eventType])
  const preset = useMemo(() => getProductionTimelinePreset(eventType), [eventType])
  const [basics, setBasics] = useState<EventBasics>(EMPTY_BASICS)
  const [setup, setSetup] = useState<ProductionSetup>({})
  const [rows, setRows] = useState<TimelineRow[]>([])
  const [rowForm, setRowForm] = useState<RowForm>(EMPTY_ROW)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [eventDayMode, setEventDayMode] = useState(false)
  const [eventDayClock, setEventDayClock] = useState(() => new Date())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [eventSnapshot, timelineSnapshot] = await Promise.all([getDoc(eventRef), getDocs(timelineRef)])
      if (!eventSnapshot.exists()) throw new Error('EVENT_NOT_FOUND')
      const eventData = eventSnapshot.data() as Record<string, unknown>
      const detectedEventType = text(eventData.eventType) || 'Other'
      const detectedTemplate = getEventProductionTemplate(detectedEventType)
      const brief = record(eventData.clientBrief)
      setEventType(detectedEventType)
      setBasics({
        eventDate: text(eventData.eventDate),
        startTime: text(eventData.startTime),
        venue: text(eventData.venue),
        guestCount: Math.max(0, Math.floor(numberValue(eventData.guestCount))),
      })
      setSetup(setupFrom(eventData.productionSetup, text(brief.themeColours), detectedTemplate))
      setRows(sortRows(timelineSnapshot.docs.map(item => mapRow(item.id, item.data()))))
    } catch (loadError) {
      console.error('[event-production] Unable to load production timeline', loadError)
      setError('The production timeline could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [eventRef, timelineRef])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!eventDayMode) return
    setEventDayClock(new Date())
    const intervalId = window.setInterval(() => setEventDayClock(new Date()), 15_000)
    return () => window.clearInterval(intervalId)
  }, [eventDayMode])

  const readiness = useMemo(() => calculateProductionReadiness({
    eventDate: basics.eventDate,
    startTime: basics.startTime,
    venue: basics.venue,
    guestCount: basics.guestCount,
    fields: template.fields,
    setup,
    timeline: rows,
    suggestedTimelineLength: preset.length,
  }), [basics, preset.length, rows, setup, template.fields])

  const nextItem = useMemo(
    () => nextProductionItem(rows, eventDayClock, basics.eventDate, basics.startTime),
    [basics.eventDate, basics.startTime, eventDayClock, rows],
  )
  const issueRows = useMemo(() => rows.filter(row => row.progressStatus === 'issue'), [rows])
  const completedRows = useMemo(() => rows.filter(row => row.progressStatus === 'done').length, [rows])

  function setSetupValue(key: string, value: string) {
    setSetup(previous => ({ ...previous, [key]: value }))
  }

  async function saveSetup(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const updates: Record<string, unknown> = {
        'productionSetup.templateEventType': template.eventType,
        'productionSetup.templateVersion': 2,
        'productionSetup.updatedAt': serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      template.fields.forEach(field => {
        updates[`productionSetup.${field.key}`] = (setup[field.key] || '').trim()
      })
      await updateDoc(eventRef, updates)
      setMessage(`${template.eventType} production setup saved. Previous template fields were preserved.`)
    } catch (saveError) {
      console.error('[event-production] Unable to save production setup', saveError)
      setError('Production setup could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function seedSuggestedTimeline() {
    if (rows.length) {
      setError('A production timeline already exists. Add or edit items manually to avoid duplicate run-sheet entries.')
      return
    }
    if (!basics.startTime) {
      setError('Set the event start time before applying the suggested run sheet.')
      return
    }
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const batch = writeBatch(db)
      const seededRows = preset.map((item, index): TimelineRow => {
        const itemRef = doc(timelineRef)
        const row: TimelineRow = {
          id: itemRef.id,
          phase: item.phase,
          time: clockFromOffset(basics.startTime, item.offsetMinutes),
          activity: item.activity,
          coordinator: '',
          contactNumber: '',
          progressStatus: 'planned',
          remarks: item.remarks || '',
          sortOrder: index + 1,
        }
        batch.set(itemRef, {
          phase: row.phase,
          time: row.time,
          activity: row.activity,
          coordinator: row.coordinator,
          contactNumber: row.contactNumber,
          progressStatus: row.progressStatus,
          remarks: row.remarks,
          sortOrder: row.sortOrder,
          presetEventType: template.eventType,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        return row
      })
      batch.update(eventRef, {
        'productionSetup.runSheetPresetEventType': template.eventType,
        'productionSetup.runSheetPresetVersion': 1,
        updatedAt: serverTimestamp(),
      })
      await batch.commit()
      setRows(seededRows)
      setMessage(`${template.eventType} run-sheet preset added. Assign coordinators and adjust the times to match the final programme.`)
    } catch (seedError) {
      console.error('[event-production] Unable to seed suggested run sheet', seedError)
      setError('The suggested run sheet could not be added.')
    } finally {
      setSaving(false)
    }
  }

  function resetRow() {
    setEditingId(null)
    setRowForm(EMPTY_ROW)
  }

  async function saveRow(event: React.FormEvent) {
    event.preventDefault()
    if (!rowForm.time || !rowForm.activity.trim()) {
      setError('Enter a time and duty / activity.')
      return
    }
    setSaving(true)
    setMessage('')
    setError('')
    const sortOrder = editingId ? rows.find(item => item.id === editingId)?.sortOrder ?? rows.length + 1 : rows.length + 1
    const localRow: Omit<TimelineRow, 'id'> = {
      phase: rowForm.phase.trim(),
      time: rowForm.time,
      activity: rowForm.activity.trim(),
      coordinator: rowForm.coordinator.trim(),
      contactNumber: rowForm.contactNumber.trim(),
      progressStatus: rowForm.progressStatus,
      remarks: rowForm.remarks.trim(),
      sortOrder,
    }
    const payload = { ...localRow, updatedAt: serverTimestamp() }
    try {
      if (editingId) {
        await updateDoc(doc(timelineRef, editingId), payload)
        setRows(previous => sortRows(previous.map(item => item.id === editingId ? { id: item.id, ...localRow } : item)))
        setMessage('Production timeline item updated.')
      } else {
        const itemRef = await addDoc(timelineRef, { ...payload, createdAt: serverTimestamp() })
        setRows(previous => sortRows([...previous, { id: itemRef.id, ...localRow }]))
        setMessage('Production timeline item added.')
      }
      resetRow()
    } catch (saveError) {
      console.error('[event-production] Unable to save production timeline item', saveError)
      setError('The production timeline item could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function editRow(row: TimelineRow) {
    setEventDayMode(false)
    setEditingId(row.id)
    setRowForm({
      phase: row.phase,
      time: row.time,
      activity: row.activity,
      coordinator: row.coordinator,
      contactNumber: row.contactNumber,
      progressStatus: row.progressStatus,
      remarks: row.remarks,
    })
  }

  async function updateRowStatus(row: TimelineRow, progressStatus: string) {
    setError('')
    setMessage('')
    try {
      await updateDoc(doc(timelineRef, row.id), { progressStatus, updatedAt: serverTimestamp() })
      setRows(previous => previous.map(item => item.id === row.id ? { ...item, progressStatus } : item))
    } catch (statusError) {
      console.error('[event-production] Unable to update production status', statusError)
      setError('The production item status could not be updated.')
    }
  }

  async function removeRow(row: TimelineRow) {
    if (!window.confirm(`Delete “${row.activity}” from the production timeline?`)) return
    setError('')
    try {
      await deleteDoc(doc(timelineRef, row.id))
      setRows(previous => previous.filter(item => item.id !== row.id))
      setMessage('Production timeline item deleted.')
      if (editingId === row.id) resetRow()
    } catch (deleteError) {
      console.error('[event-production] Unable to delete production timeline item', deleteError)
      setError('The production timeline item could not be deleted.')
    }
  }

  function printTimeline() {
    const popup = window.open('', '_blank', 'width=1200,height=800')
    if (!popup) {
      setError('Pop-ups are blocked. Allow pop-ups to print the production timeline.')
      return
    }
    const setupHtml = setupRows(setup, template).map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('')
    const rowsHtml = rows.map(row => `<tr><td>${escapeHtml(row.phase || '—')}</td><td>${escapeHtml(row.time || '—')}</td><td>${escapeHtml(row.activity)}</td><td>${escapeHtml(row.coordinator || '—')}</td><td>${escapeHtml(row.contactNumber || '—')}</td><td>${escapeHtml(PROGRESS_LABELS[row.progressStatus] || row.progressStatus || 'Planned')}${row.remarks ? `<br/><small>${escapeHtml(row.remarks)}</small>` : ''}</td></tr>`).join('')
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(eventTitle)} - Event Production Timeline</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#17211d}h1{margin:0}.sub{color:#64748b;margin:5px 0 20px}.setup{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border:1px solid #d9e0dc}.setup div{padding:8px 10px;border-bottom:1px solid #d9e0dc}.setup strong{display:block;font-size:11px;text-transform:uppercase;color:#64748b}.setup span{display:block;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:22px;font-size:12px}th,td{border:1px solid #cbd5cf;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f2}small{color:#64748b}@media print{body{padding:0}.setup{break-inside:avoid}}</style></head><body><h1>${escapeHtml(eventTitle)}</h1><p class="sub">${escapeHtml(template.title)} · Production readiness ${readiness.score}% · Private and confidential</p><div class="setup">${setupHtml || '<div><span>No production setup details recorded.</span></div>'}</div><table><thead><tr><th>Event phase</th><th>Time</th><th>Duty / activity</th><th>Executor / coordinator</th><th>Contact number</th><th>Progress / remarks</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="6">No production timeline items yet.</td></tr>'}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }

  function renderField(field: ProductionField) {
    const value = setup[field.key] || ''
    const className = field.wide ? 'event-planning__field--wide' : undefined
    if (field.type === 'select') {
      return (
        <label key={field.key} className={className}>{field.label}
          <select value={value} onChange={e => setSetupValue(field.key, e.target.value)}>
            <option value="">Not set</option>
            {(field.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )
    }
    if (field.type === 'textarea') {
      return <label key={field.key} className={className}>{field.label}<textarea rows={3} value={value} onChange={e => setSetupValue(field.key, e.target.value)} placeholder={field.placeholder} /></label>
    }
    return <label key={field.key} className={className}>{field.label}<input type={field.type === 'number' ? 'number' : 'text'} min={field.type === 'number' ? '0' : undefined} value={value} onChange={e => setSetupValue(field.key, e.target.value)} placeholder={field.placeholder} /></label>
  }

  if (loading) return <div className="event-planning__loading"><span className="event-planning__spinner" /><p>Loading production timeline…</p></div>

  const exactTemplateMatch = template.eventType === eventType

  if (eventDayMode) {
    return (
      <div>
        {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
        <section className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>Event Day Mode · {eventType}</p>
              <h3>{eventTitle}</h3>
              <p>{formatEventDate(basics.eventDate)} · {basics.startTime || 'Time not set'} · {basics.venue || 'Venue not set'}</p>
            </div>
            <button type="button" className="button button--ghost" onClick={() => setEventDayMode(false)}>Exit Event Day Mode</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 14 }}>
            <div className="event-planning__notes" style={{ marginTop: 0 }}><strong>{readiness.score}%</strong><p>Production readiness</p></div>
            <div className="event-planning__notes" style={{ marginTop: 0 }}><strong>{completedRows}/{rows.length}</strong><p>Run-sheet items complete</p></div>
            <div className="event-planning__notes" style={{ marginTop: 0 }}><strong>{issueRows.length}</strong><p>Issues needing attention</p></div>
          </div>
        </section>

        {nextItem ? (
          <section className="event-planning__workspace-preview" style={{ marginTop: 14, border: '2px solid #17211d' }}>
            <p style={{ margin: 0, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 800, color: '#64748b' }}>Current / next production item</p>
            <h3 style={{ marginTop: 5 }}>{nextItem.time} · {nextItem.activity}</h3>
            <p>{[nextItem.phase, nextItem.coordinator ? `Coordinator: ${nextItem.coordinator}` : 'Coordinator not assigned', nextItem.contactNumber ? `Contact: ${nextItem.contactNumber}` : ''].filter(Boolean).join(' · ')}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className="button button--primary" onClick={() => void updateRowStatus(nextItem, 'done')}>Mark done</button>
              <button type="button" className="button button--ghost" onClick={() => void updateRowStatus(nextItem, 'in_progress')}>In progress</button>
              <button type="button" className="button button--ghost" onClick={() => void updateRowStatus(nextItem, 'issue')}>Flag issue</button>
              {nextItem.contactNumber ? <a className="button button--ghost" href={`tel:${nextItem.contactNumber}`}>Call contact</a> : null}
            </div>
          </section>
        ) : rows.length ? (
          <section className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>Run sheet complete</h3>
            <p>All production timeline items are marked done.</p>
          </section>
        ) : null}

        <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
          {!rows.length ? <div className="event-planning__notes"><strong>No run sheet yet</strong><p>Exit Event Day Mode and apply the suggested run sheet first.</p></div> : null}
          {rows.map(row => (
            <article key={row.id} className="event-planning__notes" style={{ marginTop: 0, opacity: row.progressStatus === 'done' ? .7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 420px' }}>
                  <strong>{row.time} · {row.activity}</strong>
                  <p style={{ marginTop: 4 }}>{[row.phase, row.coordinator ? `Coordinator: ${row.coordinator}` : '', row.contactNumber ? `Contact: ${row.contactNumber}` : '', `Status: ${PROGRESS_LABELS[row.progressStatus] || row.progressStatus}`].filter(Boolean).join(' · ')}</p>
                  {row.remarks ? <p style={{ marginTop: 4 }}>{row.remarks}</p> : null}
                </div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {row.progressStatus !== 'done' ? <button type="button" className="button button--ghost" onClick={() => void updateRowStatus(row, 'done')}>Done</button> : null}
                  <button type="button" className="button button--ghost" onClick={() => void updateRowStatus(row, row.progressStatus === 'issue' ? 'planned' : 'issue')}>{row.progressStatus === 'issue' ? 'Clear issue' : 'Issue'}</button>
                  {row.contactNumber ? <a className="button button--ghost" href={`tel:${row.contactNumber}`}>Call</a> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
      {message ? <p className="event-planning__alert event-planning__alert--success">{message}<button type="button" onClick={() => setMessage('')} aria-label="Dismiss">×</button></p> : null}

      <section className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 460px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '.75rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>Detected event type: {eventType}</p>
            <h3>{template.title}</h3>
            <p>{template.description}</p>
            {!exactTemplateMatch ? <p style={{ marginTop: 6, fontSize: '.78rem', color: '#64748b' }}>Using the closest Sedifex template: {template.eventType}.</p> : null}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button button--primary" onClick={() => { setEventDayClock(new Date()); setEventDayMode(true) }}>Event Day Mode</button>
            <button type="button" className="button button--ghost" onClick={printTimeline}>Print production timeline</button>
          </div>
        </div>
      </section>

      <section className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h3>Production readiness · {readiness.score}%</h3><p>Based on event basics, production details, run-sheet coverage and assigned responsibility.</p></div>
          <strong style={{ fontSize: '1.5rem' }}>{readiness.score}%</strong>
        </div>
        <div style={{ height: 9, borderRadius: 999, background: '#e7ece8', overflow: 'hidden', marginTop: 12 }}><div style={{ width: `${readiness.score}%`, height: '100%', background: '#17211d' }} /></div>
        {readiness.missing.length ? <div style={{ display: 'grid', gap: 5, marginTop: 12 }}>{readiness.missing.map(item => <p key={item} style={{ margin: 0, fontSize: '.78rem', color: '#64748b' }}>• {item}</p>)}</div> : <p style={{ marginTop: 10 }}>Production setup is ready for event-day execution.</p>}
      </section>

      <form onSubmit={saveSetup} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
        <h3>Production details · {template.eventType}</h3>
        <div className="event-planning__form-grid" style={{ marginTop: 12 }}>{template.fields.map(renderField)}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save production setup'}</button></div>
      </form>

      {!rows.length ? (
        <section className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
          <h3>Suggested {template.eventType} run sheet</h3>
          <p>Sedifex can create a practical starting timeline from the event start time. You can change every time, activity and coordinator afterwards.</p>
          <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
            {preset.map(item => <div key={`${item.phase}-${item.offsetMinutes}-${item.activity}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}><strong style={{ minWidth: 52 }}>{clockFromOffset(basics.startTime, item.offsetMinutes) || '—'}</strong><span>{item.phase} · {item.activity}</span></div>)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" className="button button--primary" disabled={saving || !basics.startTime} onClick={() => void seedSuggestedTimeline()}>{saving ? 'Adding…' : 'Use suggested run sheet'}</button></div>
        </section>
      ) : null}

      <form onSubmit={saveRow} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
        <h3>{editingId ? 'Edit production timeline item' : 'Add production timeline item'}</h3>
        <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
          <label>Event phase<input value={rowForm.phase} onChange={e => setRowForm(previous => ({ ...previous, phase: e.target.value }))} placeholder={template.phasePlaceholder} /></label>
          <label>Time<input required type="time" value={rowForm.time} onChange={e => setRowForm(previous => ({ ...previous, time: e.target.value }))} /></label>
          <label className="event-planning__field--wide">Duty / activity<input required value={rowForm.activity} onChange={e => setRowForm(previous => ({ ...previous, activity: e.target.value }))} placeholder="e.g. Sound check, registration opens, vendor setup" /></label>
          <label>Executor / coordinator<input value={rowForm.coordinator} onChange={e => setRowForm(previous => ({ ...previous, coordinator: e.target.value }))} placeholder="Person or team in charge" /></label>
          <label>Contact number<input value={rowForm.contactNumber} onChange={e => setRowForm(previous => ({ ...previous, contactNumber: e.target.value }))} placeholder="Phone number" /></label>
          <label>Progress<select value={rowForm.progressStatus} onChange={e => setRowForm(previous => ({ ...previous, progressStatus: e.target.value }))}>{Object.entries(PROGRESS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="event-planning__field--wide">Remarks<textarea rows={2} value={rowForm.remarks} onChange={e => setRowForm(previous => ({ ...previous, remarks: e.target.value }))} placeholder="Progress notes, delays, dependencies or instructions" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>{editingId ? <button type="button" className="button button--ghost" onClick={resetRow}>Cancel</button> : null}<button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save item' : 'Add to production timeline'}</button></div>
      </form>

      <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
        {!rows.length ? <div className="event-planning__notes"><strong>No production timeline items yet</strong><p>Use the suggested run sheet above or add event-day duties manually.</p></div> : null}
        {rows.map(row => (
          <article key={row.id} className="event-planning__notes" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 420px' }}>
                <strong>{row.time} · {row.activity}</strong>
                <p style={{ marginTop: 4 }}>{[row.phase ? `Phase ${row.phase}` : '', row.coordinator ? `Coordinator: ${row.coordinator}` : '', row.contactNumber ? `Contact: ${row.contactNumber}` : '', `Progress: ${PROGRESS_LABELS[row.progressStatus] || row.progressStatus}`].filter(Boolean).join(' · ')}{row.remarks ? ` · ${row.remarks}` : ''}</p>
              </div>
              <div style={{ display: 'flex', gap: 7 }}><button type="button" className="button button--ghost" onClick={() => editRow(row)}>Edit</button><button type="button" className="button button--ghost" onClick={() => void removeRow(row)}>Delete</button></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
