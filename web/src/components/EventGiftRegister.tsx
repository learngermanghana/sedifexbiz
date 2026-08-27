import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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

type GiftRecord = {
  id: string
  guestName: string
  parcelNumber: string
  phone: string
  guestCount: number | null
  recipient: string
  amount: number | null
  giftDescription: string
  receivedTime: string
  notes: string
  sortOrder: number
}

type GiftDraft = {
  guestName: string
  parcelNumber: string
  phone: string
  guestCount: string
  recipient: string
  amount: string
  giftDescription: string
  receivedTime: string
  notes: string
}

const EMPTY_DRAFT: GiftDraft = {
  guestName: '',
  parcelNumber: '',
  phone: '',
  guestCount: '',
  recipient: '',
  amount: '',
  giftDescription: '',
  receivedTime: '',
  notes: '',
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mapGift(id: string, data: Record<string, unknown>): GiftRecord {
  return {
    id,
    guestName: text(data.guestName),
    parcelNumber: text(data.parcelNumber),
    phone: text(data.phone),
    guestCount: numberOrNull(data.guestCount),
    recipient: text(data.recipient),
    amount: numberOrNull(data.amount),
    giftDescription: text(data.giftDescription),
    receivedTime: text(data.receivedTime),
    notes: text(data.notes),
    sortOrder: numberOrNull(data.sortOrder) ?? 0,
  }
}

function money(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(value)
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export default function EventGiftRegister({ storeId, eventId, eventTitle }: Props) {
  const eventRef = useMemo(() => doc(db, 'stores', storeId, 'events', eventId), [storeId, eventId])
  const giftsRef = useMemo(() => collection(eventRef, 'giftRegister'), [eventRef])
  const [gifts, setGifts] = useState<GiftRecord[]>([])
  const [draft, setDraft] = useState<GiftDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const totalAmount = useMemo(() => gifts.reduce((sum, gift) => sum + (gift.amount ?? 0), 0), [gifts])
  const totalGuestCount = useMemo(() => gifts.reduce((sum, gift) => sum + (gift.guestCount ?? 0), 0), [gifts])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const snapshot = await getDocs(giftsRef)
      setGifts(snapshot.docs
        .map(item => mapGift(item.id, item.data()))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.guestName.localeCompare(b.guestName)))
    } catch (loadError) {
      console.error('[event-gifts] Unable to load gift register', loadError)
      setError('The guest gift register could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [giftsRef])

  useEffect(() => { void load() }, [load])

  function reset() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
  }

  async function saveGift(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.guestName.trim()) {
      setError('Enter the guest name.')
      return
    }
    const guestCount = draft.guestCount.trim() ? Number(draft.guestCount) : null
    const amount = draft.amount.trim() ? Number(draft.amount) : null
    if (guestCount !== null && (!Number.isFinite(guestCount) || guestCount < 0)) {
      setError('Enter a valid number of guests.')
      return
    }
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError('Enter a valid amount.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')
    const payload = {
      guestName: draft.guestName.trim(),
      parcelNumber: draft.parcelNumber.trim(),
      phone: draft.phone.trim(),
      guestCount,
      recipient: draft.recipient.trim(),
      amount,
      giftDescription: draft.giftDescription.trim(),
      receivedTime: draft.receivedTime,
      notes: draft.notes.trim(),
      sortOrder: editingId ? gifts.find(item => item.id === editingId)?.sortOrder ?? gifts.length + 1 : gifts.length + 1,
      updatedAt: serverTimestamp(),
    }
    try {
      if (editingId) {
        await updateDoc(doc(giftsRef, editingId), payload)
        setMessage('Gift record updated.')
      } else {
        await addDoc(giftsRef, { ...payload, createdAt: serverTimestamp() })
        setMessage('Gift record added.')
      }
      reset()
      await load()
    } catch (saveError) {
      console.error('[event-gifts] Unable to save gift record', saveError)
      setError('The gift record could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function editGift(gift: GiftRecord) {
    setEditingId(gift.id)
    setDraft({
      guestName: gift.guestName,
      parcelNumber: gift.parcelNumber,
      phone: gift.phone,
      guestCount: gift.guestCount === null ? '' : String(gift.guestCount),
      recipient: gift.recipient,
      amount: gift.amount === null ? '' : String(gift.amount),
      giftDescription: gift.giftDescription,
      receivedTime: gift.receivedTime,
      notes: gift.notes,
    })
  }

  async function removeGift(gift: GiftRecord) {
    if (!window.confirm(`Delete the gift record for “${gift.guestName}”?`)) return
    setError('')
    try {
      await deleteDoc(doc(giftsRef, gift.id))
      setMessage('Gift record deleted.')
      if (editingId === gift.id) reset()
      await load()
    } catch (deleteError) {
      console.error('[event-gifts] Unable to delete gift record', deleteError)
      setError('The gift record could not be deleted.')
    }
  }

  function printGiftRegister() {
    const popup = window.open('', '_blank', 'width=1200,height=800')
    if (!popup) {
      setError('Pop-ups are blocked. Allow pop-ups to print the guest gift list.')
      return
    }
    const rows = gifts.map(gift => `<tr><td>${escapeHtml(gift.guestName)}</td><td>${escapeHtml(gift.parcelNumber || '—')}</td><td>${escapeHtml(gift.phone || '—')}</td><td>${gift.guestCount ?? '—'}</td><td>${escapeHtml(gift.recipient || '—')}</td><td>${escapeHtml(gift.amount === null ? '—' : money(gift.amount))}</td><td>${escapeHtml(gift.giftDescription || '—')}</td><td>${escapeHtml(gift.receivedTime || '—')}</td><td>${escapeHtml(gift.notes || '—')}</td></tr>`).join('')
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(eventTitle)} - Guest Gift List</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#17211d}h1{margin:0}.sub{color:#64748b;margin:5px 0 20px}.summary{display:flex;gap:20px;margin-bottom:18px}.summary div{border:1px solid #d8dfda;border-radius:10px;padding:8px 12px}.summary strong{display:block}table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #cbd5cf;padding:6px;text-align:left;vertical-align:top}th{background:#f1f5f2}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(eventTitle)}</h1><p class="sub">Guest Gift List · Private and confidential</p><div class="summary"><div><strong>${gifts.length}</strong> gift records</div><div><strong>${totalGuestCount}</strong> guests recorded</div><div><strong>${escapeHtml(money(totalAmount))}</strong> recorded amount</div></div><table><thead><tr><th>Name</th><th>Parcel no.</th><th>Phone</th><th>No. of guests</th><th>Recipient</th><th>Amount</th><th>Gift / parcel</th><th>Received time</th><th>Notes</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No gift records yet.</td></tr>'}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }

  if (loading) return <div className="event-planning__loading"><span className="event-planning__spinner" /><p>Loading guest gift register…</p></div>

  return (
    <div>
      {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
      {message ? <p className="event-planning__alert event-planning__alert--success">{message}<button type="button" onClick={() => setMessage('')} aria-label="Dismiss">×</button></p> : null}

      <section className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div><h3>Guest gift register</h3><p>Track every parcel, recipient and amount without mixing gift records into the general guest list.</p></div>
          <button type="button" className="button button--ghost" onClick={printGiftRegister}>Print guest gift list</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <div className="event-planning__notes" style={{ marginTop: 0, minWidth: 150 }}><strong>{gifts.length}</strong><p>Gift records</p></div>
          <div className="event-planning__notes" style={{ marginTop: 0, minWidth: 150 }}><strong>{totalGuestCount}</strong><p>Guests recorded</p></div>
          <div className="event-planning__notes" style={{ marginTop: 0, minWidth: 180 }}><strong>{money(totalAmount)}</strong><p>Recorded amount</p></div>
        </div>
      </section>

      <form onSubmit={saveGift} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
        <h3>{editingId ? 'Edit gift record' : 'Add guest gift'}</h3>
        <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
          <label>Guest name<input required value={draft.guestName} onChange={e => setDraft(previous => ({ ...previous, guestName: e.target.value }))} /></label>
          <label>Parcel number<input value={draft.parcelNumber} onChange={e => setDraft(previous => ({ ...previous, parcelNumber: e.target.value }))} /></label>
          <label>Phone number of guest<input inputMode="tel" value={draft.phone} onChange={e => setDraft(previous => ({ ...previous, phone: e.target.value }))} /></label>
          <label>Number of guests<input type="number" min="0" value={draft.guestCount} onChange={e => setDraft(previous => ({ ...previous, guestCount: e.target.value }))} /></label>
          <label>Recipient / received by<input value={draft.recipient} onChange={e => setDraft(previous => ({ ...previous, recipient: e.target.value }))} placeholder="Person receiving the parcel" /></label>
          <label>Amount where applicable (GHS)<input type="number" min="0" step="0.01" value={draft.amount} onChange={e => setDraft(previous => ({ ...previous, amount: e.target.value }))} /></label>
          <label>Gift / parcel description<input value={draft.giftDescription} onChange={e => setDraft(previous => ({ ...previous, giftDescription: e.target.value }))} placeholder="Cash, boxed gift, envelope…" /></label>
          <label>Received time<input type="time" value={draft.receivedTime} onChange={e => setDraft(previous => ({ ...previous, receivedTime: e.target.value }))} /></label>
          <label className="event-planning__field--wide">Notes<textarea rows={2} value={draft.notes} onChange={e => setDraft(previous => ({ ...previous, notes: e.target.value }))} placeholder="Hand-over details or special instructions" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>{editingId ? <button type="button" className="button button--ghost" onClick={reset}>Cancel</button> : null}<button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save gift record' : 'Add gift record'}</button></div>
      </form>

      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table className="event-planning__table" style={{ minWidth: 1050 }}>
          <thead><tr><th>Name</th><th>Parcel</th><th>Phone</th><th>Guests</th><th>Recipient</th><th>Amount</th><th>Gift / parcel</th><th>Time</th><th>Actions</th></tr></thead>
          <tbody>
            {!gifts.length ? <tr><td colSpan={9}>No guest gift records yet.</td></tr> : gifts.map(gift => (
              <tr key={gift.id}>
                <td><strong>{gift.guestName}</strong>{gift.notes ? <span style={{ display: 'block', fontSize: '.75rem', color: '#64748b', marginTop: 3 }}>{gift.notes}</span> : null}</td>
                <td>{gift.parcelNumber || '—'}</td>
                <td>{gift.phone || '—'}</td>
                <td>{gift.guestCount ?? '—'}</td>
                <td>{gift.recipient || '—'}</td>
                <td>{money(gift.amount)}</td>
                <td>{gift.giftDescription || '—'}</td>
                <td>{gift.receivedTime || '—'}</td>
                <td><div style={{ display: 'flex', gap: 6 }}><button type="button" className="button button--ghost" onClick={() => editGift(gift)}>Edit</button><button type="button" className="button button--ghost" onClick={() => void removeGift(gift)}>Delete</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
