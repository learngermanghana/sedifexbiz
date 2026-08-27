import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import {
  buildEventPdfDocument,
  downloadEventPdfBytes,
  type EventPdfEntry,
  type EventPdfSection,
} from './eventPdfDocument'

type RecordMap = Record<string, unknown>

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

function titleCase(value: unknown) {
  return text(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function formatDate(value: unknown) {
  const raw = text(value)
  if (!raw) return 'Not set'
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T12:00:00`)
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  return raw
}

function formatDateTime(value: unknown) {
  if (!value) return 'Not recorded'
  if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    const date = (value as { toDate: () => Date }).toDate()
    return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function money(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? `GHS ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Not set'
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'event'
}

function entry(value: string, style: EventPdfEntry['style'] = 'body'): EventPdfEntry {
  return { text: value, style }
}

function labelled(label: string, value: unknown): EventPdfEntry {
  return entry(`${label}: ${String(value ?? '').trim() || 'Not set'}`)
}

function taskClientLabel(task: RecordMap) {
  const status = text(task.status) || 'todo'
  const clientState = text(task.clientState) || 'open'
  if (status === 'done' || clientState === 'verified') return 'Done'
  if (clientState === 'submitted') return 'Submitted by client - Awaiting verification'
  if (clientState === 'changes_requested') return 'Changes requested'
  if (status === 'in_progress') return 'In progress'
  return 'To do'
}

export async function downloadEventClientPackPdf(args: { storeId: string; eventId: string }) {
  const eventRef = doc(db, 'stores', args.storeId, 'events', args.eventId)
  const [eventSnapshot, storeSnapshot, taskSnapshot, programSnapshot] = await Promise.all([
    getDoc(eventRef),
    getDoc(doc(db, 'stores', args.storeId)),
    getDocs(collection(eventRef, 'tasks')),
    getDocs(collection(eventRef, 'program')),
  ])

  if (!eventSnapshot.exists()) throw new Error('Event not found.')

  const event = eventSnapshot.data() as RecordMap
  const store = (storeSnapshot.data() ?? {}) as RecordMap
  const title = text(event.title) || text(event.eventType) || 'Event'
  const code = text(event.eventCode) || `EVT-${args.eventId.slice(0, 6).toUpperCase()}`
  const storeName = text(store.businessName) || text(store.displayName) || text(store.name) || 'Sedifex Store'
  const sections: EventPdfSection[] = []

  sections.push({
    title: 'Event summary',
    entries: [
      labelled('Event', title),
      labelled('Reference', code),
      labelled('Event type', text(event.eventType) || 'Other'),
      labelled('Status', titleCase(event.status) || 'New enquiry'),
      labelled('Client', text(event.clientName) || 'Not assigned'),
      labelled('Client phone', text(event.clientPhone) || 'Not provided'),
      labelled('Client email', text(event.clientEmail) || 'Not provided'),
      labelled('Date', formatDate(event.eventDate)),
      labelled('Start time', text(event.startTime) || 'Not set'),
      labelled('Venue', text(event.venue) || 'Not set'),
      labelled('Expected guests', Math.max(0, Math.floor(numberValue(event.guestCount))).toLocaleString()),
      labelled('Planning package', titleCase(event.planningPackage) || 'Not set'),
      labelled('Estimated client budget', money(event.estimatedBudget)),
      labelled('Readiness', `${Math.max(0, Math.min(100, numberValue(event.progress)))}%`),
    ],
  })

  const brief = record(event.clientBrief)
  const briefFields: Array<[string, unknown]> = [
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
  const briefEntries: EventPdfEntry[] = []
  briefFields.forEach(([label, value]) => {
    if (!text(value)) return
    briefEntries.push(entry(label, 'subheading'), entry(text(value)))
  })
  if (briefEntries.length) sections.push({ title: 'Client brief', entries: briefEntries })

  const packageItems = (Array.isArray(brief.packageItems) ? brief.packageItems : []).map(record).filter(item => text(item.title))
  if (text(event.planningPackage) || packageItems.length) {
    const packageEntries: EventPdfEntry[] = [labelled('Planning package', titleCase(event.planningPackage) || 'Not set')]
    packageItems.forEach((item, index) => {
      const amount = Number(item.amount)
      packageEntries.push(entry(`${index + 1}. ${text(item.title)} - ${text(item.category) || 'Other'} - ${titleCase(item.pricing) || 'Included'}${Number.isFinite(amount) ? ` | ${money(amount)}` : ''}`, 'bullet'))
      if (text(item.notes)) packageEntries.push(entry(`Notes: ${text(item.notes)}`, 'muted'))
    })
    sections.push({ title: 'Package / scope', entries: packageEntries })
  }

  const contract = record(event.contractApproval)
  if (Object.keys(contract).length) {
    const contractEntries: EventPdfEntry[] = [
      labelled('Status', titleCase(contract.status) || 'Draft'),
      labelled('Revision', Math.max(1, Math.floor(numberValue(contract.revision, 1)))),
    ]
    ;([
      ['Service agreement', contract.serviceAgreement],
      ['Scope of work', contract.scopeOfWork],
      ['Payment terms', contract.paymentTerms],
      ['Cancellation / refund policy', contract.cancellationPolicy],
      ['Client notes', contract.clientNotes],
    ] as Array<[string, unknown]>).forEach(([label, value]) => {
      if (!text(value)) return
      contractEntries.push(entry(label, 'subheading'), entry(text(value)))
    })
    if (text(contract.signerName) || text(contract.signatureText)) {
      contractEntries.push(entry('Electronic signature record', 'subheading'))
      contractEntries.push(labelled('Signer', text(contract.signerName) || 'Not recorded'))
      contractEntries.push(labelled('Signer email', text(contract.signerEmail) || 'Not recorded'))
      contractEntries.push(labelled('Typed signature', text(contract.signatureText) || 'Not recorded'))
      contractEntries.push(labelled('Signed', formatDateTime(contract.signedAt)))
    }
    sections.push({ title: 'Contract & approval', entries: contractEntries, pageBreakBefore: true })
  }

  const clientTasks = taskSnapshot.docs
    .map(item => ({ id: item.id, data: item.data() as RecordMap }))
    .filter(item => item.data.clientVisible === true)
    .sort((a, b) => numberValue(a.data.sortOrder) - numberValue(b.data.sortOrder) || text(a.data.title).localeCompare(text(b.data.title)))
  if (clientTasks.length) {
    const taskEntries: EventPdfEntry[] = [labelled('Client tasks', clientTasks.length)]
    clientTasks.forEach((item, index) => {
      taskEntries.push(entry(`${index + 1}. [${taskClientLabel(item.data)}] ${text(item.data.title) || 'Event task'}`, 'bullet'))
      const meta = [text(item.data.category) ? `Category: ${text(item.data.category)}` : '', text(item.data.dueDate) ? `Due: ${formatDate(item.data.dueDate)}` : ''].filter(Boolean).join(' | ')
      if (meta) taskEntries.push(entry(meta, 'muted'))
      if (text(item.data.clientStaffNote)) taskEntries.push(entry(`Event team: ${text(item.data.clientStaffNote)}`, 'muted'))
    })
    sections.push({ title: 'Client planning tasks', entries: taskEntries, pageBreakBefore: true })
  }

  const programApproval = record(event.programApproval)
  const programRows = programSnapshot.docs
    .map(item => item.data() as RecordMap)
    .sort((a, b) => numberValue(a.sortOrder) - numberValue(b.sortOrder) || text(a.time).localeCompare(text(b.time)))
  if (text(programApproval.status).toLowerCase() === 'approved' && programRows.length) {
    const programEntries: EventPdfEntry[] = [labelled('Approval status', 'Approved')]
    programRows.forEach((item, index) => {
      const time = text(item.time) || text(item.startTime)
      const titleText = text(item.title) || text(item.activity) || text(item.item) || 'Program item'
      programEntries.push(entry(`${index + 1}. ${time ? `${time} - ` : ''}${titleText}`, 'bullet'))
      if (text(item.notes)) programEntries.push(entry(text(item.notes), 'muted'))
    })
    sections.push({ title: 'Approved event program', entries: programEntries, pageBreakBefore: true })
  }

  const bytes = buildEventPdfDocument({
    title: `${title} - Client Pack`,
    subtitle: [storeName, text(event.clientName) ? `Client: ${text(event.clientName)}` : '', text(event.eventDate) ? `Event date: ${formatDate(event.eventDate)}` : ''].filter(Boolean).join(' | '),
    reference: code,
    generatedLabel: `Generated ${new Date().toLocaleString('en-GB')} | Sedifex Event Planning | Client-shareable`,
    sections,
  })
  const fileName = `${slug(title)}-client-pack.pdf`
  downloadEventPdfBytes(bytes, fileName)
  return { fileName, sectionCount: sections.length }
}
