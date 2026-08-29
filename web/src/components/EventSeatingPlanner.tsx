import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import './EventSeatingPlanner.css'

type RsvpStatus = 'pending' | 'confirmed' | 'declined'

type GuestRecord = {
  id: string
  name: string
  group: string
  table: string
  plusOne: boolean
  plusOneName: string
  rsvpStatus: RsvpStatus
}

type SeatingTable = {
  id: string
  name: string
  capacity: number
  notes: string
  sortOrder: number
}

type TableForm = {
  name: string
  capacity: string
  notes: string
}

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
  expectedGuestCount?: number
}

const RSVP_LABELS: Record<RsvpStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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
    group: text(data.group),
    table: text(data.table),
    plusOne: Boolean(data.plusOne),
    plusOneName: text(data.plusOneName),
    rsvpStatus: normalizeRsvp(data.rsvpStatus),
  }
}

function mapTable(id: string, data: Record<string, unknown>, index: number): SeatingTable {
  return {
    id,
    name: text(data.name) || `Table ${index + 1}`,
    capacity: Math.max(1, Math.floor(numberValue(data.capacity, 10))),
    notes: text(data.notes),
    sortOrder: numberValue(data.sortOrder, index + 1),
  }
}

function normalizeTableName(value: string) {
  return value.trim().toLowerCase()
}

function guestSeats(guest: GuestRecord) {
  return 1 + (guest.plusOne ? 1 : 0)
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function TableModal({ table, onClose, onSave }: {
  table: SeatingTable | null
  onClose: () => void
  onSave: (form: TableForm) => Promise<void>
}) {
  const [form, setForm] = useState<TableForm>(() => ({
    name: table?.name ?? '',
    capacity: String(table?.capacity ?? 10),
    notes: table?.notes ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const capacity = Number(form.capacity)
    if (!form.name.trim()) {
      setError('Enter a table name.')
      return
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
      setError('Enter a capacity between 1 and 100 seats.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch (saveError) {
      console.error('[event-seating] Unable to save table', saveError)
      setError(saveError instanceof Error ? saveError.message : 'The table could not be saved.')
      setSaving(false)
    }
  }

  return (
    <div className="event-seating__modal-backdrop" onMouseDown={onClose}>
      <section className="event-seating__modal" role="dialog" aria-modal="true" aria-labelledby="event-seating-table-title" onMouseDown={event => event.stopPropagation()}>
        <header className="event-seating__modal-heading">
          <div>
            <p className="event-seating__eyebrow">{table ? 'Update table' : 'New table'}</p>
            <h2 id="event-seating-table-title">{table ? table.name : 'Create seating table'}</h2>
          </div>
          <button type="button" className="event-seating__icon-button" onClick={onClose} aria-label="Close table form">×</button>
        </header>

        {error ? <p className="event-seating__message event-seating__message--error">{error}</p> : null}

        <form onSubmit={submit}>
          <div className="event-seating__form-grid">
            <label>Table name<input required value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} placeholder="Table 1, VIP, Family A" /></label>
            <label>Capacity<input required type="number" min="1" max="100" value={form.capacity} onChange={event => setForm(previous => ({ ...previous, capacity: event.target.value }))} /></label>
            <label className="event-seating__field--wide">Notes<textarea rows={3} value={form.notes} onChange={event => setForm(previous => ({ ...previous, notes: event.target.value }))} placeholder="Near stage, wheelchair access, family table…" /></label>
          </div>
          <footer className="event-seating__modal-actions">
            <button type="button" className="button button--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : table ? 'Save table' : 'Create table'}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

export default function EventSeatingPlanner({ storeId, eventId, eventTitle, expectedGuestCount = 0 }: Props) {
  const [tables, setTables] = useState<SeatingTable[]>([])
  const [guests, setGuests] = useState<GuestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editingTable, setEditingTable] = useState<SeatingTable | null>(null)
  const [tableModalOpen, setTableModalOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [quickCapacity, setQuickCapacity] = useState(10)
  const [search, setSearch] = useState('')

  const tablesRef = useMemo(() => collection(db, 'stores', storeId, 'events', eventId, 'seatingTables'), [eventId, storeId])
  const guestsRef = useMemo(() => collection(db, 'stores', storeId, 'events', eventId, 'guests'), [eventId, storeId])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tableSnapshot, guestSnapshot] = await Promise.all([getDocs(tablesRef), getDocs(guestsRef)])
      const nextTables = tableSnapshot.docs
        .map((snapshotDoc, index) => mapTable(snapshotDoc.id, snapshotDoc.data(), index))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }))
      const nextGuests = guestSnapshot.docs
        .map(snapshotDoc => mapGuest(snapshotDoc.id, snapshotDoc.data()))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      setTables(nextTables)
      setGuests(nextGuests)
    } catch (loadError) {
      console.error('[event-seating] Unable to load seating plan', loadError)
      setError('The seating plan could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [guestsRef, tablesRef])

  useEffect(() => { void loadData() }, [loadData])

  const guestMapByTable = useMemo(() => {
    const map = new Map<string, GuestRecord[]>()
    guests.forEach(guest => {
      if (!guest.table) return
      const key = normalizeTableName(guest.table)
      map.set(key, [...(map.get(key) ?? []), guest])
    })
    return map
  }, [guests])

  const knownTableNames = useMemo(
    () => new Set(tables.map(table => normalizeTableName(table.name))),
    [tables],
  )

  const tableUsage = useMemo(() => {
    const map = new Map<string, number>()
    tables.forEach(table => {
      const assigned = guestMapByTable.get(normalizeTableName(table.name)) ?? []
      const seats = assigned.reduce((total, guest) => total + (guest.rsvpStatus === 'declined' ? 0 : guestSeats(guest)), 0)
      map.set(table.id, seats)
    })
    return map
  }, [guestMapByTable, tables])

  const stats = useMemo(() => {
    const confirmedGuests = guests.filter(guest => guest.rsvpStatus === 'confirmed')
    const confirmedSeats = confirmedGuests.reduce((total, guest) => total + guestSeats(guest), 0)
    const assignedConfirmedSeats = confirmedGuests.reduce((total, guest) => {
      const assignedToKnownTable = guest.table && knownTableNames.has(normalizeTableName(guest.table))
      return total + (assignedToKnownTable ? guestSeats(guest) : 0)
    }, 0)
    const pendingSeats = guests.filter(guest => guest.rsvpStatus === 'pending').reduce((total, guest) => total + guestSeats(guest), 0)
    const totalCapacity = tables.reduce((total, table) => total + table.capacity, 0)
    const occupiedSeats = tables.reduce((total, table) => total + (tableUsage.get(table.id) ?? 0), 0)
    return { confirmedSeats, assignedConfirmedSeats, pendingSeats, totalCapacity, occupiedSeats }
  }, [guests, knownTableNames, tableUsage, tables])

  const unassignedGuests = useMemo(() => {
    const queryText = search.trim().toLowerCase()
    return guests
      .filter(guest => {
        if (guest.rsvpStatus === 'declined') return false
        return !guest.table || !knownTableNames.has(normalizeTableName(guest.table))
      })
      .filter(guest => !queryText || [guest.name, guest.group, guest.plusOneName, guest.table].some(value => value.toLowerCase().includes(queryText)))
      .sort((left, right) => {
        if (left.rsvpStatus !== right.rsvpStatus) return left.rsvpStatus === 'confirmed' ? -1 : 1
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      })
  }, [guests, knownTableNames, search])

  async function commitGuestTableUpdates(updates: Array<{ id: string; table: string }>) {
    for (let start = 0; start < updates.length; start += 400) {
      const batch = writeBatch(db)
      updates.slice(start, start + 400).forEach(update => {
        batch.update(doc(guestsRef, update.id), { table: update.table, updatedAt: serverTimestamp() })
      })
      await batch.commit()
    }
  }

  function openAddTable() {
    setEditingTable(null)
    setTableModalOpen(true)
  }

  function openEditTable(table: SeatingTable) {
    setEditingTable(table)
    setTableModalOpen(true)
  }

  async function saveTable(form: TableForm) {
    const name = form.name.trim()
    const capacity = Number(form.capacity)
    const duplicate = tables.some(table => table.id !== editingTable?.id && normalizeTableName(table.name) === normalizeTableName(name))
    if (duplicate) throw new Error('A table with this name already exists.')

    if (editingTable) {
      const currentUsage = tableUsage.get(editingTable.id) ?? 0
      if (capacity < currentUsage) throw new Error(`This table currently uses ${currentUsage} seats. Move guests before lowering the capacity.`)

      const oldName = editingTable.name
      await updateDoc(doc(tablesRef, editingTable.id), {
        name,
        capacity,
        notes: form.notes.trim(),
        updatedAt: serverTimestamp(),
      })

      if (normalizeTableName(oldName) !== normalizeTableName(name)) {
        const affectedGuests = guests.filter(guest => normalizeTableName(guest.table) === normalizeTableName(oldName))
        await commitGuestTableUpdates(affectedGuests.map(guest => ({ id: guest.id, table: name })))
      }
      setMessage('Table updated.')
    } else {
      await addDoc(tablesRef, {
        name,
        capacity,
        notes: form.notes.trim(),
        sortOrder: tables.length + 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setMessage('Table created.')
    }

    setTableModalOpen(false)
    setEditingTable(null)
    await loadData()
  }

  async function removeTable(table: SeatingTable) {
    const affectedGuests = guests.filter(guest => normalizeTableName(guest.table) === normalizeTableName(table.name))
    const confirmed = window.confirm(`Delete “${table.name}”? ${affectedGuests.length ? `${affectedGuests.length} assigned guest record${affectedGuests.length === 1 ? '' : 's'} will become unassigned.` : 'This cannot be undone.'}`)
    if (!confirmed) return

    setBusy(true)
    setError(null)
    try {
      if (affectedGuests.length) await commitGuestTableUpdates(affectedGuests.map(guest => ({ id: guest.id, table: '' })))
      await deleteDoc(doc(tablesRef, table.id))
      setMessage(`${table.name} deleted.`)
      await loadData()
    } catch (deleteError) {
      console.error('[event-seating] Unable to delete table', deleteError)
      setError('The table could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  async function assignGuest(guest: GuestRecord, tableName: string) {
    setError(null)
    setMessage(null)

    if (tableName) {
      const table = tables.find(item => normalizeTableName(item.name) === normalizeTableName(tableName))
      if (!table) {
        setError('That seating table no longer exists.')
        return
      }
      const otherAssigned = (guestMapByTable.get(normalizeTableName(table.name)) ?? []).filter(item => item.id !== guest.id)
      const used = otherAssigned.reduce((total, item) => total + (item.rsvpStatus === 'declined' ? 0 : guestSeats(item)), 0)
      const required = guest.rsvpStatus === 'declined' ? 0 : guestSeats(guest)
      if (used + required > table.capacity) {
        setError(`${table.name} does not have enough space for ${guest.name}${guest.plusOne ? ' and their plus-one' : ''}.`)
        return
      }
    }

    try {
      await updateDoc(doc(guestsRef, guest.id), { table: tableName, updatedAt: serverTimestamp() })
      setGuests(previous => previous.map(item => item.id === guest.id ? { ...item, table: tableName } : item))
      setMessage(tableName ? `${guest.name} assigned to ${tableName}.` : `${guest.name} is now unassigned.`)
    } catch (assignError) {
      console.error('[event-seating] Unable to assign guest', assignError)
      setError('The guest assignment could not be saved.')
    }
  }

  async function autoSeatConfirmedGuests() {
    if (!tables.length) {
      setError('Create seating tables before using auto-seat.')
      return
    }

    const unassignedConfirmed = guests.filter(guest => {
      if (guest.rsvpStatus !== 'confirmed') return false
      return !guest.table || !knownTableNames.has(normalizeTableName(guest.table))
    })
    if (!unassignedConfirmed.length) {
      setMessage('All confirmed guests are already assigned.')
      return
    }

    const tableState = tables.map(table => ({
      table,
      remaining: table.capacity - (tableUsage.get(table.id) ?? 0),
    }))

    const grouped = new Map<string, GuestRecord[]>()
    unassignedConfirmed.forEach(guest => {
      const groupKey = guest.group.trim().toLowerCase() || `guest:${guest.id}`
      grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), guest])
    })

    const groups = [...grouped.values()].sort((left, right) => {
      const leftSeats = left.reduce((total, guest) => total + guestSeats(guest), 0)
      const rightSeats = right.reduce((total, guest) => total + guestSeats(guest), 0)
      return rightSeats - leftSeats
    })

    const updates: Array<{ id: string; table: string }> = []
    const assignedIds = new Set<string>()

    groups.forEach(group => {
      const groupSeats = group.reduce((total, guest) => total + guestSeats(guest), 0)
      const groupTable = [...tableState]
        .filter(state => state.remaining >= groupSeats)
        .sort((left, right) => (left.remaining - groupSeats) - (right.remaining - groupSeats))[0]

      if (groupTable) {
        group.forEach(guest => {
          updates.push({ id: guest.id, table: groupTable.table.name })
          assignedIds.add(guest.id)
        })
        groupTable.remaining -= groupSeats
        return
      }

      group.forEach(guest => {
        const seats = guestSeats(guest)
        const bestTable = [...tableState]
          .filter(state => state.remaining >= seats)
          .sort((left, right) => (left.remaining - seats) - (right.remaining - seats))[0]
        if (!bestTable) return
        updates.push({ id: guest.id, table: bestTable.table.name })
        assignedIds.add(guest.id)
        bestTable.remaining -= seats
      })
    })

    if (!updates.length) {
      setError('There is not enough available table capacity for the unassigned confirmed guests.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await commitGuestTableUpdates(updates)
      setGuests(previous => previous.map(guest => {
        const update = updates.find(item => item.id === guest.id)
        return update ? { ...guest, table: update.table } : guest
      }))
      const remaining = unassignedConfirmed.length - assignedIds.size
      setMessage(`${assignedIds.size} confirmed guest${assignedIds.size === 1 ? '' : 's'} auto-seated${remaining ? `; ${remaining} still need space` : ''}.`)
    } catch (autoSeatError) {
      console.error('[event-seating] Unable to auto-seat guests', autoSeatError)
      setError('Auto-seat could not finish saving the assignments.')
    } finally {
      setBusy(false)
    }
  }

  async function generateTables() {
    const targetSeats = Math.max(expectedGuestCount, stats.confirmedSeats, guests.filter(guest => guest.rsvpStatus !== 'declined').reduce((total, guest) => total + guestSeats(guest), 0))
    if (!targetSeats) {
      setError('Add guests or set an expected guest count before generating tables.')
      return
    }

    const missingSeats = Math.max(0, targetSeats - stats.totalCapacity)
    if (!missingSeats) {
      setMessage(`Current seating capacity already covers the ${targetSeats.toLocaleString()}-seat target.`)
      return
    }

    const neededTables = Math.max(1, Math.ceil(missingSeats / quickCapacity))
    const existingNames = new Set(tables.map(table => normalizeTableName(table.name)))
    const rows: Array<{ name: string; sortOrder: number }> = []
    let candidateNumber = 1
    while (rows.length < neededTables) {
      const name = `Table ${candidateNumber}`
      candidateNumber += 1
      if (existingNames.has(normalizeTableName(name))) continue
      rows.push({ name, sortOrder: tables.length + rows.length + 1 })
    }

    setBusy(true)
    setError(null)
    try {
      for (let start = 0; start < rows.length; start += 400) {
        const batch = writeBatch(db)
        rows.slice(start, start + 400).forEach(row => {
          batch.set(doc(tablesRef), {
            name: row.name,
            capacity: quickCapacity,
            notes: '',
            sortOrder: row.sortOrder,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        })
        await batch.commit()
      }
      setMessage(`${rows.length} additional table${rows.length === 1 ? '' : 's'} generated at ${quickCapacity} seats each.`)
      await loadData()
    } catch (generateError) {
      console.error('[event-seating] Unable to generate tables', generateError)
      setError('The seating tables could not be generated.')
    } finally {
      setBusy(false)
    }
  }

  function printSeatingPlan() {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800')
    if (!printWindow) {
      setError('Allow pop-ups to print the seating plan.')
      return
    }

    const tableCards = tables.map(table => {
      const assigned = (guestMapByTable.get(normalizeTableName(table.name)) ?? []).filter(guest => guest.rsvpStatus !== 'declined')
      const guestRows = assigned.length
        ? assigned.map(guest => `<li><strong>${escapeHtml(guest.name)}</strong>${guest.plusOne ? ` <span>+ ${escapeHtml(guest.plusOneName || 'Plus-one')}</span>` : ''}${guest.group ? `<small>${escapeHtml(guest.group)}</small>` : ''}</li>`).join('')
        : '<li class="empty">No guests assigned</li>'
      const used = tableUsage.get(table.id) ?? 0
      return `<section><header><h2>${escapeHtml(table.name)}</h2><b>${used}/${table.capacity} seats</b></header>${table.notes ? `<p>${escapeHtml(table.notes)}</p>` : ''}<ol>${guestRows}</ol></section>`
    }).join('')

    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(eventTitle)} seating plan</title><style>
      body{font-family:Arial,sans-serif;color:#111827;margin:28px}h1{margin:0 0 6px}p{color:#4b5563}.summary{display:flex;gap:24px;margin:18px 0 24px}.summary strong{display:block;font-size:20px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}section{border:1px solid #d1d5db;border-radius:10px;padding:14px;break-inside:avoid}section header{display:flex;justify-content:space-between;gap:12px;align-items:center}h2{font-size:16px;margin:0}section p{font-size:12px;margin:6px 0}ol{margin:12px 0 0;padding-left:22px}li{padding:4px 0;font-size:12px}li span,li small{color:#6b7280}li small{display:block}.empty{color:#9ca3af}@media print{body{margin:10mm}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    </style></head><body><h1>${escapeHtml(eventTitle)}</h1><p>Seating plan · ${new Date().toLocaleDateString('en-GB')}</p><div class="summary"><div><strong>${tables.length}</strong>tables</div><div><strong>${stats.totalCapacity}</strong>capacity</div><div><strong>${stats.confirmedSeats}</strong>confirmed seats</div><div><strong>${stats.assignedConfirmedSeats}</strong>confirmed assigned</div></div><div class="grid">${tableCards}</div><script>window.onload=()=>window.print()<\/script></body></html>`)
    printWindow.document.close()
  }

  if (loading) {
    return <section className="workspace-card event-seating"><div className="event-seating__loading"><span className="event-seating__spinner" /><p>Loading seating plan…</p></div></section>
  }

  return (
    <section className="workspace-card event-seating">
      <header className="event-seating__heading">
        <div>
          <p className="event-seating__eyebrow">RSVP-connected seating</p>
          <h2>Seating planner</h2>
          <p>Create tables, assign guests and plus-ones, keep households together and spot capacity problems before event day.</p>
        </div>
        <div className="event-seating__heading-actions">
          <button type="button" className="button button--ghost" onClick={printSeatingPlan} disabled={!tables.length}>Print seating plan</button>
          <button type="button" className="button button--ghost" onClick={() => void autoSeatConfirmedGuests()} disabled={busy || !tables.length}>Auto-seat confirmed</button>
          <button type="button" className="button button--primary" onClick={openAddTable}>＋ Add table</button>
        </div>
      </header>

      <div className="event-seating__stats">
        <div><span>Tables</span><strong>{tables.length}</strong><small>{stats.totalCapacity.toLocaleString()} total seats</small></div>
        <div><span>Confirmed seats</span><strong>{stats.confirmedSeats}</strong><small>Includes confirmed plus-ones</small></div>
        <div><span>Confirmed assigned</span><strong>{stats.assignedConfirmedSeats}</strong><small>{stats.confirmedSeats ? `${Math.round((stats.assignedConfirmedSeats / stats.confirmedSeats) * 100)}% seated` : 'No confirmed guests yet'}</small></div>
        <div><span>Capacity in use</span><strong>{stats.occupiedSeats}</strong><small>{stats.totalCapacity ? `${Math.max(0, stats.totalCapacity - stats.occupiedSeats)} seats available` : 'Create tables to start'}</small></div>
        <div><span>Pending RSVP seats</span><strong>{stats.pendingSeats}</strong><small>Potential seats still undecided</small></div>
      </div>

      {message ? <p className="event-seating__message">{message}<button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></p> : null}
      {error ? <p className="event-seating__message event-seating__message--error">{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></p> : null}

      <div className="event-seating__setup">
        <div>
          <strong>Quick table setup</strong>
          <span>Generate only the additional tables needed for the event target and current guest list.</span>
        </div>
        <label>Seats per table<select value={quickCapacity} onChange={event => setQuickCapacity(Number(event.target.value))}><option value={6}>6</option><option value={8}>8</option><option value={10}>10</option><option value={12}>12</option><option value={14}>14</option><option value={16}>16</option></select></label>
        <button type="button" className="button button--ghost" onClick={() => void generateTables()} disabled={busy}>Generate tables</button>
      </div>

      <div className="event-seating__layout">
        <div className="event-seating__tables-area">
          <div className="event-seating__section-heading"><div><h3>Table plan</h3><p>Assignments count confirmed and pending guests; declined guests do not consume table capacity.</p></div><span>{tables.length} table{tables.length === 1 ? '' : 's'}</span></div>

          {tables.length === 0 ? (
            <div className="event-seating__empty"><strong>No seating tables yet</strong><p>Create them manually or use quick setup to generate a first layout.</p><button type="button" className="button button--primary" onClick={openAddTable}>Create first table</button></div>
          ) : (
            <div className="event-seating__table-grid">
              {tables.map(table => {
                const assigned = (guestMapByTable.get(normalizeTableName(table.name)) ?? []).filter(guest => guest.rsvpStatus !== 'declined')
                const used = tableUsage.get(table.id) ?? 0
                const remaining = Math.max(0, table.capacity - used)
                const percent = Math.min(100, Math.round((used / table.capacity) * 100))
                return (
                  <article key={table.id} className={`event-seating__table-card ${used > table.capacity ? 'is-over' : ''}`}>
                    <header>
                      <div><h4>{table.name}</h4><span>{used}/{table.capacity} seats</span></div>
                      <div className="event-seating__table-actions"><button type="button" onClick={() => openEditTable(table)}>Edit</button><button type="button" className="is-danger" disabled={busy} onClick={() => void removeTable(table)}>Delete</button></div>
                    </header>
                    <div className="event-seating__capacity"><i style={{ width: `${percent}%` }} /></div>
                    <small className="event-seating__capacity-note">{used > table.capacity ? `${used - table.capacity} seats over capacity` : `${remaining} seat${remaining === 1 ? '' : 's'} available`}</small>
                    {table.notes ? <p className="event-seating__table-note">{table.notes}</p> : null}
                    <div className="event-seating__assigned-list">
                      {assigned.length === 0 ? <p className="event-seating__no-guests">No guests assigned.</p> : assigned.map(guest => (
                        <div key={guest.id} className="event-seating__assigned-guest">
                          <div><strong>{guest.name}</strong>{guest.plusOne ? <small>＋ {guest.plusOneName || 'Plus-one'}</small> : null}{guest.group ? <small>{guest.group}</small> : null}</div>
                          <div><span className={`event-seating__rsvp event-seating__rsvp--${guest.rsvpStatus}`}>{RSVP_LABELS[guest.rsvpStatus]}</span><button type="button" onClick={() => void assignGuest(guest, '')}>Unassign</button></div>
                        </div>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        <aside className="event-seating__unassigned">
          <div className="event-seating__section-heading"><div><h3>Unassigned guests</h3><p>Confirmed guests appear first, followed by pending RSVPs.</p></div><span>{unassignedGuests.length}</span></div>
          <input aria-label="Search unassigned guests" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search guest, group or previous table" />
          <div className="event-seating__unassigned-list">
            {unassignedGuests.length === 0 ? <div className="event-seating__empty event-seating__empty--compact"><strong>Everyone is assigned</strong><p>No confirmed or pending guest currently needs a table.</p></div> : unassignedGuests.map(guest => {
              const seats = guestSeats(guest)
              const hasLegacyAssignment = Boolean(guest.table) && !knownTableNames.has(normalizeTableName(guest.table))
              return (
                <div className="event-seating__unassigned-guest" key={guest.id}>
                  <div><strong>{guest.name}</strong><span>{guest.group || 'No group'} · {seats} seat{seats === 1 ? '' : 's'}</span>{guest.plusOne ? <small>＋ {guest.plusOneName || 'Plus-one'}</small> : null}{hasLegacyAssignment ? <small>Previous table: {guest.table} · needs reassignment</small> : null}</div>
                  <span className={`event-seating__rsvp event-seating__rsvp--${guest.rsvpStatus}`}>{RSVP_LABELS[guest.rsvpStatus]}</span>
                  <select aria-label={`Assign ${guest.name} to table`} value="" onChange={event => { if (event.target.value) void assignGuest(guest, event.target.value) }}>
                    <option value="">Assign table…</option>
                    {tables.map(table => {
                      const remaining = table.capacity - (tableUsage.get(table.id) ?? 0)
                      return <option value={table.name} key={table.id} disabled={remaining < seats}>{table.name} · {Math.max(0, remaining)} free</option>
                    })}
                  </select>
                </div>
              )
            })}
          </div>
        </aside>
      </div>

      {tableModalOpen ? <TableModal table={editingTable} onClose={() => { setTableModalOpen(false); setEditingTable(null) }} onSave={saveTable} /> : null}
    </section>
  )
}
