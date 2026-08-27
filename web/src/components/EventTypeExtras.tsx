import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

type Donation = {
  id: string
  donorName: string
  amount: number
  method: string
  reference: string
  receivedBy: string
  notes: string
}

type WeddingPartyMember = {
  id: string
  name: string
  role: string
  phone: string
  notes: string
}

type SeatingAssignment = {
  id: string
  guestName: string
  tableName: string
  seatNumber: string
  group: string
  notes: string
}

type CorporateSpeaker = {
  id: string
  name: string
  title: string
  company: string
  topic: string
  contact: string
  notes: string
}

type CorporateSponsor = {
  id: string
  name: string
  tier: string
  contact: string
  deliverables: string
  amount: number | null
  notes: string
}

type CorporateAgendaItem = {
  id: string
  time: string
  title: string
  speaker: string
  format: string
  notes: string
}

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function money(value: number) {
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

function printTable(title: string, subtitle: string, headings: string[], rows: string[][]) {
  const popup = window.open('', '_blank', 'width=1000,height=760')
  if (!popup) return false
  const headerHtml = headings.map(heading => `<th>${escapeHtml(heading)}</th>`).join('')
  const bodyHtml = rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#14231a}h1{margin-bottom:4px}p{color:#53665a}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #d8dfda;padding:9px;text-align:left;vertical-align:top}th{background:#f3f6f4}@media print{button{display:none}}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
  popup.document.close()
  return true
}

export default function EventTypeExtras({ storeId, eventId, eventTitle }: Props) {
  const [eventType, setEventType] = useState('')
  const [donations, setDonations] = useState<Donation[]>([])
  const [party, setParty] = useState<WeddingPartyMember[]>([])
  const [seating, setSeating] = useState<SeatingAssignment[]>([])
  const [speakers, setSpeakers] = useState<CorporateSpeaker[]>([])
  const [sponsors, setSponsors] = useState<CorporateSponsor[]>([])
  const [agenda, setAgenda] = useState<CorporateAgendaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [donationForm, setDonationForm] = useState({ donorName: '', amount: '', method: 'Cash', reference: '', receivedBy: '', notes: '' })
  const [partyForm, setPartyForm] = useState({ name: '', role: '', phone: '', notes: '' })
  const [seatingForm, setSeatingForm] = useState({ guestName: '', tableName: '', seatNumber: '', group: '', notes: '' })
  const [speakerForm, setSpeakerForm] = useState({ name: '', title: '', company: '', topic: '', contact: '', notes: '' })
  const [sponsorForm, setSponsorForm] = useState({ name: '', tier: '', contact: '', deliverables: '', amount: '', notes: '' })
  const [agendaForm, setAgendaForm] = useState({ time: '', title: '', speaker: '', format: '', notes: '' })

  const eventRef = useMemo(() => doc(db, 'stores', storeId, 'events', eventId), [storeId, eventId])
  const donationsRef = useMemo(() => collection(eventRef, 'donations'), [eventRef])
  const partyRef = useMemo(() => collection(eventRef, 'weddingParty'), [eventRef])
  const seatingRef = useMemo(() => collection(eventRef, 'seatingAssignments'), [eventRef])
  const speakersRef = useMemo(() => collection(eventRef, 'corporateSpeakers'), [eventRef])
  const sponsorsRef = useMemo(() => collection(eventRef, 'corporateSponsors'), [eventRef])
  const agendaRef = useMemo(() => collection(eventRef, 'corporateAgenda'), [eventRef])

  const isDonationEvent = ['Funeral', 'Charity / community'].includes(eventType)
  const isWeddingEvent = ['Traditional wedding', 'White wedding', 'Engagement'].includes(eventType)
  const isCorporateEvent = eventType === 'Corporate event'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const eventSnapshot = await getDoc(eventRef)
      if (!eventSnapshot.exists()) throw new Error('EVENT_NOT_FOUND')
      const type = text(eventSnapshot.data().eventType) || 'Other'
      setEventType(type)

      if (['Funeral', 'Charity / community'].includes(type)) {
        const snapshot = await getDocs(donationsRef)
        setDonations(snapshot.docs.map(item => {
          const data = item.data()
          return {
            id: item.id,
            donorName: text(data.donorName) || 'Anonymous',
            amount: Math.max(0, numberValue(data.amount)),
            method: text(data.method) || 'Cash',
            reference: text(data.reference),
            receivedBy: text(data.receivedBy),
            notes: text(data.notes),
          }
        }))
      }

      if (['Traditional wedding', 'White wedding', 'Engagement'].includes(type)) {
        const [partySnapshot, seatingSnapshot] = await Promise.all([getDocs(partyRef), getDocs(seatingRef)])
        setParty(partySnapshot.docs.map(item => {
          const data = item.data()
          return { id: item.id, name: text(data.name), role: text(data.role), phone: text(data.phone), notes: text(data.notes) }
        }).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)))
        setSeating(seatingSnapshot.docs.map(item => {
          const data = item.data()
          return { id: item.id, guestName: text(data.guestName), tableName: text(data.tableName), seatNumber: text(data.seatNumber), group: text(data.group), notes: text(data.notes) }
        }).sort((a, b) => a.tableName.localeCompare(b.tableName) || a.guestName.localeCompare(b.guestName)))
      }

      if (type === 'Corporate event') {
        const [speakerSnapshot, sponsorSnapshot, agendaSnapshot] = await Promise.all([getDocs(speakersRef), getDocs(sponsorsRef), getDocs(agendaRef)])
        setSpeakers(speakerSnapshot.docs.map(item => {
          const data = item.data()
          return { id: item.id, name: text(data.name), title: text(data.title), company: text(data.company), topic: text(data.topic), contact: text(data.contact), notes: text(data.notes) }
        }).sort((a, b) => a.name.localeCompare(b.name)))
        setSponsors(sponsorSnapshot.docs.map(item => {
          const data = item.data()
          return { id: item.id, name: text(data.name), tier: text(data.tier), contact: text(data.contact), deliverables: text(data.deliverables), amount: typeof data.amount === 'number' ? data.amount : null, notes: text(data.notes) }
        }).sort((a, b) => a.name.localeCompare(b.name)))
        setAgenda(agendaSnapshot.docs.map(item => {
          const data = item.data()
          return { id: item.id, time: text(data.time), title: text(data.title), speaker: text(data.speaker), format: text(data.format), notes: text(data.notes) }
        }).sort((a, b) => a.time.localeCompare(b.time)))
      }
    } catch (loadError) {
      console.error('[event-extras] Unable to load event extras', loadError)
      setError('The event-specific workspace could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [agendaRef, donationsRef, eventRef, partyRef, seatingRef, speakersRef, sponsorsRef])

  useEffect(() => { void load() }, [load])

  async function saveDonation(event: React.FormEvent) {
    event.preventDefault()
    const amount = Number(donationForm.amount)
    if (!donationForm.donorName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('Enter the donor name and a valid donation amount.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addDoc(donationsRef, {
        donorName: donationForm.donorName.trim(), amount, method: donationForm.method, reference: donationForm.reference.trim(), receivedBy: donationForm.receivedBy.trim(), notes: donationForm.notes.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      setDonationForm({ donorName: '', amount: '', method: 'Cash', reference: '', receivedBy: '', notes: '' })
      setSuccess('Donation recorded.')
      await load()
    } catch (saveError) {
      console.error('[event-extras] Unable to save donation', saveError)
      setError('The donation could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function savePartyMember(event: React.FormEvent) {
    event.preventDefault()
    if (!partyForm.name.trim() || !partyForm.role.trim()) {
      setError('Enter the bridal-party member name and role.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addDoc(partyRef, { ...partyForm, name: partyForm.name.trim(), role: partyForm.role.trim(), phone: partyForm.phone.trim(), notes: partyForm.notes.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      setPartyForm({ name: '', role: '', phone: '', notes: '' })
      setSuccess('Wedding party member added.')
      await load()
    } catch (saveError) {
      console.error('[event-extras] Unable to save wedding party member', saveError)
      setError('The wedding party member could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function saveSeating(event: React.FormEvent) {
    event.preventDefault()
    if (!seatingForm.guestName.trim() || !seatingForm.tableName.trim()) {
      setError('Enter the guest name and table assignment.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addDoc(seatingRef, { ...seatingForm, guestName: seatingForm.guestName.trim(), tableName: seatingForm.tableName.trim(), seatNumber: seatingForm.seatNumber.trim(), group: seatingForm.group.trim(), notes: seatingForm.notes.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      setSeatingForm({ guestName: '', tableName: '', seatNumber: '', group: '', notes: '' })
      setSuccess('Seating assignment added.')
      await load()
    } catch (saveError) {
      console.error('[event-extras] Unable to save seating assignment', saveError)
      setError('The seating assignment could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function saveSpeaker(event: React.FormEvent) {
    event.preventDefault()
    if (!speakerForm.name.trim()) {
      setError('Enter the speaker name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addDoc(speakersRef, { ...speakerForm, name: speakerForm.name.trim(), title: speakerForm.title.trim(), company: speakerForm.company.trim(), topic: speakerForm.topic.trim(), contact: speakerForm.contact.trim(), notes: speakerForm.notes.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      setSpeakerForm({ name: '', title: '', company: '', topic: '', contact: '', notes: '' })
      setSuccess('Speaker added.')
      await load()
    } catch (saveError) {
      console.error('[event-extras] Unable to save speaker', saveError)
      setError('The speaker could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function saveSponsor(event: React.FormEvent) {
    event.preventDefault()
    if (!sponsorForm.name.trim()) {
      setError('Enter the sponsor name.')
      return
    }
    const amount = sponsorForm.amount.trim() ? Number(sponsorForm.amount) : null
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError('Enter a valid sponsor amount.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addDoc(sponsorsRef, { name: sponsorForm.name.trim(), tier: sponsorForm.tier.trim(), contact: sponsorForm.contact.trim(), deliverables: sponsorForm.deliverables.trim(), amount, notes: sponsorForm.notes.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      setSponsorForm({ name: '', tier: '', contact: '', deliverables: '', amount: '', notes: '' })
      setSuccess('Sponsor added.')
      await load()
    } catch (saveError) {
      console.error('[event-extras] Unable to save sponsor', saveError)
      setError('The sponsor could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function saveAgenda(event: React.FormEvent) {
    event.preventDefault()
    if (!agendaForm.title.trim()) {
      setError('Enter the agenda item.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addDoc(agendaRef, { ...agendaForm, title: agendaForm.title.trim(), speaker: agendaForm.speaker.trim(), format: agendaForm.format.trim(), notes: agendaForm.notes.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      setAgendaForm({ time: '', title: '', speaker: '', format: '', notes: '' })
      setSuccess('Agenda item added.')
      await load()
    } catch (saveError) {
      console.error('[event-extras] Unable to save agenda item', saveError)
      setError('The agenda item could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function removeItem(collectionName: 'donations' | 'weddingParty' | 'seatingAssignments' | 'corporateSpeakers' | 'corporateSponsors' | 'corporateAgenda', id: string, label: string) {
    if (!window.confirm(`Delete ${label}?`)) return
    setError(null)
    try {
      await deleteDoc(doc(eventRef, collectionName, id))
      setSuccess(`${label} deleted.`)
      await load()
    } catch (deleteError) {
      console.error('[event-extras] Unable to delete event extra', deleteError)
      setError(`${label} could not be deleted.`)
    }
  }

  if (loading) {
    return <div className="event-planning__loading"><span className="event-planning__spinner" /><p>Loading event-specific workspace…</p></div>
  }

  const donationTotal = donations.reduce((sum, item) => sum + item.amount, 0)
  const sponsorTotal = sponsors.reduce((sum, item) => sum + (item.amount || 0), 0)

  return (
    <div>
      {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
      {success ? <p className="event-planning__alert event-planning__alert--success">{success}<button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">×</button></p> : null}

      <div className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
        <h3>{eventType} extras</h3>
        <p>Sedifex shows only the operational records that matter for this event type.</p>
        <span className="event-planning__status event-planning__status--planning">{eventType || 'Other event'}</span>
      </div>

      {isDonationEvent ? (
        <div>
          <div className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div><h3>Donation register</h3><p>Track donations, payment method, receipt/reference and the staff member who received each contribution.</p></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><strong>{money(donationTotal)}</strong><button type="button" className="button button--ghost" onClick={() => { if (!printTable(`${eventTitle} - Donations`, `${donations.length} contributions · Total ${money(donationTotal)}`, ['Donor', 'Amount', 'Method', 'Reference', 'Received by', 'Notes'], donations.map(item => [item.donorName, money(item.amount), item.method, item.reference, item.receivedBy, item.notes]))) setError('Pop-ups are blocked. Allow pop-ups to print the donation register.') }}>Print donations</button></div>
            </div>
          </div>
          <form onSubmit={saveDonation} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>Add donation</h3>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Donor name<input required value={donationForm.donorName} onChange={e => setDonationForm(previous => ({ ...previous, donorName: e.target.value }))} placeholder="Name or Anonymous" /></label>
              <label>Amount (GHS)<input required type="number" min="0.01" step="0.01" value={donationForm.amount} onChange={e => setDonationForm(previous => ({ ...previous, amount: e.target.value }))} /></label>
              <label>Method<select value={donationForm.method} onChange={e => setDonationForm(previous => ({ ...previous, method: e.target.value }))}><option>Cash</option><option>Mobile Money</option><option>Bank transfer</option><option>Cheque</option><option>Other</option></select></label>
              <label>Reference / receipt<input value={donationForm.reference} onChange={e => setDonationForm(previous => ({ ...previous, reference: e.target.value }))} placeholder="MoMo reference, receipt no." /></label>
              <label>Received by<input value={donationForm.receivedBy} onChange={e => setDonationForm(previous => ({ ...previous, receivedBy: e.target.value }))} placeholder="Staff member" /></label>
              <label>Notes<input value={donationForm.notes} onChange={e => setDonationForm(previous => ({ ...previous, notes: e.target.value }))} /></label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Record donation'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
            {!donations.length ? <div className="event-planning__notes"><strong>No donations recorded</strong><p>Add contributions as they are received.</p></div> : null}
            {donations.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.donorName} · {money(item.amount)}</strong><p style={{ marginTop: 4 }}>{item.method}{item.reference ? ` · ${item.reference}` : ''}{item.receivedBy ? ` · received by ${item.receivedBy}` : ''}{item.notes ? ` · ${item.notes}` : ''}</p></div><button type="button" className="button button--ghost" onClick={() => void removeItem('donations', item.id, 'donation')}>Delete</button></div></div>)}
          </div>
        </div>
      ) : null}

      {isWeddingEvent ? (
        <div>
          <div className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><div><h3>Wedding party & seating</h3><p>Keep bridal-party responsibilities and table assignments together for coordination on the day.</p></div><button type="button" className="button button--ghost" onClick={() => { if (!printTable(`${eventTitle} - Seating plan`, `${seating.length} assigned guests`, ['Guest', 'Table', 'Seat', 'Group', 'Notes'], seating.map(item => [item.guestName, item.tableName, item.seatNumber, item.group, item.notes]))) setError('Pop-ups are blocked. Allow pop-ups to print the seating plan.') }}>Print seating</button></div>
          </div>

          <form onSubmit={savePartyMember} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>Add bridal / wedding party member</h3>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Name<input required value={partyForm.name} onChange={e => setPartyForm(previous => ({ ...previous, name: e.target.value }))} placeholder="Full name" /></label>
              <label>Role<input required value={partyForm.role} onChange={e => setPartyForm(previous => ({ ...previous, role: e.target.value }))} placeholder="Bride, groom, best man, maid of honour…" /></label>
              <label>Phone<input value={partyForm.phone} onChange={e => setPartyForm(previous => ({ ...previous, phone: e.target.value }))} /></label>
              <label>Notes<input value={partyForm.notes} onChange={e => setPartyForm(previous => ({ ...previous, notes: e.target.value }))} placeholder="Arrival, responsibilities, transport" /></label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Add party member'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {party.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.name} · {item.role}</strong><p style={{ marginTop: 4 }}>{[item.phone, item.notes].filter(Boolean).join(' · ') || 'No additional notes'}</p></div><button type="button" className="button button--ghost" onClick={() => void removeItem('weddingParty', item.id, 'party member')}>Delete</button></div></div>)}
          </div>

          <form onSubmit={saveSeating} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>Add seating assignment</h3>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Guest name<input required value={seatingForm.guestName} onChange={e => setSeatingForm(previous => ({ ...previous, guestName: e.target.value }))} /></label>
              <label>Table<input required value={seatingForm.tableName} onChange={e => setSeatingForm(previous => ({ ...previous, tableName: e.target.value }))} placeholder="Table 1 / Family A" /></label>
              <label>Seat no.<input value={seatingForm.seatNumber} onChange={e => setSeatingForm(previous => ({ ...previous, seatNumber: e.target.value }))} /></label>
              <label>Group<input value={seatingForm.group} onChange={e => setSeatingForm(previous => ({ ...previous, group: e.target.value }))} placeholder="Bride family, VIP, colleagues…" /></label>
              <label className="event-planning__field--wide">Notes<input value={seatingForm.notes} onChange={e => setSeatingForm(previous => ({ ...previous, notes: e.target.value }))} placeholder="Dietary, accessibility or protocol notes" /></label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Assign seat'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {seating.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.guestName} · {item.tableName}{item.seatNumber ? ` / Seat ${item.seatNumber}` : ''}</strong><p style={{ marginTop: 4 }}>{[item.group, item.notes].filter(Boolean).join(' · ') || 'No additional notes'}</p></div><button type="button" className="button button--ghost" onClick={() => void removeItem('seatingAssignments', item.id, 'seating assignment')}>Delete</button></div></div>)}
          </div>
        </div>
      ) : null}

      {isCorporateEvent ? (
        <div>
          <div className="event-planning__workspace-preview" style={{ marginTop: 14 }}><h3>Corporate speakers, sponsors & agenda</h3><p>Manage people appearing on stage, sponsor commitments and the working agenda in one place.</p></div>

          <form onSubmit={saveSpeaker} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>Add speaker</h3>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Name<input required value={speakerForm.name} onChange={e => setSpeakerForm(previous => ({ ...previous, name: e.target.value }))} /></label>
              <label>Title / role<input value={speakerForm.title} onChange={e => setSpeakerForm(previous => ({ ...previous, title: e.target.value }))} /></label>
              <label>Company<input value={speakerForm.company} onChange={e => setSpeakerForm(previous => ({ ...previous, company: e.target.value }))} /></label>
              <label>Topic<input value={speakerForm.topic} onChange={e => setSpeakerForm(previous => ({ ...previous, topic: e.target.value }))} /></label>
              <label>Contact<input value={speakerForm.contact} onChange={e => setSpeakerForm(previous => ({ ...previous, contact: e.target.value }))} /></label>
              <label>Notes<input value={speakerForm.notes} onChange={e => setSpeakerForm(previous => ({ ...previous, notes: e.target.value }))} placeholder="AV, arrival, green room, slides" /></label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Add speaker'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{speakers.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.name}{item.title ? ` · ${item.title}` : ''}{item.company ? ` · ${item.company}` : ''}</strong><p style={{ marginTop: 4 }}>{[item.topic, item.contact, item.notes].filter(Boolean).join(' · ') || 'No additional notes'}</p></div><button type="button" className="button button--ghost" onClick={() => void removeItem('corporateSpeakers', item.id, 'speaker')}>Delete</button></div></div>)}</div>

          <form onSubmit={saveSponsor} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><h3>Add sponsor</h3>{sponsorTotal > 0 ? <strong>Committed: {money(sponsorTotal)}</strong> : null}</div>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Sponsor<input required value={sponsorForm.name} onChange={e => setSponsorForm(previous => ({ ...previous, name: e.target.value }))} /></label>
              <label>Tier<input value={sponsorForm.tier} onChange={e => setSponsorForm(previous => ({ ...previous, tier: e.target.value }))} placeholder="Headline, Gold, Silver…" /></label>
              <label>Contact<input value={sponsorForm.contact} onChange={e => setSponsorForm(previous => ({ ...previous, contact: e.target.value }))} /></label>
              <label>Value (GHS)<input type="number" min="0" step="0.01" value={sponsorForm.amount} onChange={e => setSponsorForm(previous => ({ ...previous, amount: e.target.value }))} /></label>
              <label className="event-planning__field--wide">Deliverables<input value={sponsorForm.deliverables} onChange={e => setSponsorForm(previous => ({ ...previous, deliverables: e.target.value }))} placeholder="Logo placement, booth, mentions, tickets…" /></label>
              <label className="event-planning__field--wide">Notes<input value={sponsorForm.notes} onChange={e => setSponsorForm(previous => ({ ...previous, notes: e.target.value }))} /></label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Add sponsor'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{sponsors.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.name}{item.tier ? ` · ${item.tier}` : ''}{item.amount !== null ? ` · ${money(item.amount)}` : ''}</strong><p style={{ marginTop: 4 }}>{[item.contact, item.deliverables, item.notes].filter(Boolean).join(' · ') || 'No additional notes'}</p></div><button type="button" className="button button--ghost" onClick={() => void removeItem('corporateSponsors', item.id, 'sponsor')}>Delete</button></div></div>)}</div>

          <form onSubmit={saveAgenda} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><h3>Add agenda item</h3><button type="button" className="button button--ghost" onClick={() => { if (!printTable(`${eventTitle} - Corporate agenda`, `${agenda.length} agenda items`, ['Time', 'Agenda item', 'Speaker', 'Format', 'Notes'], agenda.map(item => [item.time, item.title, item.speaker, item.format, item.notes]))) setError('Pop-ups are blocked. Allow pop-ups to print the corporate agenda.') }}>Print agenda</button></div>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Time<input type="time" value={agendaForm.time} onChange={e => setAgendaForm(previous => ({ ...previous, time: e.target.value }))} /></label>
              <label>Format<input value={agendaForm.format} onChange={e => setAgendaForm(previous => ({ ...previous, format: e.target.value }))} placeholder="Keynote, panel, break…" /></label>
              <label className="event-planning__field--wide">Agenda item<input required value={agendaForm.title} onChange={e => setAgendaForm(previous => ({ ...previous, title: e.target.value }))} /></label>
              <label>Speaker / owner<input value={agendaForm.speaker} onChange={e => setAgendaForm(previous => ({ ...previous, speaker: e.target.value }))} /></label>
              <label>Notes<input value={agendaForm.notes} onChange={e => setAgendaForm(previous => ({ ...previous, notes: e.target.value }))} /></label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Add agenda item'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{agenda.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{item.time ? `${item.time} · ` : ''}{item.title}</strong><p style={{ marginTop: 4 }}>{[item.speaker, item.format, item.notes].filter(Boolean).join(' · ') || 'No additional notes'}</p></div><button type="button" className="button button--ghost" onClick={() => void removeItem('corporateAgenda', item.id, 'agenda item')}>Delete</button></div></div>)}</div>
        </div>
      ) : null}

      {!isDonationEvent && !isWeddingEvent && !isCorporateEvent ? (
        <div className="event-planning__notes" style={{ marginTop: 14 }}><strong>No special module for this event type</strong><p>Use Checklist, Timeline and Program for {eventType || 'this event'}. Event-specific extras are currently enabled for weddings/engagements, funerals/charity events and corporate events.</p></div>
      ) : null}
    </div>
  )
}
