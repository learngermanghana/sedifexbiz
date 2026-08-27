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
} from 'firebase/firestore'
import { db } from '../firebase'

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
}

type ProductionSetup = {
  projectLabel: string
  confirmedGuests: string
  eventTheme: string
  eventColours: string
  strictlyByInvitation: string
  placedSeating: string
  bridalPartySize: string
  reservedTables: string
  ceremonySetupGuests: string
  receptionSetupGuests: string
  bridePrepLocation: string
  groomPrepLocation: string
  ceremonyLocation: string
  receptionLocation: string
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

const EMPTY_SETUP: ProductionSetup = {
  projectLabel: '',
  confirmedGuests: '',
  eventTheme: '',
  eventColours: '',
  strictlyByInvitation: '',
  placedSeating: '',
  bridalPartySize: '',
  reservedTables: '',
  ceremonySetupGuests: '',
  receptionSetupGuests: '',
  bridePrepLocation: '',
  groomPrepLocation: '',
  ceremonyLocation: '',
  receptionLocation: '',
}

const EMPTY_ROW = {
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

function setupFrom(value: unknown, fallbackColours = ''): ProductionSetup {
  const source = record(value)
  return {
    projectLabel: text(source.projectLabel),
    confirmedGuests: text(source.confirmedGuests) || (typeof source.confirmedGuests === 'number' ? String(source.confirmedGuests) : ''),
    eventTheme: text(source.eventTheme),
    eventColours: text(source.eventColours) || fallbackColours,
    strictlyByInvitation: text(source.strictlyByInvitation),
    placedSeating: text(source.placedSeating),
    bridalPartySize: text(source.bridalPartySize) || (typeof source.bridalPartySize === 'number' ? String(source.bridalPartySize) : ''),
    reservedTables: text(source.reservedTables) || (typeof source.reservedTables === 'number' ? String(source.reservedTables) : ''),
    ceremonySetupGuests: text(source.ceremonySetupGuests) || (typeof source.ceremonySetupGuests === 'number' ? String(source.ceremonySetupGuests) : ''),
    receptionSetupGuests: text(source.receptionSetupGuests) || (typeof source.receptionSetupGuests === 'number' ? String(source.receptionSetupGuests) : ''),
    bridePrepLocation: text(source.bridePrepLocation),
    groomPrepLocation: text(source.groomPrepLocation),
    ceremonyLocation: text(source.ceremonyLocation),
    receptionLocation: text(source.receptionLocation),
  }
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function setupRows(setup: ProductionSetup) {
  return [
    ['Project / event', setup.projectLabel],
    ['Confirmed guests', setup.confirmedGuests],
    ['Event theme', setup.eventTheme],
    ['Event colours', setup.eventColours],
    ['Strictly by invitation', setup.strictlyByInvitation ? setup.strictlyByInvitation.toUpperCase() : ''],
    ['Assigned / placed seating', setup.placedSeating ? setup.placedSeating.toUpperCase() : ''],
    ['Bridal party size', setup.bridalPartySize],
    ['Reserved tables', setup.reservedTables],
    ['Guests being set up for - ceremony', setup.ceremonySetupGuests],
    ['Guests being set up for - reception', setup.receptionSetupGuests],
    ['Phase 1 - Bride dress-up location', setup.bridePrepLocation],
    ['Phase 2 - Groom dress-up location', setup.groomPrepLocation],
    ['Phase 3 - Ceremony location', setup.ceremonyLocation],
    ['Phase 4 - Reception location', setup.receptionLocation],
  ].filter(([, value]) => Boolean(value))
}

export default function EventProductionTimeline({ storeId, eventId, eventTitle }: Props) {
  const eventRef = useMemo(() => doc(db, 'stores', storeId, 'events', eventId), [storeId, eventId])
  const timelineRef = useMemo(() => collection(eventRef, 'productionTimeline'), [eventRef])
  const [setup, setSetup] = useState<ProductionSetup>(EMPTY_SETUP)
  const [rows, setRows] = useState<TimelineRow[]>([])
  const [rowForm, setRowForm] = useState(EMPTY_ROW)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [eventSnapshot, timelineSnapshot] = await Promise.all([
        getDoc(eventRef),
        getDocs(timelineRef),
      ])
      if (!eventSnapshot.exists()) throw new Error('EVENT_NOT_FOUND')
      const eventData = eventSnapshot.data() as Record<string, unknown>
      const brief = record(eventData.clientBrief)
      setSetup(setupFrom(eventData.productionSetup, text(brief.themeColours)))
      setRows(timelineSnapshot.docs
        .map(item => mapRow(item.id, item.data()))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time) || a.phase.localeCompare(b.phase)))
    } catch (loadError) {
      console.error('[event-production] Unable to load production timeline', loadError)
      setError('The production timeline could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [eventRef, timelineRef])

  useEffect(() => { void load() }, [load])

  async function saveSetup(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await updateDoc(eventRef, {
        productionSetup: {
          ...setup,
          confirmedGuests: setup.confirmedGuests.trim(),
          bridalPartySize: setup.bridalPartySize.trim(),
          reservedTables: setup.reservedTables.trim(),
          ceremonySetupGuests: setup.ceremonySetupGuests.trim(),
          receptionSetupGuests: setup.receptionSetupGuests.trim(),
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      })
      setMessage('Production setup saved.')
    } catch (saveError) {
      console.error('[event-production] Unable to save production setup', saveError)
      setError('Production setup could not be saved.')
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
    const payload = {
      phase: rowForm.phase.trim(),
      time: rowForm.time,
      activity: rowForm.activity.trim(),
      coordinator: rowForm.coordinator.trim(),
      contactNumber: rowForm.contactNumber.trim(),
      progressStatus: rowForm.progressStatus,
      remarks: rowForm.remarks.trim(),
      sortOrder: editingId ? rows.find(item => item.id === editingId)?.sortOrder ?? rows.length + 1 : rows.length + 1,
      updatedAt: serverTimestamp(),
    }
    try {
      if (editingId) {
        await updateDoc(doc(timelineRef, editingId), payload)
        setMessage('Production timeline item updated.')
      } else {
        await addDoc(timelineRef, { ...payload, createdAt: serverTimestamp() })
        setMessage('Production timeline item added.')
      }
      resetRow()
      await load()
    } catch (saveError) {
      console.error('[event-production] Unable to save production timeline item', saveError)
      setError('The production timeline item could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function editRow(row: TimelineRow) {
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

  async function removeRow(row: TimelineRow) {
    if (!window.confirm(`Delete “${row.activity}” from the production timeline?`)) return
    setError('')
    try {
      await deleteDoc(doc(timelineRef, row.id))
      setMessage('Production timeline item deleted.')
      if (editingId === row.id) resetRow()
      await load()
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
    const setupHtml = setupRows(setup).map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('')
    const rowsHtml = rows.map(row => `<tr><td>${escapeHtml(row.phase || '—')}</td><td>${escapeHtml(row.time || '—')}</td><td>${escapeHtml(row.activity)}</td><td>${escapeHtml(row.coordinator || '—')}</td><td>${escapeHtml(row.contactNumber || '—')}</td><td>${escapeHtml(PROGRESS_LABELS[row.progressStatus] || row.progressStatus || 'Planned')}${row.remarks ? `<br/><small>${escapeHtml(row.remarks)}</small>` : ''}</td></tr>`).join('')
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(eventTitle)} - Event Production Timeline</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#17211d}h1{margin:0}.sub{color:#64748b;margin:5px 0 20px}.setup{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border:1px solid #d9e0dc}.setup div{padding:8px 10px;border-bottom:1px solid #d9e0dc}.setup strong{display:block;font-size:11px;text-transform:uppercase;color:#64748b}.setup span{display:block;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:22px;font-size:12px}th,td{border:1px solid #cbd5cf;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f2}small{color:#64748b}@media print{body{padding:0}.setup{break-inside:avoid}}</style></head><body><h1>${escapeHtml(eventTitle)}</h1><p class="sub">Event Production Timeline · Private and confidential</p><div class="setup">${setupHtml || '<div><span>No production setup details recorded.</span></div>'}</div><table><thead><tr><th>Event phase</th><th>Time</th><th>Duty / activity</th><th>Executor / coordinator</th><th>Contact number</th><th>Progress / remarks</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="6">No production timeline items yet.</td></tr>'}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }

  if (loading) return <div className="event-planning__loading"><span className="event-planning__spinner" /><p>Loading production timeline…</p></div>

  return (
    <div>
      {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
      {message ? <p className="event-planning__alert event-planning__alert--success">{message}<button type="button" onClick={() => setMessage('')} aria-label="Dismiss">×</button></p> : null}

      <section className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><h3>Event production setup</h3><p>Record the event-level production details, phase locations and guest setup numbers.</p></div>
          <button type="button" className="button button--ghost" onClick={printTimeline}>Print production timeline</button>
        </div>
      </section>

      <form onSubmit={saveSetup} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
        <h3>Production details</h3>
        <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
          <label>Project / event<input value={setup.projectLabel} onChange={e => setSetup(previous => ({ ...previous, projectLabel: e.target.value }))} placeholder="e.g. Engagement & reception" /></label>
          <label>Confirmed guests<input type="number" min="0" value={setup.confirmedGuests} onChange={e => setSetup(previous => ({ ...previous, confirmedGuests: e.target.value }))} /></label>
          <label>Event theme<input value={setup.eventTheme} onChange={e => setSetup(previous => ({ ...previous, eventTheme: e.target.value }))} placeholder="Theme or concept" /></label>
          <label>Event colours<input value={setup.eventColours} onChange={e => setSetup(previous => ({ ...previous, eventColours: e.target.value }))} placeholder="Navy, burgundy, ivory…" /></label>
          <label>Strictly by invitation?<select value={setup.strictlyByInvitation} onChange={e => setSetup(previous => ({ ...previous, strictlyByInvitation: e.target.value }))}><option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label>Assigned / placed seating?<select value={setup.placedSeating} onChange={e => setSetup(previous => ({ ...previous, placedSeating: e.target.value }))}><option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label>Bridal party size<input type="number" min="0" value={setup.bridalPartySize} onChange={e => setSetup(previous => ({ ...previous, bridalPartySize: e.target.value }))} /></label>
          <label>Reserved tables<input type="number" min="0" value={setup.reservedTables} onChange={e => setSetup(previous => ({ ...previous, reservedTables: e.target.value }))} /></label>
          <label>Guests setup for ceremony<input type="number" min="0" value={setup.ceremonySetupGuests} onChange={e => setSetup(previous => ({ ...previous, ceremonySetupGuests: e.target.value }))} /></label>
          <label>Guests setup for reception<input type="number" min="0" value={setup.receptionSetupGuests} onChange={e => setSetup(previous => ({ ...previous, receptionSetupGuests: e.target.value }))} /></label>
          <label>Phase 1 · Bride dress-up location<input value={setup.bridePrepLocation} onChange={e => setSetup(previous => ({ ...previous, bridePrepLocation: e.target.value }))} /></label>
          <label>Phase 2 · Groom dress-up location<input value={setup.groomPrepLocation} onChange={e => setSetup(previous => ({ ...previous, groomPrepLocation: e.target.value }))} /></label>
          <label>Phase 3 · Ceremony location<input value={setup.ceremonyLocation} onChange={e => setSetup(previous => ({ ...previous, ceremonyLocation: e.target.value }))} /></label>
          <label>Phase 4 · Reception location<input value={setup.receptionLocation} onChange={e => setSetup(previous => ({ ...previous, receptionLocation: e.target.value }))} /></label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save production setup'}</button></div>
      </form>

      <form onSubmit={saveRow} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
        <h3>{editingId ? 'Edit production timeline item' : 'Add production timeline item'}</h3>
        <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
          <label>Event phase<input value={rowForm.phase} onChange={e => setRowForm(previous => ({ ...previous, phase: e.target.value }))} placeholder="1, 2, 3, 4, 1 & 2…" /></label>
          <label>Time<input required type="time" value={rowForm.time} onChange={e => setRowForm(previous => ({ ...previous, time: e.target.value }))} /></label>
          <label className="event-planning__field--wide">Duty / activity<input required value={rowForm.activity} onChange={e => setRowForm(previous => ({ ...previous, activity: e.target.value }))} placeholder="e.g. Sound & DJ, coordinators arrive, buffet setup" /></label>
          <label>Executor / coordinator<input value={rowForm.coordinator} onChange={e => setRowForm(previous => ({ ...previous, coordinator: e.target.value }))} placeholder="Person or team in charge" /></label>
          <label>Contact number<input value={rowForm.contactNumber} onChange={e => setRowForm(previous => ({ ...previous, contactNumber: e.target.value }))} placeholder="Phone number" /></label>
          <label>Progress<select value={rowForm.progressStatus} onChange={e => setRowForm(previous => ({ ...previous, progressStatus: e.target.value }))}>{Object.entries(PROGRESS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="event-planning__field--wide">Remarks<textarea rows={2} value={rowForm.remarks} onChange={e => setRowForm(previous => ({ ...previous, remarks: e.target.value }))} placeholder="Progress notes, delays, dependencies or instructions" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>{editingId ? <button type="button" className="button button--ghost" onClick={resetRow}>Cancel</button> : null}<button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save item' : 'Add to production timeline'}</button></div>
      </form>

      <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
        {!rows.length ? <div className="event-planning__notes"><strong>No production timeline items yet</strong><p>Add event-day duties in time order.</p></div> : null}
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
