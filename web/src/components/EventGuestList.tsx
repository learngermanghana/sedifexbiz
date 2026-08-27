import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import './EventGuestList.css'

type RsvpStatus = 'pending' | 'confirmed' | 'declined'
type AttendanceFilter = 'all' | 'checked_in' | 'not_checked_in'
type RsvpFilter = 'all' | RsvpStatus

type GuestRecord = {
  id: string
  name: string
  phone: string
  email: string
  group: string
  table: string
  plusOne: boolean
  plusOneName: string
  rsvpStatus: RsvpStatus
  invitationSent: boolean
  checkedIn: boolean
  dietaryRequirements: string
  specialRequirements: string
  notes: string
  createdAt: Date | null
  updatedAt: Date | null
}

type GuestForm = {
  name: string
  phone: string
  email: string
  group: string
  table: string
  plusOne: boolean
  plusOneName: string
  rsvpStatus: RsvpStatus
  invitationSent: boolean
  checkedIn: boolean
  dietaryRequirements: string
  specialRequirements: string
  notes: string
}

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
  expectedGuestCount?: number
}

const EMPTY_FORM: GuestForm = {
  name: '',
  phone: '',
  email: '',
  group: '',
  table: '',
  plusOne: false,
  plusOneName: '',
  rsvpStatus: 'pending',
  invitationSent: false,
  checkedIn: false,
  dietaryRequirements: '',
  specialRequirements: '',
  notes: '',
}

const RSVP_LABELS: Record<RsvpStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function bool(value: unknown) {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'sent', 'checked', 'checked-in'].includes(normalized)
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate()
  if (value && typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate()
  }
  return null
}

function normalizeRsvp(value: unknown): RsvpStatus {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['confirmed', 'yes', 'accepted', 'attending'].includes(normalized)) return 'confirmed'
  if (['declined', 'no', 'not_attending', 'notattending'].includes(normalized)) return 'declined'
  return 'pending'
}

function mapGuest(id: string, data: Record<string, unknown>): GuestRecord {
  return {
    id,
    name: text(data.name) || 'Unnamed guest',
    phone: text(data.phone),
    email: text(data.email),
    group: text(data.group),
    table: text(data.table),
    plusOne: Boolean(data.plusOne),
    plusOneName: text(data.plusOneName),
    rsvpStatus: normalizeRsvp(data.rsvpStatus),
    invitationSent: Boolean(data.invitationSent),
    checkedIn: Boolean(data.checkedIn),
    dietaryRequirements: text(data.dietaryRequirements),
    specialRequirements: text(data.specialRequirements),
    notes: text(data.notes),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function guestToForm(guest: GuestRecord): GuestForm {
  return {
    name: guest.name === 'Unnamed guest' ? '' : guest.name,
    phone: guest.phone,
    email: guest.email,
    group: guest.group,
    table: guest.table,
    plusOne: guest.plusOne,
    plusOneName: guest.plusOneName,
    rsvpStatus: guest.rsvpStatus,
    invitationSent: guest.invitationSent,
    checkedIn: guest.checkedIn,
    dietaryRequirements: guest.dietaryRequirements,
    specialRequirements: guest.specialRequirements,
    notes: guest.notes,
  }
}

function csvEscape(value: unknown) {
  const stringValue = String(value ?? '')
  if (!/[",\n\r]/.test(stringValue)) return stringValue
  return `"${stringValue.replace(/"/g, '""')}"`
}

function parseCsv(content: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (char === '"' && quoted && next === '"') {
      field += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      row.push(field)
      field = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      row.push(field)
      if (row.some(cell => cell.trim())) rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }

  row.push(field)
  if (row.some(cell => cell.trim())) rows.push(row)
  return rows
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function GuestModal({ guest, onClose, onSave }: {
  guest: GuestRecord | null
  onClose: () => void
  onSave: (form: GuestForm) => Promise<void>
}) {
  const [form, setForm] = useState<GuestForm>(() => guest ? guestToForm(guest) : EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof GuestForm>(key: K, value: GuestForm[K]) {
    setForm(previous => ({ ...previous, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Enter the guest name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch (saveError) {
      console.error('[event-guests] Unable to save guest', saveError)
      setError('The guest could not be saved. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="event-guests__modal-backdrop" onMouseDown={onClose}>
      <section className="event-guests__modal" role="dialog" aria-modal="true" aria-labelledby="event-guest-form-title" onMouseDown={event => event.stopPropagation()}>
        <header className="event-guests__modal-heading">
          <div>
            <p className="event-guests__eyebrow">{guest ? 'Update guest' : 'Add guest'}</p>
            <h2 id="event-guest-form-title">{guest ? guest.name : 'Guest details'}</h2>
          </div>
          <button type="button" className="event-guests__icon-button" onClick={onClose} aria-label="Close guest form">×</button>
        </header>

        {error ? <p className="event-guests__message event-guests__message--error">{error}</p> : null}

        <form onSubmit={submit}>
          <div className="event-guests__form-grid">
            <label className="event-guests__field--wide">Guest name<input required value={form.name} onChange={event => update('name', event.target.value)} placeholder="Full name" /></label>
            <label>Phone<input value={form.phone} onChange={event => update('phone', event.target.value)} placeholder="024 000 0000" /></label>
            <label>Email<input type="email" value={form.email} onChange={event => update('email', event.target.value)} placeholder="guest@example.com" /></label>
            <label>Group / household<input value={form.group} onChange={event => update('group', event.target.value)} placeholder="Bride's family, VIP, Company A" /></label>
            <label>Table / seat<input value={form.table} onChange={event => update('table', event.target.value)} placeholder="Table 8" /></label>
            <label>RSVP status<select value={form.rsvpStatus} onChange={event => update('rsvpStatus', event.target.value as RsvpStatus)}>{Object.entries(RSVP_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label className="event-guests__checkbox"><input type="checkbox" checked={form.invitationSent} onChange={event => update('invitationSent', event.target.checked)} /><span>Invitation sent</span></label>
            <label className="event-guests__checkbox"><input type="checkbox" checked={form.checkedIn} onChange={event => update('checkedIn', event.target.checked)} /><span>Checked in</span></label>
            <label className="event-guests__checkbox event-guests__field--wide"><input type="checkbox" checked={form.plusOne} onChange={event => update('plusOne', event.target.checked)} /><span>Guest has a plus-one</span></label>
            {form.plusOne ? <label className="event-guests__field--wide">Plus-one name<input value={form.plusOneName} onChange={event => update('plusOneName', event.target.value)} placeholder="Optional name" /></label> : null}
            <label className="event-guests__field--wide">Dietary requirements<textarea rows={2} value={form.dietaryRequirements} onChange={event => update('dietaryRequirements', event.target.value)} placeholder="Allergies, vegetarian, no seafood…" /></label>
            <label className="event-guests__field--wide">Special requirements<textarea rows={2} value={form.specialRequirements} onChange={event => update('specialRequirements', event.target.value)} placeholder="Accessibility, security, child seat, protocol…" /></label>
            <label className="event-guests__field--wide">Internal notes<textarea rows={3} value={form.notes} onChange={event => update('notes', event.target.value)} /></label>
          </div>
          <footer className="event-guests__modal-actions">
            <button type="button" className="button button--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : guest ? 'Save changes' : 'Add guest'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export default function EventGuestList({ storeId, eventId, eventTitle, expectedGuestCount = 0 }: Props) {
  const [guests, setGuests] = useState<GuestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [rsvpFilter, setRsvpFilter] = useState<RsvpFilter>('all')
  const [attendanceFilter, setAttendanceFilter] = useState<AttendanceFilter>('all')
  const [editingGuest, setEditingGuest] = useState<GuestRecord | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [busyGuestId, setBusyGuestId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const guestsRef = useMemo(() => collection(db, 'stores', storeId, 'events', eventId, 'guests'), [eventId, storeId])

  const loadGuests = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const snapshot = await getDocs(guestsRef)
      const rows = snapshot.docs.map(snapshotDoc => mapGuest(snapshotDoc.id, snapshotDoc.data()))
      rows.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      setGuests(rows)
    } catch (loadError) {
      console.error('[event-guests] Unable to load guests', loadError)
      setError('The guest list could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [guestsRef])

  useEffect(() => { void loadGuests() }, [loadGuests])

  const stats = useMemo(() => {
    const confirmed = guests.filter(guest => guest.rsvpStatus === 'confirmed').length
    const declined = guests.filter(guest => guest.rsvpStatus === 'declined').length
    const pending = guests.filter(guest => guest.rsvpStatus === 'pending').length
    const checkedIn = guests.filter(guest => guest.checkedIn).length
    const seats = guests.reduce((total, guest) => total + 1 + (guest.plusOne ? 1 : 0), 0)
    const confirmedSeats = guests.reduce((total, guest) => total + (guest.rsvpStatus === 'confirmed' ? 1 + (guest.plusOne ? 1 : 0) : 0), 0)
    return { confirmed, declined, pending, checkedIn, seats, confirmedSeats }
  }, [guests])

  const visibleGuests = useMemo(() => {
    const queryText = search.trim().toLowerCase()
    return guests.filter(guest => {
      if (rsvpFilter !== 'all' && guest.rsvpStatus !== rsvpFilter) return false
      if (attendanceFilter === 'checked_in' && !guest.checkedIn) return false
      if (attendanceFilter === 'not_checked_in' && guest.checkedIn) return false
      if (!queryText) return true
      return [guest.name, guest.phone, guest.email, guest.group, guest.table, guest.plusOneName]
        .some(value => value.toLowerCase().includes(queryText))
    })
  }, [attendanceFilter, guests, rsvpFilter, search])

  function openAddGuest() {
    setEditingGuest(null)
    setModalOpen(true)
  }

  function openEditGuest(guest: GuestRecord) {
    setEditingGuest(guest)
    setModalOpen(true)
  }

  async function saveGuest(form: GuestForm) {
    const payload = {
      name: form.name.trim(),
      nameLower: form.name.trim().toLowerCase(),
      phone: form.phone.trim(),
      email: form.email.trim().toLowerCase(),
      group: form.group.trim(),
      table: form.table.trim(),
      plusOne: form.plusOne,
      plusOneName: form.plusOne ? form.plusOneName.trim() : '',
      rsvpStatus: form.rsvpStatus,
      invitationSent: form.invitationSent,
      checkedIn: form.checkedIn,
      checkedInAt: form.checkedIn ? serverTimestamp() : null,
      dietaryRequirements: form.dietaryRequirements.trim(),
      specialRequirements: form.specialRequirements.trim(),
      notes: form.notes.trim(),
      updatedAt: serverTimestamp(),
    }

    if (editingGuest) {
      await updateDoc(doc(guestsRef, editingGuest.id), payload)
    } else {
      await addDoc(guestsRef, { ...payload, createdAt: serverTimestamp() })
    }
    setModalOpen(false)
    setEditingGuest(null)
    setMessage(editingGuest ? 'Guest updated.' : 'Guest added.')
    await loadGuests()
  }

  async function quickUpdate(guest: GuestRecord, patch: Record<string, unknown>, successMessage: string) {
    setBusyGuestId(guest.id)
    setMessage(null)
    try {
      await updateDoc(doc(guestsRef, guest.id), { ...patch, updatedAt: serverTimestamp() })
      setMessage(successMessage)
      await loadGuests()
    } catch (updateError) {
      console.error('[event-guests] Unable to update guest', updateError)
      setError('The guest could not be updated.')
    } finally {
      setBusyGuestId(null)
    }
  }

  async function removeGuest(guest: GuestRecord) {
    if (!window.confirm(`Remove ${guest.name} from this event guest list?`)) return
    setBusyGuestId(guest.id)
    try {
      await deleteDoc(doc(guestsRef, guest.id))
      setMessage('Guest removed.')
      await loadGuests()
    } catch (deleteError) {
      console.error('[event-guests] Unable to delete guest', deleteError)
      setError('The guest could not be removed.')
    } finally {
      setBusyGuestId(null)
    }
  }

  function exportCsv() {
    const headers = ['name', 'phone', 'email', 'group', 'table', 'plus_one', 'plus_one_name', 'rsvp_status', 'invitation_sent', 'checked_in', 'dietary_requirements', 'special_requirements', 'notes']
    const rows = guests.map(guest => [
      guest.name,
      guest.phone,
      guest.email,
      guest.group,
      guest.table,
      guest.plusOne ? 'Yes' : 'No',
      guest.plusOneName,
      guest.rsvpStatus,
      guest.invitationSent ? 'Yes' : 'No',
      guest.checkedIn ? 'Yes' : 'No',
      guest.dietaryRequirements,
      guest.specialRequirements,
      guest.notes,
    ])
    const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${eventTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'event'}-guest-list.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function importCsv(file: File) {
    setImporting(true)
    setMessage(null)
    setError(null)
    try {
      const content = await file.text()
      const rows = parseCsv(content)
      if (rows.length < 2) throw new Error('No guest rows found')
      const headers = rows[0].map(normalizeHeader)
      const headerIndex = new Map(headers.map((header, index) => [header, index]))
      const value = (row: string[], ...names: string[]) => {
        for (const name of names) {
          const index = headerIndex.get(name)
          if (index !== undefined) return row[index] ?? ''
        }
        return ''
      }

      const parsed = rows.slice(1).map(row => {
        const name = value(row, 'name', 'guest_name', 'full_name').trim()
        if (!name) return null
        const plusOneName = value(row, 'plus_one_name', 'plusone_name').trim()
        return {
          name,
          nameLower: name.toLowerCase(),
          phone: value(row, 'phone', 'telephone', 'mobile').trim(),
          email: value(row, 'email').trim().toLowerCase(),
          group: value(row, 'group', 'household', 'category').trim(),
          table: value(row, 'table', 'table_seat', 'seat').trim(),
          plusOne: bool(value(row, 'plus_one', 'plusone')) || Boolean(plusOneName),
          plusOneName,
          rsvpStatus: normalizeRsvp(value(row, 'rsvp_status', 'rsvp')),
          invitationSent: bool(value(row, 'invitation_sent', 'invite_sent')),
          checkedIn: bool(value(row, 'checked_in', 'check_in', 'attendance')),
          dietaryRequirements: value(row, 'dietary_requirements', 'dietary', 'diet').trim(),
          specialRequirements: value(row, 'special_requirements', 'special_needs', 'requirements').trim(),
          notes: value(row, 'notes', 'note').trim(),
        }
      }).filter((row): row is NonNullable<typeof row> => Boolean(row))

      if (!parsed.length) throw new Error('No valid guest rows found')

      for (let start = 0; start < parsed.length; start += 400) {
        const batch = writeBatch(db)
        parsed.slice(start, start + 400).forEach(row => {
          const guestRef = doc(guestsRef)
          batch.set(guestRef, { ...row, checkedInAt: row.checkedIn ? serverTimestamp() : null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        })
        await batch.commit()
      }

      setMessage(`${parsed.length} guest${parsed.length === 1 ? '' : 's'} imported.`)
      await loadGuests()
    } catch (importError) {
      console.error('[event-guests] Unable to import CSV', importError)
      setError('The CSV could not be imported. Use a header row with at least a name column.')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function printGuestList() {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800')
    if (!printWindow) {
      setError('Allow pop-ups to print the guest list.')
      return
    }
    const rows = guests.map(guest => `
      <tr>
        <td>${escapeHtml(guest.name)}${guest.plusOne ? `<div class="muted">+ ${escapeHtml(guest.plusOneName || 'Plus-one')}</div>` : ''}</td>
        <td>${escapeHtml(guest.phone)}</td>
        <td>${escapeHtml(guest.group)}</td>
        <td>${escapeHtml(guest.table)}</td>
        <td>${escapeHtml(RSVP_LABELS[guest.rsvpStatus])}</td>
        <td>${guest.checkedIn ? 'Yes' : 'No'}</td>
        <td>${escapeHtml(guest.dietaryRequirements)}</td>
      </tr>`).join('')
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(eventTitle)} guest list</title><style>
      body{font-family:Arial,sans-serif;color:#111827;margin:28px}h1{margin:0 0 6px}p{margin:0 0 18px;color:#4b5563}.summary{display:flex;gap:24px;margin:18px 0}.summary strong{display:block;font-size:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top}th{background:#f3f4f6}.muted{color:#6b7280;font-size:11px;margin-top:3px}@media print{body{margin:10mm}}
    </style></head><body><h1>${escapeHtml(eventTitle)}</h1><p>Guest list · ${new Date().toLocaleDateString('en-GB')}</p><div class="summary"><div><strong>${guests.length}</strong>records</div><div><strong>${stats.seats}</strong>planned seats</div><div><strong>${stats.confirmedSeats}</strong>confirmed seats</div><div><strong>${stats.checkedIn}</strong>checked in</div></div><table><thead><tr><th>Guest</th><th>Phone</th><th>Group</th><th>Table</th><th>RSVP</th><th>Checked in</th><th>Dietary</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`)
    printWindow.document.close()
  }

  return (
    <section className="workspace-card event-guests">
      <header className="event-guests__heading">
        <div>
          <p className="event-guests__eyebrow">Guest management</p>
          <h2>Guest list, RSVP & check-in</h2>
          <p>Manage invitations, households, tables, attendance and event-day check-in from one list.</p>
        </div>
        <div className="event-guests__heading-actions">
          <input ref={fileInputRef} className="event-guests__file-input" type="file" accept=".csv,text/csv,application/vnd.ms-excel" onChange={event => { const file = event.target.files?.[0]; if (file) void importCsv(file) }} />
          <button type="button" className="button button--ghost" onClick={() => fileInputRef.current?.click()} disabled={importing}>{importing ? 'Importing…' : 'Import CSV / Excel CSV'}</button>
          <button type="button" className="button button--ghost" onClick={exportCsv} disabled={!guests.length}>Export CSV</button>
          <button type="button" className="button button--ghost" onClick={printGuestList} disabled={!guests.length}>Print list</button>
          <button type="button" className="button button--primary" onClick={openAddGuest}>＋ Add guest</button>
        </div>
      </header>

      <div className="event-guests__stats">
        <div><span>Guest records</span><strong>{guests.length}</strong><small>{expectedGuestCount ? `of ${expectedGuestCount.toLocaleString()} expected` : 'No event target set'}</small></div>
        <div><span>Planned seats</span><strong>{stats.seats}</strong><small>Includes plus-ones</small></div>
        <div><span>Confirmed</span><strong>{stats.confirmedSeats}</strong><small>{stats.confirmed} primary guests</small></div>
        <div><span>Pending RSVP</span><strong>{stats.pending}</strong><small>{stats.declined} declined</small></div>
        <div><span>Checked in</span><strong>{stats.checkedIn}</strong><small>{stats.confirmed ? `${Math.round((stats.checkedIn / Math.max(stats.confirmed, 1)) * 100)}% of confirmed guests` : 'No confirmed guests yet'}</small></div>
      </div>

      {message ? <p className="event-guests__message">{message}</p> : null}
      {error ? <p className="event-guests__message event-guests__message--error">{error}</p> : null}

      <div className="event-guests__toolbar">
        <input aria-label="Search guests" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, phone, email, group or table" />
        <select aria-label="Filter by RSVP" value={rsvpFilter} onChange={event => setRsvpFilter(event.target.value as RsvpFilter)}>
          <option value="all">All RSVP statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="declined">Declined</option>
        </select>
        <select aria-label="Filter by attendance" value={attendanceFilter} onChange={event => setAttendanceFilter(event.target.value as AttendanceFilter)}>
          <option value="all">All attendance</option>
          <option value="checked_in">Checked in</option>
          <option value="not_checked_in">Not checked in</option>
        </select>
        <span>{visibleGuests.length} shown</span>
      </div>

      {loading ? (
        <div className="event-guests__loading"><span className="event-guests__spinner" /><p>Loading guest list…</p></div>
      ) : guests.length === 0 ? (
        <div className="event-guests__empty"><strong>No guests added yet</strong><p>Add guests manually or import an Excel-compatible CSV file.</p><button type="button" className="button button--primary" onClick={openAddGuest}>Add first guest</button></div>
      ) : visibleGuests.length === 0 ? (
        <div className="event-guests__empty"><strong>No guests match these filters</strong><p>Change the search or filters to see other guests.</p></div>
      ) : (
        <div className="event-guests__table-wrap">
          <table className="event-guests__table">
            <thead><tr><th>Guest</th><th>Contact</th><th>Group / table</th><th>RSVP</th><th>Invite</th><th>Check-in</th><th>Requirements</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {visibleGuests.map(guest => {
                const busy = busyGuestId === guest.id
                return (
                  <tr key={guest.id} className={guest.checkedIn ? 'is-checked-in' : ''}>
                    <td><strong>{guest.name}</strong>{guest.plusOne ? <small>＋ {guest.plusOneName || 'Plus-one'}</small> : null}</td>
                    <td><span>{guest.phone || 'No phone'}</span><small>{guest.email || 'No email'}</small></td>
                    <td><span>{guest.group || 'No group'}</span><small>{guest.table || 'No table assigned'}</small></td>
                    <td><select value={guest.rsvpStatus} disabled={busy} onChange={event => void quickUpdate(guest, { rsvpStatus: event.target.value }, `RSVP updated for ${guest.name}.`)}>{Object.entries(RSVP_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td>
                    <td><button type="button" className={`event-guests__status-button ${guest.invitationSent ? 'is-on' : ''}`} disabled={busy} onClick={() => void quickUpdate(guest, { invitationSent: !guest.invitationSent }, guest.invitationSent ? 'Invitation marked not sent.' : 'Invitation marked sent.')}>{guest.invitationSent ? 'Sent' : 'Not sent'}</button></td>
                    <td><button type="button" className={`event-guests__checkin-button ${guest.checkedIn ? 'is-on' : ''}`} disabled={busy || guest.rsvpStatus === 'declined'} onClick={() => void quickUpdate(guest, { checkedIn: !guest.checkedIn, checkedInAt: !guest.checkedIn ? serverTimestamp() : null }, guest.checkedIn ? `${guest.name} checked out.` : `${guest.name} checked in.`)}>{guest.checkedIn ? 'Checked in' : 'Check in'}</button></td>
                    <td><span>{guest.dietaryRequirements || '—'}</span>{guest.specialRequirements ? <small>{guest.specialRequirements}</small> : null}</td>
                    <td><div className="event-guests__row-actions"><button type="button" onClick={() => openEditGuest(guest)} disabled={busy}>Edit</button><button type="button" className="is-danger" onClick={() => void removeGuest(guest)} disabled={busy}>Remove</button></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? <GuestModal guest={editingGuest} onClose={() => { setModalOpen(false); setEditingGuest(null) }} onSave={saveGuest} /> : null}
    </section>
  )
}
