import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import {
  buildEventPdfDocument,
  downloadEventPdfBytes,
  type EventPdfEntry,
  type EventPdfSection,
} from './eventPdfDocument'
import { getEventProductionTemplate } from './eventProductionTemplates'

export type EventPdfSectionKey =
  | 'summary'
  | 'clientBrief'
  | 'package'
  | 'contract'
  | 'checklist'
  | 'timeline'
  | 'productionTimeline'
  | 'program'
  | 'guestList'
  | 'giftRegister'
  | 'vendors'
  | 'staff'
  | 'finance'
  | 'evaluation'

export const EVENT_PDF_SECTION_OPTIONS: Array<{ key: EventPdfSectionKey; label: string; internal?: boolean }> = [
  { key: 'summary', label: 'Event summary' },
  { key: 'clientBrief', label: 'Client brief' },
  { key: 'package', label: 'Package / scope' },
  { key: 'contract', label: 'Contract & approval' },
  { key: 'checklist', label: 'Planning checklist', internal: true },
  { key: 'timeline', label: 'Day-of timeline', internal: true },
  { key: 'productionTimeline', label: 'Production timeline', internal: true },
  { key: 'program', label: 'Event program' },
  { key: 'guestList', label: 'Guest list', internal: true },
  { key: 'giftRegister', label: 'Guest gift register', internal: true },
  { key: 'vendors', label: 'Vendor coordination', internal: true },
  { key: 'staff', label: 'Staff assignments', internal: true },
  { key: 'finance', label: 'Financial summary', internal: true },
  { key: 'evaluation', label: 'Post-event evaluation', internal: true },
]

type RecordMap = Record<string, unknown>

type LoadedData = {
  eventId: string
  storeId: string
  event: RecordMap
  store: RecordMap
  tasks: Array<{ id: string; data: RecordMap }>
  timeline: Array<{ id: string; data: RecordMap }>
  productionTimeline: Array<{ id: string; data: RecordMap }>
  program: Array<{ id: string; data: RecordMap }>
  guests: Array<{ id: string; data: RecordMap }>
  giftRegister: Array<{ id: string; data: RecordMap }>
  evaluations: Array<{ id: string; data: RecordMap }>
  customers: Array<{ id: string; data: RecordMap }>
  staffMembers: Array<{ id: string; data: RecordMap }>
  invoices: Array<{ id: string; data: RecordMap }>
  receipts: Array<{ id: string; data: RecordMap }>
  expenses: Array<{ id: string; data: RecordMap }>
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: unknown) {
  return value === true
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (value && typeof value === 'object') {
    const timestamp = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate()
      return Number.isNaN(date.getTime()) ? null : date
    }
    const seconds = typeof timestamp.seconds === 'number' ? timestamp.seconds : typeof timestamp._seconds === 'number' ? timestamp._seconds : null
    if (seconds !== null) return new Date(seconds * 1000)
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function formatDate(value: unknown) {
  const raw = text(value)
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T12:00:00`)
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const date = toDate(value)
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : raw || 'Not set'
}

function formatDateTime(value: unknown) {
  const date = toDate(value)
  return date ? date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not recorded'
}

function money(value: unknown) {
  const amount = numberValue(value, NaN)
  if (!Number.isFinite(amount)) return 'Not set'
  return `GHS ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function titleCase(value: unknown) {
  return text(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'event'
}

function entry(textValue: string, style: EventPdfEntry['style'] = 'body'): EventPdfEntry {
  return { text: textValue, style }
}

function labelled(label: string, value: unknown): EventPdfEntry {
  const rendered = typeof value === 'string' ? value : String(value ?? '')
  return entry(`${label}: ${rendered || 'Not set'}`)
}

function customerName(data: RecordMap) {
  return text(data.displayName) || text(data.name) || text(data.email) || text(data.phone) || 'Unnamed contact'
}

function staffName(data: RecordMap) {
  return text(data.displayName) || text(data.name) || text(data.email) || text(data.uid) || 'Staff member'
}

function eventTitle(data: RecordMap) {
  return text(data.title) || text(data.eventType) || 'Event'
}

function eventCode(data: RecordMap, eventId: string) {
  return text(data.eventCode) || `EVT-${eventId.slice(0, 6).toUpperCase()}`
}

async function docsOf(path: ReturnType<typeof collection>) {
  const snapshot = await getDocs(path)
  return snapshot.docs.map(item => ({ id: item.id, data: item.data() as RecordMap }))
}

async function loadData(storeId: string, eventId: string, requested: Set<EventPdfSectionKey>): Promise<LoadedData> {
  const eventRef = doc(db, 'stores', storeId, 'events', eventId)
  const [eventSnapshot, storeSnapshot] = await Promise.all([
    getDoc(eventRef),
    getDoc(doc(db, 'stores', storeId)),
  ])
  if (!eventSnapshot.exists()) throw new Error('EVENT_NOT_FOUND')

  const needsContacts = requested.has('vendors') || requested.has('staff') || requested.has('finance')
  const needsFinance = requested.has('finance')

  const [tasks, timeline, productionTimeline, program, guests, giftRegister, evaluations, customers, staffMembers, invoices, receipts, expenses] = await Promise.all([
    requested.has('checklist') ? docsOf(collection(eventRef, 'tasks')) : Promise.resolve([]),
    requested.has('timeline') ? docsOf(collection(eventRef, 'timeline')) : Promise.resolve([]),
    requested.has('productionTimeline') ? docsOf(collection(eventRef, 'productionTimeline')) : Promise.resolve([]),
    requested.has('program') ? docsOf(collection(eventRef, 'program')) : Promise.resolve([]),
    requested.has('guestList') ? docsOf(collection(eventRef, 'guests')) : Promise.resolve([]),
    requested.has('giftRegister') ? docsOf(collection(eventRef, 'giftRegister')) : Promise.resolve([]),
    requested.has('evaluation') ? docsOf(collection(eventRef, 'postEventEvaluations')) : Promise.resolve([]),
    needsContacts ? getDocs(query(collection(db, 'customers'), where('storeId', '==', storeId))).then(snapshot => snapshot.docs.map(item => ({ id: item.id, data: item.data() as RecordMap }))) : Promise.resolve([]),
    needsContacts ? getDocs(query(collection(db, 'teamMembers'), where('storeId', '==', storeId))).then(snapshot => snapshot.docs.map(item => ({ id: item.id, data: item.data() as RecordMap }))) : Promise.resolve([]),
    needsFinance ? docsOf(collection(db, 'stores', storeId, 'invoices')) : Promise.resolve([]),
    needsFinance ? docsOf(collection(db, 'stores', storeId, 'receipts')) : Promise.resolve([]),
    needsFinance ? getDocs(query(collection(db, 'expenses'), where('storeId', '==', storeId))).then(snapshot => snapshot.docs.map(item => ({ id: item.id, data: item.data() as RecordMap }))) : Promise.resolve([]),
  ])

  return {
    eventId,
    storeId,
    event: eventSnapshot.data() as RecordMap,
    store: (storeSnapshot.data() ?? {}) as RecordMap,
    tasks,
    timeline,
    productionTimeline,
    program,
    guests,
    giftRegister,
    evaluations,
    customers,
    staffMembers,
    invoices,
    receipts,
    expenses,
  }
}

function sectionSummary(data: LoadedData): EventPdfSection {
  const event = data.event
  const packageLabel = titleCase(event.planningPackage) || 'Not set'
  return {
    title: 'Event summary',
    entries: [
      labelled('Event', eventTitle(event)),
      labelled('Reference', eventCode(event, data.eventId)),
      labelled('Event type', text(event.eventType) || 'Other'),
      labelled('Status', titleCase(event.status) || 'New enquiry'),
      labelled('Client', text(event.clientName) || 'Not assigned'),
      labelled('Client phone', text(event.clientPhone) || 'Not provided'),
      labelled('Client email', text(event.clientEmail) || 'Not provided'),
      labelled('Date', formatDate(event.eventDate)),
      labelled('Start time', text(event.startTime) || 'Not set'),
      labelled('Venue', text(event.venue) || 'Not set'),
      labelled('Expected guests', Math.max(0, Math.floor(numberValue(event.guestCount))).toLocaleString()),
      labelled('Planning package', packageLabel),
      labelled('Complexity', titleCase(event.complexity) || 'Standard'),
      labelled('Estimated client budget', money(event.estimatedBudget)),
      labelled('Readiness', `${Math.max(0, Math.min(100, numberValue(event.progress)))}%`),
      ...(text(event.notes) ? [entry('Internal notes', 'subheading'), entry(text(event.notes))] : []),
    ],
  }
}

function sectionClientBrief(data: LoadedData): EventPdfSection {
  const brief = record(data.event.clientBrief)
  const fields: Array<[string, unknown]> = [
    ['Main requirements', brief.requirements],
    ['Theme / colours', brief.themeColours],
    ['Venue requirements', brief.venueRequirements],
    ['Catering', brief.catering],
    ['Decor', brief.decor],
    ['Entertainment', brief.entertainment],
    ['Photography / video', brief.photography],
    ['Transport', brief.transport],
    ['Accommodation', brief.accommodation],
    ['Special instructions', brief.specialInstructions],
  ]
  const entries: EventPdfEntry[] = []
  for (const [label, value] of fields) {
    const rendered = text(value)
    if (!rendered) continue
    entries.push(entry(label, 'subheading'), entry(rendered))
  }
  if (!entries.length) entries.push(entry('No client brief details have been recorded yet.'))
  return { title: 'Client brief', entries }
}

function sectionPackage(data: LoadedData): EventPdfSection {
  const brief = record(data.event.clientBrief)
  const rawItems = Array.isArray(brief.packageItems) ? brief.packageItems : []
  const items = rawItems.map(record).filter(item => text(item.title))
  const additionalTotal = items.reduce((sum, item) => text(item.pricing) === 'additional' ? sum + Math.max(0, numberValue(item.amount)) : sum, 0)
  const entries: EventPdfEntry[] = [
    labelled('Planning package', titleCase(data.event.planningPackage) || 'Not set'),
    labelled('Package items', items.length),
    labelled('Additional-cost total', money(additionalTotal)),
  ]
  items.forEach((item, index) => {
    const pricing = titleCase(item.pricing) || 'Included'
    const amountLabel = typeof item.amount === 'number' && Number.isFinite(item.amount) ? ` | ${money(item.amount)}` : ''
    entries.push(entry(`${index + 1}. ${text(item.title)} - ${text(item.category) || 'Other'} - ${pricing}${amountLabel}`, 'bullet'))
    if (text(item.notes)) entries.push(entry(`Notes: ${text(item.notes)}`, 'muted'))
  })
  if (!items.length) entries.push(entry('No package inclusions have been recorded yet.'))
  return { title: 'Package / scope', entries }
}

function sectionContract(data: LoadedData): EventPdfSection {
  const contract = record(data.event.contractApproval)
  if (!Object.keys(contract).length) return { title: 'Contract & approval', entries: [entry('No contract has been recorded for this event yet.')] }
  const entries: EventPdfEntry[] = [
    labelled('Status', titleCase(contract.status) || 'Draft'),
    labelled('Revision', Math.max(1, Math.floor(numberValue(contract.revision, 1)))),
  ]
  const fields: Array<[string, unknown]> = [
    ['Service agreement', contract.serviceAgreement],
    ['Scope of work', contract.scopeOfWork],
    ['Payment terms', contract.paymentTerms],
    ['Cancellation / refund policy', contract.cancellationPolicy],
    ['Client notes', contract.clientNotes],
  ]
  for (const [label, value] of fields) {
    if (!text(value)) continue
    entries.push(entry(label, 'subheading'), entry(text(value)))
  }
  if (text(contract.signerName) || text(contract.signatureText)) {
    entries.push(entry('Electronic signature record', 'subheading'))
    entries.push(labelled('Signer', text(contract.signerName) || 'Not recorded'))
    entries.push(labelled('Signer email', text(contract.signerEmail) || 'Not recorded'))
    entries.push(labelled('Typed signature', text(contract.signatureText) || 'Not recorded'))
    entries.push(labelled('Signed', formatDateTime(contract.signedAt)))
    entries.push(labelled('Signing method', titleCase(contract.signatureMethod) || 'Internal record'))
  }
  return { title: 'Contract & approval', entries, pageBreakBefore: true }
}

function sectionChecklist(data: LoadedData): EventPdfSection {
  const rows = [...data.tasks].sort((a, b) => numberValue(a.data.sortOrder) - numberValue(b.data.sortOrder) || text(a.data.title).localeCompare(text(b.data.title)))
  const done = rows.filter(row => text(row.data.status) === 'done').length
  const entries: EventPdfEntry[] = [labelled('Tasks', rows.length), labelled('Completed', `${done} (${rows.length ? Math.round(done / rows.length * 100) : 0}%)`)]
  rows.forEach((row, index) => {
    const task = row.data
    const status = titleCase(task.status) || 'To do'
    const priority = titleCase(task.priority) || 'Normal'
    entries.push(entry(`${index + 1}. [${status}] ${text(task.title) || 'Untitled task'} | ${priority} priority`, 'bullet'))
    const meta = [text(task.category) ? `Category: ${text(task.category)}` : '', text(task.owner) ? `Owner: ${text(task.owner)}` : '', text(task.dueDate) ? `Due: ${formatDate(task.dueDate)}` : ''].filter(Boolean).join(' | ')
    if (meta) entries.push(entry(meta, 'muted'))
    if (text(task.notes)) entries.push(entry(`Notes: ${text(task.notes)}`, 'muted'))
  })
  return { title: 'Planning checklist', entries, pageBreakBefore: true }
}

function sectionTimeline(data: LoadedData): EventPdfSection {
  const rows = [...data.timeline].sort((a, b) => numberValue(a.data.sortOrder) - numberValue(b.data.sortOrder) || text(a.data.startTime).localeCompare(text(b.data.startTime)))
  const entries: EventPdfEntry[] = []
  rows.forEach((row, index) => {
    const item = row.data
    const time = [text(item.startTime), text(item.endTime)].filter(Boolean).join(' - ') || 'Time TBC'
    entries.push(entry(`${index + 1}. ${time} | ${text(item.title) || 'Timeline item'}`, 'bullet'))
    const meta = [text(item.owner) ? `Owner: ${text(item.owner)}` : '', text(item.vendor) ? `Vendor: ${text(item.vendor)}` : '', text(item.location) ? `Location: ${text(item.location)}` : ''].filter(Boolean).join(' | ')
    if (meta) entries.push(entry(meta, 'muted'))
    if (text(item.notes)) entries.push(entry(`Notes: ${text(item.notes)}`, 'muted'))
  })
  if (!rows.length) entries.push(entry('No day-of timeline records yet.'))
  return { title: 'Day-of timeline', entries, pageBreakBefore: true }
}

function sectionProductionTimeline(data: LoadedData): EventPdfSection {
  const setup = record(data.event.productionSetup)
  const template = getEventProductionTemplate(text(data.event.eventType) || text(setup.templateEventType) || 'Other')
  const entries: EventPdfEntry[] = []

  template.fields.forEach(field => {
    const rawValue = setup[field.key]
    let rendered = typeof rawValue === 'number' && Number.isFinite(rawValue) ? String(rawValue) : text(rawValue)
    if (!rendered) return
    if (field.type === 'select') rendered = field.options?.find(option => option.value === rendered)?.label || rendered
    entries.push(labelled(field.label, rendered))
  })

  const rows = [...data.productionTimeline].sort((a, b) => numberValue(a.data.sortOrder) - numberValue(b.data.sortOrder) || text(a.data.time).localeCompare(text(b.data.time)) || text(a.data.phase).localeCompare(text(b.data.phase)))
  if (rows.length) entries.push(entry('Production run sheet', 'subheading'))
  rows.forEach((row, index) => {
    const item = row.data
    const phase = text(item.phase) ? `Phase ${text(item.phase)}` : 'Phase not set'
    const progress = titleCase(item.progressStatus) || 'Planned'
    entries.push(entry(`${index + 1}. ${text(item.time) || 'Time TBC'} | ${phase} | ${text(item.activity) || 'Production activity'}`, 'bullet'))
    const meta = [text(item.coordinator) ? `Coordinator: ${text(item.coordinator)}` : '', text(item.contactNumber) ? `Contact: ${text(item.contactNumber)}` : '', `Progress: ${progress}`].filter(Boolean).join(' | ')
    entries.push(entry(meta, 'muted'))
    if (text(item.remarks)) entries.push(entry(`Remarks: ${text(item.remarks)}`, 'muted'))
  })
  if (!entries.length) entries.push(entry('No production setup or production timeline records yet.'))
  return { title: `${template.eventType} production timeline`, entries, pageBreakBefore: true }
}

function sectionProgram(data: LoadedData): EventPdfSection {
  const approval = record(data.event.programApproval)
  const rows = [...data.program].sort((a, b) => numberValue(a.data.sortOrder) - numberValue(b.data.sortOrder) || text(a.data.time).localeCompare(text(b.data.time)))
  const entries: EventPdfEntry[] = [
    labelled('Approval status', titleCase(approval.status) || 'Draft'),
    ...(text(approval.approvedBy) ? [labelled('Approved by', approval.approvedBy), labelled('Approved at', formatDateTime(approval.approvedAt))] : []),
  ]
  rows.forEach((row, index) => {
    const item = row.data
    entries.push(entry(`${index + 1}. ${text(item.time) || 'Time TBC'} | ${text(item.title) || 'Program item'}`, 'bullet'))
    if (text(item.participant)) entries.push(entry(`Participant: ${text(item.participant)}`, 'muted'))
    if (text(item.notes)) entries.push(entry(`Notes: ${text(item.notes)}`, 'muted'))
  })
  return { title: 'Event program', entries, pageBreakBefore: true }
}

function sectionGuestList(data: LoadedData): EventPdfSection {
  const rows = [...data.guests].sort((a, b) => text(a.data.name).localeCompare(text(b.data.name)))
  const seats = rows.reduce((sum, row) => sum + 1 + (bool(row.data.plusOne) ? 1 : 0), 0)
  const confirmedSeats = rows.reduce((sum, row) => sum + (text(row.data.rsvpStatus) === 'confirmed' ? 1 + (bool(row.data.plusOne) ? 1 : 0) : 0), 0)
  const checkedIn = rows.filter(row => bool(row.data.checkedIn)).length
  const entries: EventPdfEntry[] = [
    labelled('Guest records', rows.length),
    labelled('Planned seats', seats),
    labelled('Confirmed seats', confirmedSeats),
    labelled('Checked in', checkedIn),
  ]
  rows.forEach((row, index) => {
    const guest = row.data
    const plusOne = bool(guest.plusOne) ? ` + ${text(guest.plusOneName) || 'Plus-one'}` : ''
    entries.push(entry(`${index + 1}. ${text(guest.name) || 'Unnamed guest'}${plusOne} | RSVP: ${titleCase(guest.rsvpStatus) || 'Pending'} | Table: ${text(guest.table) || 'Unassigned'} | Checked in: ${bool(guest.checkedIn) ? 'Yes' : 'No'}`, 'bullet'))
    const meta = [text(guest.phone) ? `Phone: ${text(guest.phone)}` : '', text(guest.email) ? `Email: ${text(guest.email)}` : '', text(guest.group) ? `Group: ${text(guest.group)}` : ''].filter(Boolean).join(' | ')
    if (meta) entries.push(entry(meta, 'muted'))
    if (text(guest.dietaryRequirements)) entries.push(entry(`Dietary: ${text(guest.dietaryRequirements)}`, 'muted'))
    if (text(guest.specialRequirements)) entries.push(entry(`Special requirements: ${text(guest.specialRequirements)}`, 'muted'))
  })
  return { title: 'Guest list', entries, pageBreakBefore: true }
}

function sectionGiftRegister(data: LoadedData): EventPdfSection {
  const rows = [...data.giftRegister].sort((a, b) => numberValue(a.data.sortOrder) - numberValue(b.data.sortOrder) || text(a.data.guestName).localeCompare(text(b.data.guestName)))
  const totalAmount = rows.reduce((sum, row) => sum + Math.max(0, numberValue(row.data.amount)), 0)
  const totalGuests = rows.reduce((sum, row) => sum + Math.max(0, numberValue(row.data.guestCount)), 0)
  const entries: EventPdfEntry[] = [
    labelled('Gift records', rows.length),
    labelled('Guests recorded', totalGuests),
    labelled('Recorded amount', money(totalAmount)),
  ]
  rows.forEach((row, index) => {
    const gift = row.data
    entries.push(entry(`${index + 1}. ${text(gift.guestName) || 'Unnamed guest'} | Parcel: ${text(gift.parcelNumber) || '—'} | Recipient: ${text(gift.recipient) || '—'} | Amount: ${typeof gift.amount === 'number' ? money(gift.amount) : '—'}`, 'bullet'))
    const meta = [text(gift.phone) ? `Phone: ${text(gift.phone)}` : '', numberValue(gift.guestCount) > 0 ? `Guests: ${numberValue(gift.guestCount)}` : '', text(gift.giftDescription) ? `Gift: ${text(gift.giftDescription)}` : '', text(gift.receivedTime) ? `Time: ${text(gift.receivedTime)}` : ''].filter(Boolean).join(' | ')
    if (meta) entries.push(entry(meta, 'muted'))
    if (text(gift.notes)) entries.push(entry(`Notes: ${text(gift.notes)}`, 'muted'))
  })
  return { title: 'Guest gift register', entries, pageBreakBefore: true }
}

function sectionVendors(data: LoadedData): EventPdfSection {
  const integrations = record(data.event.integrations)
  const raw = Array.isArray(integrations.vendors) ? integrations.vendors : []
  const customers = new Map(data.customers.map(item => [item.id, item.data]))
  const entries: EventPdfEntry[] = []
  raw.map(record).filter(vendor => text(vendor.customerId)).forEach((vendor, index) => {
    const contact = customers.get(text(vendor.customerId))
    const quoted = Math.max(0, numberValue(vendor.quotedAmount))
    const paid = Math.max(0, numberValue(vendor.depositPaid))
    entries.push(entry(`${index + 1}. ${contact ? customerName(contact) : 'Vendor'} | ${text(vendor.category) || 'Vendor'} | ${titleCase(vendor.status) || 'Planned'}`, 'bullet'))
    entries.push(entry(`Quote: ${money(quoted)} | Paid: ${money(paid)} | Balance: ${money(Math.max(quoted - paid, 0))}`, 'muted'))
    if (contact) {
      const contactLine = [text(contact.phone), text(contact.email)].filter(Boolean).join(' | ')
      if (contactLine) entries.push(entry(contactLine, 'muted'))
    }
    if (text(vendor.notes)) entries.push(entry(`Notes: ${text(vendor.notes)}`, 'muted'))
  })
  return { title: 'Vendor coordination', entries, pageBreakBefore: true }
}

function sectionStaff(data: LoadedData): EventPdfSection {
  const integrations = record(data.event.integrations)
  const raw = Array.isArray(integrations.staff) ? integrations.staff : []
  const staff = new Map(data.staffMembers.map(item => [item.id, item.data]))
  const entries: EventPdfEntry[] = []
  raw.map(record).filter(assignment => text(assignment.memberId)).forEach((assignment, index) => {
    const member = staff.get(text(assignment.memberId))
    entries.push(entry(`${index + 1}. ${member ? staffName(member) : 'Staff member'} | Role: ${text(assignment.eventRole) || 'Event support'} | Call time: ${text(assignment.callTime) || 'Not set'}`, 'bullet'))
    if (text(assignment.notes)) entries.push(entry(`Notes: ${text(assignment.notes)}`, 'muted'))
  })
  return { title: 'Staff assignments', entries, pageBreakBefore: true }
}

function sectionFinance(data: LoadedData): EventPdfSection {
  const integrations = record(data.event.integrations)
  const finance = record(integrations.finance)
  const contractValue = typeof finance.contractValue === 'number' ? Math.max(0, finance.contractValue) : null
  const linkedInvoices = data.invoices.filter(item => text(item.data.eventId) === data.eventId)
  const linkedReceipts = data.receipts.filter(item => text(item.data.eventId) === data.eventId)
  const linkedExpenses = data.expenses.filter(item => text(item.data.eventId) === data.eventId)
  const vendors = Array.isArray(integrations.vendors) ? integrations.vendors.map(record).filter(item => text(item.status) !== 'cancelled') : []
  const invoiced = linkedInvoices.reduce((sum, item) => sum + Math.max(0, numberValue(item.data.total)), 0)
  const received = linkedReceipts.reduce((sum, item) => sum + Math.max(0, numberValue(item.data.amountPaid)), 0)
  const expensesTotal = linkedExpenses.reduce((sum, item) => sum + Math.max(0, numberValue(item.data.amount)), 0)
  const vendorOutstanding = vendors.reduce((sum, vendor) => sum + Math.max(0, numberValue(vendor.quotedAmount) - numberValue(vendor.depositPaid)), 0)
  const balance = contractValue === null ? null : Math.max(contractValue - received, 0)
  const expectedProfit = contractValue === null ? null : contractValue - expensesTotal - vendorOutstanding
  const entries: EventPdfEntry[] = [
    labelled('Estimated client budget', money(data.event.estimatedBudget)),
    labelled('Contract value', money(contractValue)),
    labelled('Invoiced', money(invoiced)),
    labelled('Payments received', money(received)),
    labelled('Outstanding client balance', money(balance)),
    labelled('Recorded expenses', money(expensesTotal)),
    labelled('Vendor outstanding commitments', money(vendorOutstanding)),
    labelled('Expected profit / remaining margin', money(expectedProfit)),
  ]
  if (linkedInvoices.length) {
    entries.push(entry('Invoices', 'subheading'))
    linkedInvoices.forEach(item => entries.push(entry(`${text(item.data.invoiceNumber) || item.id} | ${formatDate(item.data.invoiceDate)} | ${money(item.data.total)} | ${titleCase(item.data.status) || 'Draft'}`, 'bullet')))
  }
  if (linkedReceipts.length) {
    entries.push(entry('Receipts', 'subheading'))
    linkedReceipts.forEach(item => entries.push(entry(`${text(item.data.receiptNumber) || item.id} | ${formatDate(item.data.receiptDate)} | ${money(item.data.amountPaid)} | ${text(item.data.paymentMethod) || 'Payment'}`, 'bullet')))
  }
  if (linkedExpenses.length) {
    entries.push(entry('Expenses', 'subheading'))
    linkedExpenses.forEach(item => entries.push(entry(`${text(item.data.title) || 'Expense'} | ${text(item.data.category) || 'Other'} | ${formatDate(item.data.expenseDate)} | ${money(item.data.amount)}`, 'bullet')))
  }
  return { title: 'Financial summary', entries, pageBreakBefore: true }
}

function sectionEvaluation(data: LoadedData): EventPdfSection {
  const rows = [...data.evaluations].sort((a, b) => (toDate(b.data.createdAt)?.getTime() ?? 0) - (toDate(a.data.createdAt)?.getTime() ?? 0))
  const average = rows.length ? rows.reduce((sum, item) => sum + numberValue(item.data.overallScore), 0) / rows.length : 0
  const entries: EventPdfEntry[] = [labelled('Evaluation responses', rows.length), labelled('Average overall score', rows.length ? `${average.toFixed(1)}/5` : 'Not available')]
  rows.forEach((row, index) => {
    const item = row.data
    entries.push(entry(`${index + 1}. ${text(item.respondentName) || 'Unnamed respondent'} | ${titleCase(item.respondentType) || 'Staff'}${text(item.organisation) ? ` | ${text(item.organisation)}` : ''} | Overall: ${numberValue(item.overallScore).toFixed(1)}/5`, 'bullet'))
    entries.push(entry(`Punctuality ${numberValue(item.punctuality)}/5 | Communication ${numberValue(item.communication)}/5 | Professionalism ${numberValue(item.professionalism)}/5 | Quality ${numberValue(item.quality)}/5 | Issue handling ${numberValue(item.issueHandling)}/5`, 'muted'))
    if (text(item.strengths)) entries.push(entry(`Strengths: ${text(item.strengths)}`, 'muted'))
    if (text(item.improvements)) entries.push(entry(`Improvements: ${text(item.improvements)}`, 'muted'))
    if (text(item.recommendation)) entries.push(entry(`Recommendation: ${text(item.recommendation)}`, 'muted'))
  })
  return { title: 'Post-event evaluation', entries, pageBreakBefore: true }
}

const SECTION_BUILDERS: Record<EventPdfSectionKey, (data: LoadedData) => EventPdfSection> = {
  summary: sectionSummary,
  clientBrief: sectionClientBrief,
  package: sectionPackage,
  contract: sectionContract,
  checklist: sectionChecklist,
  timeline: sectionTimeline,
  productionTimeline: sectionProductionTimeline,
  program: sectionProgram,
  guestList: sectionGuestList,
  giftRegister: sectionGiftRegister,
  vendors: sectionVendors,
  staff: sectionStaff,
  finance: sectionFinance,
  evaluation: sectionEvaluation,
}

export async function downloadEventWorkspacePdf(args: {
  storeId: string
  eventId: string
  sections: EventPdfSectionKey[]
  pack?: boolean
}) {
  const unique = Array.from(new Set(args.sections)).filter(key => EVENT_PDF_SECTION_OPTIONS.some(option => option.key === key))
  if (!unique.length) throw new Error('Choose at least one event section to export.')
  const requested = new Set(unique)
  const data = await loadData(args.storeId, args.eventId, requested)
  const title = eventTitle(data.event)
  const code = eventCode(data.event, data.eventId)
  const storeName = text(data.store.businessName) || text(data.store.displayName) || text(data.store.name) || 'Sedifex Store'
  const subtitleParts = [storeName, text(data.event.clientName) ? `Client: ${text(data.event.clientName)}` : '', text(data.event.eventDate) ? `Event date: ${formatDate(data.event.eventDate)}` : ''].filter(Boolean)
  const sections = unique.map(key => SECTION_BUILDERS[key](data))
  const documentTitle = args.pack ? `${title} - Event Pack` : `${title} - ${EVENT_PDF_SECTION_OPTIONS.find(option => option.key === unique[0])?.label || 'Event document'}`
  const bytes = buildEventPdfDocument({
    title: documentTitle,
    subtitle: subtitleParts.join(' | '),
    reference: code,
    generatedLabel: `Generated ${new Date().toLocaleString('en-GB')} | Sedifex Event Planning`,
    sections,
  })
  const suffix = args.pack ? 'event-pack' : slug(EVENT_PDF_SECTION_OPTIONS.find(option => option.key === unique[0])?.label || 'event-document')
  const fileName = `${slug(title)}-${suffix}.pdf`
  downloadEventPdfBytes(bytes, fileName)
  return { fileName, title, reference: code }
}
