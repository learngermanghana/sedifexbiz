import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import CustomerPortalShareCard from '../components/CustomerPortalShareCard'
import './CustomerCRM.css'
import './CustomerCRM.mobile.css'

type RecordMap = Record<string, unknown>

type CustomerRecord = {
  id: string
  storeId?: string
  name?: string | null
  displayName?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
  tags?: string[]
  birthdate?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  lastActivityAt?: unknown
  sources?: string[]
  debt?: {
    outstandingCents?: number | null
    dueDate?: unknown
    lastReminderAt?: unknown
  } | null
}

type DataRow = {
  id: string
  data: RecordMap
  source?: string
}

type CrmData = {
  sales: DataRow[]
  bookings: DataRow[]
  invoices: DataRow[]
  receipts: DataRow[]
  events: DataRow[]
  courses: DataRow[]
  messages: DataRow[]
  notes: DataRow[]
  documents: DataRow[]
}

type TabId =
  | 'overview'
  | 'sales'
  | 'bookings'
  | 'invoices'
  | 'events'
  | 'courses'
  | 'payments'
  | 'messages'
  | 'notes'
  | 'documents'

type ActivityItem = {
  id: string
  kind: string
  title: string
  detail: string
  date: Date | null
  href?: string
}

const EMPTY_DATA: CrmData = {
  sales: [],
  bookings: [],
  invoices: [],
  receipts: [],
  events: [],
  courses: [],
  messages: [],
  notes: [],
  documents: [],
}

const CUSTOMER_ACTIVITY_LIMIT = 100

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'events', label: 'Event projects' },
  { id: 'courses', label: 'Courses' },
  { id: 'payments', label: 'Payments' },
  { id: 'messages', label: 'Messages' },
  { id: 'notes', label: 'Notes' },
  { id: 'documents', label: 'Documents' },
]

function asRecord(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordMap) : {}
}

function readPath(data: RecordMap, path: string): unknown {
  let current: unknown = data
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as RecordMap)[part]
  }
  return current
}

function firstText(data: RecordMap, paths: string[]): string | null {
  for (const path of paths) {
    const value = readPath(data, path)
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function firstNumber(data: RecordMap, paths: string[]): number | null {
  for (const path of paths) {
    const value = readPath(data, path)
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/,/g, ''))
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number }
    if (typeof candidate.toDate === 'function') {
      try {
        const parsed = candidate.toDate()
        return Number.isNaN(parsed.getTime()) ? null : parsed
      } catch {
        return null
      }
    }
    if (typeof candidate.seconds === 'number') {
      return new Date(candidate.seconds * 1000 + Math.round((candidate.nanoseconds ?? 0) / 1_000_000))
    }
  }
  return null
}

function recordDate(data: RecordMap, paths = ['updatedAt', 'createdAt']): Date | null {
  for (const path of paths) {
    const value = readPath(data, path)
    const parsed = toDate(value)
    if (parsed) return parsed
  }
  return null
}

function customerName(customer: CustomerRecord): string {
  return customer.displayName?.trim() || customer.name?.trim() || customer.email?.trim() || customer.phone?.trim() || 'Unnamed customer'
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\D/g, '')
}

function normalizeWhatsAppPhone(value: unknown): string {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw) return ''

  let digits = raw.replace(/\D/g, '')
  if (!digits) return ''

  // Convert international access-prefix notation (e.g. 00233...) to E.164 digits.
  if (raw.startsWith('00') && digits.startsWith('00')) {
    digits = digits.slice(2)
  }

  // Sedifex is Ghana-first, so accept the common local forms and convert them
  // to the country-code form required by wa.me links.
  if (digits.length === 10 && digits.startsWith('0')) {
    digits = `233${digits.slice(1)}`
  } else if (digits.length === 9) {
    digits = `233${digits}`
  }

  // WhatsApp expects an E.164-style number containing digits only, with no +.
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : ''
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : ''
}

function customerMatchesRow(customer: CustomerRecord, data: RecordMap): boolean {
  const idCandidates = [
    firstText(data, ['customerId', 'clientCustomerId', 'customer.id', 'customer.customerId', 'integrations.clientCustomerId']),
  ].filter(Boolean)
  if (idCandidates.includes(customer.id)) return true

  const customerEmail = normalizeEmail(customer.email)
  const emailCandidates = [
    firstText(data, ['customerEmail', 'email', 'clientEmail', 'customer.email', 'contact.email', 'student.email']),
  ]
    .map(normalizeEmail)
    .filter(Boolean)
  if (customerEmail && emailCandidates.includes(customerEmail)) return true

  const customerPhone = normalizePhone(customer.phone)
  const phoneCandidates = [
    firstText(data, ['customerPhone', 'phone', 'clientPhone', 'customer.phone', 'contact.phone', 'student.phone']),
  ]
    .map(normalizePhone)
    .filter(Boolean)
  if (customerPhone && phoneCandidates.includes(customerPhone)) return true

  const customerHasStableContact = Boolean(customerEmail || customerPhone)
  if (customerHasStableContact) return false

  const primaryName = normalizeName(customer.displayName || customer.name)
  if (!primaryName) return false
  const nameCandidates = [
    firstText(data, ['customerName', 'name', 'clientName', 'customer.name', 'contact.name', 'student.name', 'displayName']),
  ]
    .map(normalizeName)
    .filter(Boolean)
  return nameCandidates.includes(primaryName)
}

function snapshotRows(snapshot: Awaited<ReturnType<typeof getDocs>>, source?: string): DataRow[] {
  return snapshot.docs.map(documentSnapshot => ({
    id: documentSnapshot.id,
    data: documentSnapshot.data() as RecordMap,
    source,
  }))
}

function uniqueRows(rows: DataRow[], keyPaths: string[] = ['reference', 'bookingId', 'paymentReference']): DataRow[] {
  const byKey = new Map<string, DataRow>()
  rows.forEach(row => {
    const reference = firstText(row.data, keyPaths)
    const key = reference ? `ref:${reference.toLowerCase()}` : `id:${row.id}`
    if (!byKey.has(key)) byKey.set(key, row)
  })
  return Array.from(byKey.values())
}

function isBookingLike(data: RecordMap): boolean {
  const recordType = (firstText(data, ['recordType', 'orderType', 'order_type']) || '').toLowerCase()
  const accountingType = (firstText(data, ['accountingType', 'accounting_type', 'metadata.accountingType']) || '').toLowerCase()
  const quickPayType = (firstText(data, ['metadata.quickPayType', 'metadata.itemType']) || '').toLowerCase()
  return recordType === 'service_booking' || accountingType === 'booking' || quickPayType === 'booking'
}

function formatMoney(value: number | null | undefined, currency = 'GHS'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function formatDate(value: unknown, includeTime = false): string {
  const date = toDate(value)
  if (!date) return '—'
  return includeTime ? date.toLocaleString() : date.toLocaleDateString()
}

function statusText(value: unknown, fallback = 'Not recorded'): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return value.trim().replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <article className="customer-crm__stat">
      <span className="customer-crm__stat-label">{label}</span>
      <strong className="customer-crm__stat-value">{value}</strong>
      <span className="customer-crm__stat-hint">{hint}</span>
    </article>
  )
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return <div className="customer-crm__empty">{children}</div>
}

function Timeline({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <EmptySection>No activity has been linked to this customer yet.</EmptySection>
  return (
    <div className="customer-crm__timeline">
      {items.map(item => (
        <article className="customer-crm__timeline-item" key={item.id}>
          <div className="customer-crm__timeline-marker" aria-hidden="true" />
          <div className="customer-crm__timeline-copy">
            <div className="customer-crm__timeline-head">
              <span className="customer-crm__kind">{item.kind}</span>
              <time>{item.date ? item.date.toLocaleString() : 'Date not recorded'}</time>
            </div>
            {item.href ? <Link to={item.href} className="customer-crm__timeline-title">{item.title}</Link> : <strong className="customer-crm__timeline-title">{item.title}</strong>}
            <p>{item.detail}</p>
          </div>
        </article>
      ))}
    </div>
  )
}

export default function CustomerCRM() {
  const { storeId } = useActiveStore()
  const { customerId } = useParams<{ customerId?: string }>()
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [crmData, setCrmData] = useState<CrmData>(EMPTY_DATA)
  const [loadingCustomers, setLoadingCustomers] = useState(true)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messageChannel, setMessageChannel] = useState<'whatsapp' | 'email' | 'telegram'>('whatsapp')
  const [messageBody, setMessageBody] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [documentTitle, setDocumentTitle] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const [documentKind, setDocumentKind] = useState('Other')
  const [savingAction, setSavingAction] = useState(false)

  const selectedCustomer = useMemo(
    () => customers.find(customer => customer.id === customerId) ?? null,
    [customerId, customers],
  )

  const loadCustomers = useCallback(async () => {
    if (!storeId) {
      setCustomers([])
      setLoadingCustomers(false)
      return
    }
    setLoadingCustomers(true)
    setError(null)
    try {
      const snapshot = await getDocs(query(collection(db, 'customers'), where('storeId', '==', storeId), limit(1000)))
      const rows = snapshot.docs
        .map(documentSnapshot => ({ id: documentSnapshot.id, ...(documentSnapshot.data() as Omit<CustomerRecord, 'id'>) }))
        .sort((left, right) => customerName(left).localeCompare(customerName(right), undefined, { sensitivity: 'base' }))
      setCustomers(rows)
    } catch (loadError) {
      console.error('[customer-crm] Unable to load customers', loadError)
      setError('Unable to load customers right now.')
    } finally {
      setLoadingCustomers(false)
    }
  }, [storeId])

  useEffect(() => {
    void loadCustomers()
  }, [loadCustomers])

  useEffect(() => {
    setActiveTab('overview')
    setMessageBody('')
    setNoteBody('')
    setError(null)
  }, [customerId])

  const loadProfile = useCallback(async () => {
    if (!storeId || !selectedCustomer) {
      setCrmData(EMPTY_DATA)
      return
    }
    setLoadingProfile(true)
    setError(null)
    try {
      const [
        salesSnapshot,
        storeBookingsSnapshot,
        rootBookingsSnapshot,
        storeOrdersSnapshot,
        rootOrdersSnapshot,
        invoicesSnapshot,
        receiptsSnapshot,
        eventsSnapshot,
        studentsSnapshot,
        messagesSnapshot,
        notesSnapshot,
        documentsSnapshot,
      ] = await Promise.all([
        getDocs(query(collection(db, 'sales'), where('storeId', '==', storeId), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'stores', storeId, 'integrationBookings'), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'integrationBookings'), where('storeId', '==', storeId), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'stores', storeId, 'integrationOrders'), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'integrationOrders'), where('storeId', '==', storeId), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'stores', storeId, 'invoices'), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'stores', storeId, 'receipts'), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'stores', storeId, 'events'), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(query(collection(db, 'students'), where('storeId', '==', storeId), where('customerId', '==', selectedCustomer.id), limit(CUSTOMER_ACTIVITY_LIMIT))),
        getDocs(collection(db, 'customers', selectedCustomer.id, 'messages')),
        getDocs(collection(db, 'customers', selectedCustomer.id, 'notes')),
        getDocs(collection(db, 'customers', selectedCustomer.id, 'documents')),
      ])

      const sales = snapshotRows(salesSnapshot).filter(row => {
        const status = (firstText(row.data, ['status']) || '').toLowerCase()
        return status !== 'voided' && customerMatchesRow(selectedCustomer, row.data)
      })
      const bookingRows = [
        ...snapshotRows(storeBookingsSnapshot, 'store'),
        ...snapshotRows(rootBookingsSnapshot, 'root'),
        ...snapshotRows(storeOrdersSnapshot, 'store-order').filter(row => isBookingLike(row.data)),
        ...snapshotRows(rootOrdersSnapshot, 'root-order').filter(row => isBookingLike(row.data)),
      ]
      const bookings = uniqueRows(bookingRows, ['bookingId', 'reference', 'paymentReference', 'payment.reference'])
        .filter(row => customerMatchesRow(selectedCustomer, row.data))
      const invoices = snapshotRows(invoicesSnapshot).filter(row => customerMatchesRow(selectedCustomer, row.data))
      const receipts = snapshotRows(receiptsSnapshot).filter(row => customerMatchesRow(selectedCustomer, row.data))
      const events = snapshotRows(eventsSnapshot).filter(row => customerMatchesRow(selectedCustomer, row.data))
      const courses = snapshotRows(studentsSnapshot).filter(row => customerMatchesRow(selectedCustomer, row.data))

      setCrmData({
        sales,
        bookings,
        invoices,
        receipts,
        events,
        courses,
        messages: snapshotRows(messagesSnapshot),
        notes: snapshotRows(notesSnapshot),
        documents: snapshotRows(documentsSnapshot),
      })
    } catch (loadError) {
      console.error('[customer-crm] Unable to load customer profile', loadError)
      setError('Some CRM activity could not be loaded. Refresh to try again.')
    } finally {
      setLoadingProfile(false)
    }
  }, [selectedCustomer, storeId])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter(customer => [
      customerName(customer),
      customer.phone,
      customer.email,
      customer.notes,
      ...(customer.tags ?? []),
    ].filter(Boolean).join(' ').toLowerCase().includes(term))
  }, [customers, search])

  const totals = useMemo(() => {
    const salesTotal = crmData.sales.reduce((sum, row) => sum + (firstNumber(row.data, ['total', 'amount']) ?? 0), 0)
    const openInvoices = crmData.invoices.filter(row => !['paid', 'cancelled', 'canceled'].includes((firstText(row.data, ['status']) || 'draft').toLowerCase()))
    const openInvoiceTotal = openInvoices.reduce((sum, row) => sum + (firstNumber(row.data, ['total']) ?? 0), 0)
    const debtCents = typeof selectedCustomer?.debt?.outstandingCents === 'number' ? selectedCustomer.debt.outstandingCents : Number(selectedCustomer?.debt?.outstandingCents ?? 0)
    return {
      salesTotal,
      openInvoiceTotal,
      outstanding: Number.isFinite(debtCents) ? debtCents / 100 : 0,
      openInvoiceCount: openInvoices.length,
    }
  }, [crmData.invoices, crmData.sales, selectedCustomer])

  const activity = useMemo<ActivityItem[]>(() => {
    if (!selectedCustomer) return []
    const rows: ActivityItem[] = []
    crmData.sales.forEach(row => {
      const total = firstNumber(row.data, ['total', 'amount'])
      rows.push({
        id: `sale-${row.id}`,
        kind: 'Sale',
        title: total !== null ? formatMoney(total) : 'Sale recorded',
        detail: firstText(row.data, ['payment.method']) ? `Payment: ${firstText(row.data, ['payment.method'])}` : 'POS / sales activity',
        date: recordDate(row.data, ['createdAt', 'updatedAt']),
        href: '/reports/pos-sales',
      })
    })
    crmData.bookings.forEach(row => {
      const service = firstText(row.data, ['serviceName', 'booking.serviceName', 'metadata.serviceName', 'items.0.name']) || 'Service booking'
      const bookingDate = firstText(row.data, ['bookingDate', 'date', 'booking.preferredDate', 'metadata.bookingDate'])
      rows.push({ id: `booking-${row.id}`, kind: 'Booking', title: service, detail: bookingDate ? `Booked for ${bookingDate}` : 'Booking activity', date: recordDate(row.data), href: '/bookings' })
    })
    crmData.invoices.forEach(row => {
      const invoiceNumber = firstText(row.data, ['invoiceNumber']) || row.id
      rows.push({ id: `invoice-${row.id}`, kind: 'Invoice', title: invoiceNumber, detail: `${statusText(firstText(row.data, ['status']))} • ${formatMoney(firstNumber(row.data, ['total']))}`, date: recordDate(row.data, ['updatedAt', 'createdAt']), href: '/invoices' })
    })
    crmData.receipts.forEach(row => {
      const receiptNumber = firstText(row.data, ['receiptNumber']) || row.id
      rows.push({ id: `receipt-${row.id}`, kind: 'Payment', title: receiptNumber, detail: `${formatMoney(firstNumber(row.data, ['amountPaid']))} • ${firstText(row.data, ['paymentMethod']) || 'Payment method not recorded'}`, date: recordDate(row.data), href: '/receipts' })
    })
    crmData.events.forEach(row => {
      const title = firstText(row.data, ['title', 'eventTitle', 'eventType']) || 'Event project'
      const code = firstText(row.data, ['eventCode'])
      rows.push({ id: `event-${row.id}`, kind: 'Event', title, detail: [code, firstText(row.data, ['eventDate']), statusText(firstText(row.data, ['status']), '')].filter(Boolean).join(' • '), date: recordDate(row.data), href: `/event-planning/${encodeURIComponent(row.id)}` })
    })
    crmData.courses.forEach(row => {
      const course = firstText(row.data, ['course']) || 'Course / student record'
      rows.push({ id: `course-${row.id}`, kind: 'Course', title: course, detail: [statusText(firstText(row.data, ['studentStatus']), ''), statusText(firstText(row.data, ['payment.status']), '')].filter(Boolean).join(' • '), date: recordDate(row.data), href: '/students' })
    })
    crmData.messages.forEach(row => {
      rows.push({ id: `message-${row.id}`, kind: 'Message', title: statusText(firstText(row.data, ['channel']), 'Message'), detail: firstText(row.data, ['body']) || 'Message activity', date: recordDate(row.data) })
    })
    crmData.notes.forEach(row => {
      rows.push({ id: `note-${row.id}`, kind: 'Note', title: 'CRM note', detail: firstText(row.data, ['body']) || 'Note added', date: recordDate(row.data) })
    })
    crmData.documents.forEach(row => {
      rows.push({ id: `document-${row.id}`, kind: 'Document', title: firstText(row.data, ['title']) || 'Customer document', detail: firstText(row.data, ['kind']) || 'Document link', date: recordDate(row.data) })
    })
    return rows
      .sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0))
      .slice(0, 60)
  }, [crmData, selectedCustomer])

  async function sendMessage() {
    if (!selectedCustomer || !storeId || !messageBody.trim()) return
    const body = messageBody.trim()
    const whatsappPhone = normalizeWhatsAppPhone(selectedCustomer.phone)
    const email = selectedCustomer.email?.trim() || ''
    let externalUrl = ''

    if (messageChannel === 'whatsapp') {
      if (!whatsappPhone) {
        setError('This customer phone number cannot be used for WhatsApp. Save a valid number such as 0201234567 or +233201234567.')
        return
      }
      externalUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(body)}`
    }
    if (messageChannel === 'telegram') externalUrl = `https://t.me/share/url?text=${encodeURIComponent(body)}`
    if (messageChannel === 'email' && email) externalUrl = `mailto:${email}?subject=${encodeURIComponent(`Message for ${customerName(selectedCustomer)}`)}&body=${encodeURIComponent(body)}`
    if (!externalUrl) {
      setError(`Add a ${messageChannel === 'email' ? 'customer email address' : 'customer phone number'} before using this channel.`)
      return
    }

    // Open while the browser still considers this a direct user gesture. This
    // avoids iOS/Safari treating the handoff as a delayed popup after Firestore.
    window.open(externalUrl, '_blank', 'noopener,noreferrer')

    setSavingAction(true)
    setError(null)
    try {
      const payload = {
        storeId,
        customerId: selectedCustomer.id,
        customerName: customerName(selectedCustomer),
        channel: messageChannel,
        body,
        status: 'opened_external',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'customers', selectedCustomer.id, 'messages'), payload)
      setCrmData(previous => ({ ...previous, messages: [{ id: ref.id, data: { ...payload, createdAt: new Date(), updatedAt: new Date() } }, ...previous.messages] }))
      setMessageBody('')
    } catch (saveError) {
      console.error('[customer-crm] Unable to log message', saveError)
      setError('The channel was opened, but Sedifex could not log this message in the customer profile.')
    } finally {
      setSavingAction(false)
    }
  }

  async function addNote() {
    if (!selectedCustomer || !storeId || !noteBody.trim()) return
    setSavingAction(true)
    setError(null)
    try {
      const payload = {
        storeId,
        customerId: selectedCustomer.id,
        body: noteBody.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'customers', selectedCustomer.id, 'notes'), payload)
      setCrmData(previous => ({ ...previous, notes: [{ id: ref.id, data: { ...payload, createdAt: new Date(), updatedAt: new Date() } }, ...previous.notes] }))
      setNoteBody('')
    } catch (saveError) {
      console.error('[customer-crm] Unable to add note', saveError)
      setError('Unable to save this note.')
    } finally {
      setSavingAction(false)
    }
  }

  async function addDocument() {
    if (!selectedCustomer || !storeId || !documentTitle.trim() || !documentUrl.trim()) return
    let normalizedUrl = documentUrl.trim()
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`
    try {
      new URL(normalizedUrl)
    } catch {
      setError('Enter a valid document URL.')
      return
    }

    setSavingAction(true)
    setError(null)
    try {
      const payload = {
        storeId,
        customerId: selectedCustomer.id,
        title: documentTitle.trim(),
        url: normalizedUrl,
        kind: documentKind,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'customers', selectedCustomer.id, 'documents'), payload)
      setCrmData(previous => ({ ...previous, documents: [{ id: ref.id, data: { ...payload, createdAt: new Date(), updatedAt: new Date() } }, ...previous.documents] }))
      setDocumentTitle('')
      setDocumentUrl('')
      setDocumentKind('Other')
    } catch (saveError) {
      console.error('[customer-crm] Unable to add document', saveError)
      setError('Unable to save this document link.')
    } finally {
      setSavingAction(false)
    }
  }

  function renderSales() {
    if (!crmData.sales.length) return <EmptySection>No sales have been linked to this customer.</EmptySection>
    return (
      <div className="customer-crm__records">
        {crmData.sales.map(row => {
          const items = Array.isArray(row.data.items) ? row.data.items : []
          return (
            <article className="customer-crm__record" key={row.id}>
              <div><strong>{formatMoney(firstNumber(row.data, ['total', 'amount']))}</strong><span>{formatDate(readPath(row.data, 'createdAt'), true)}</span></div>
              <div><span>{firstText(row.data, ['payment.method']) || 'Payment method not recorded'}</span><span>{items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'Items not recorded'}</span></div>
            </article>
          )
        })}
      </div>
    )
  }

  function renderBookings() {
    if (!crmData.bookings.length) return <EmptySection>No bookings have been linked to this customer.</EmptySection>
    return (
      <div className="customer-crm__records">
        {crmData.bookings.map(row => (
          <article className="customer-crm__record" key={`${row.source}-${row.id}`}>
            <div><strong>{firstText(row.data, ['serviceName', 'booking.serviceName', 'metadata.serviceName']) || 'Service booking'}</strong><span>{firstText(row.data, ['bookingDate', 'date', 'booking.preferredDate']) || formatDate(readPath(row.data, 'createdAt'))}</span></div>
            <div><span>{statusText(firstText(row.data, ['bookingStatus', 'status']))}</span><span>{statusText(firstText(row.data, ['paymentStatus', 'payment.status']), 'Payment not recorded')}</span></div>
          </article>
        ))}
        <Link className="customer-crm__section-link" to="/bookings">Open all bookings</Link>
      </div>
    )
  }

  function renderInvoices() {
    if (!crmData.invoices.length) return <EmptySection>No invoices have been linked to this customer.</EmptySection>
    return (
      <div className="customer-crm__records">
        {crmData.invoices.map(row => (
          <article className="customer-crm__record" key={row.id}>
            <div><strong>{firstText(row.data, ['invoiceNumber']) || row.id}</strong><span>{formatMoney(firstNumber(row.data, ['total']))}</span></div>
            <div><span>{statusText(firstText(row.data, ['status']), 'Draft')}</span><span>Due {firstText(row.data, ['dueDate']) || 'not set'}</span></div>
          </article>
        ))}
        <Link className="customer-crm__section-link" to="/invoices">Open invoices</Link>
      </div>
    )
  }

  function renderEvents() {
    if (!crmData.events.length) return <EmptySection>No event projects have been linked to this customer.</EmptySection>
    return (
      <div className="customer-crm__records">
        {crmData.events.map(row => (
          <Link className="customer-crm__record customer-crm__record--link" key={row.id} to={`/event-planning/${encodeURIComponent(row.id)}`}>
            <div><strong>{firstText(row.data, ['title', 'eventTitle', 'eventType']) || 'Event project'}</strong><span>{firstText(row.data, ['eventDate']) || 'Date not set'}</span></div>
            <div><span>{firstText(row.data, ['eventCode']) || 'No event code'}</span><span>{statusText(firstText(row.data, ['status']))}</span></div>
          </Link>
        ))}
      </div>
    )
  }

  function renderCourses() {
    if (!crmData.courses.length) return <EmptySection>No course or student records have been linked to this customer.</EmptySection>
    return (
      <div className="customer-crm__records">
        {crmData.courses.map(row => (
          <article className="customer-crm__record" key={row.id}>
            <div><strong>{firstText(row.data, ['course']) || 'Course / student record'}</strong><span>{firstText(row.data, ['studentCode']) || 'No student code'}</span></div>
            <div><span>{statusText(firstText(row.data, ['studentStatus']))}</span><span>{statusText(firstText(row.data, ['payment.status']), 'Payment not recorded')}</span></div>
          </article>
        ))}
        <Link className="customer-crm__section-link" to="/students">Open students</Link>
      </div>
    )
  }

  function renderPayments() {
    const salePayments = crmData.sales.filter(row => firstText(row.data, ['payment.method']) || firstNumber(row.data, ['payment.amountPaid']) !== null)
    if (!crmData.receipts.length && !salePayments.length) return <EmptySection>No payments have been linked to this customer.</EmptySection>
    return (
      <div className="customer-crm__records">
        {crmData.receipts.map(row => (
          <article className="customer-crm__record" key={`receipt-${row.id}`}>
            <div><strong>{firstText(row.data, ['receiptNumber']) || 'Receipt'}</strong><span>{formatMoney(firstNumber(row.data, ['amountPaid']))}</span></div>
            <div><span>{firstText(row.data, ['paymentMethod']) || 'Payment method not recorded'}</span><span>{formatDate(readPath(row.data, 'createdAt'), true)}</span></div>
          </article>
        ))}
        {salePayments.map(row => (
          <article className="customer-crm__record" key={`sale-payment-${row.id}`}>
            <div><strong>POS payment</strong><span>{formatMoney(firstNumber(row.data, ['payment.amountPaid', 'total']))}</span></div>
            <div><span>{firstText(row.data, ['payment.method']) || 'Payment method not recorded'}</span><span>{formatDate(readPath(row.data, 'createdAt'), true)}</span></div>
          </article>
        ))}
        <Link className="customer-crm__section-link" to="/receipts">Open receipts</Link>
      </div>
    )
  }

  function renderMessages() {
    return (
      <div className="customer-crm__split-section">
        <div className="customer-crm__composer">
          <h3>Send a customer message</h3>
          <p>Sedifex logs the message in this profile, then opens your selected channel. The log records the handoff, not delivery confirmation.</p>
          <div className="customer-crm__field-row">
            <label>Channel<select value={messageChannel} onChange={event => setMessageChannel(event.target.value as typeof messageChannel)}><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="telegram">Telegram</option></select></label>
          </div>
          <label>Message<textarea rows={5} value={messageBody} onChange={event => setMessageBody(event.target.value)} placeholder="Write a follow-up, payment reminder, or update..." /></label>
          <button type="button" className="customer-crm__primary" disabled={savingAction || !messageBody.trim()} onClick={() => void sendMessage()}>Open channel & log message</button>
        </div>
        <div>
          <h3>Message history</h3>
          {crmData.messages.length ? (
            <div className="customer-crm__records">
              {[...crmData.messages].sort((a, b) => (recordDate(b.data)?.getTime() ?? 0) - (recordDate(a.data)?.getTime() ?? 0)).map(row => (
                <article className="customer-crm__record" key={row.id}>
                  <div><strong>{statusText(firstText(row.data, ['channel']), 'Message')}</strong><span>{formatDate(readPath(row.data, 'createdAt'), true)}</span></div>
                  <p>{firstText(row.data, ['body']) || 'Message body not recorded'}</p>
                  <small>{statusText(firstText(row.data, ['status']), 'Logged')}</small>
                </article>
              ))}
            </div>
          ) : <EmptySection>No CRM messages logged yet.</EmptySection>}
        </div>
      </div>
    )
  }

  function renderNotes() {
    return (
      <div className="customer-crm__split-section">
        <div className="customer-crm__composer">
          <h3>Add a CRM note</h3>
          {selectedCustomer?.notes ? <div className="customer-crm__legacy-note"><strong>Profile note</strong><p>{selectedCustomer.notes}</p></div> : null}
          <label>New note<textarea rows={5} value={noteBody} onChange={event => setNoteBody(event.target.value)} placeholder="Record a preference, follow-up, agreement, or internal note..." /></label>
          <button type="button" className="customer-crm__primary" disabled={savingAction || !noteBody.trim()} onClick={() => void addNote()}>Save note</button>
        </div>
        <div>
          <h3>Note history</h3>
          {crmData.notes.length ? (
            <div className="customer-crm__records">
              {[...crmData.notes].sort((a, b) => (recordDate(b.data)?.getTime() ?? 0) - (recordDate(a.data)?.getTime() ?? 0)).map(row => (
                <article className="customer-crm__record" key={row.id}>
                  <div><strong>CRM note</strong><span>{formatDate(readPath(row.data, 'createdAt'), true)}</span></div>
                  <p>{firstText(row.data, ['body']) || '—'}</p>
                </article>
              ))}
            </div>
          ) : <EmptySection>No note history yet.</EmptySection>}
        </div>
      </div>
    )
  }

  function renderDocuments() {
    return (
      <div className="customer-crm__split-section">
        <div className="customer-crm__composer">
          <h3>Attach a document link</h3>
          <p>Save a secure Drive, cloud-storage, contract, ID, quotation, or other document link on the customer profile.</p>
          <label>Title<input value={documentTitle} onChange={event => setDocumentTitle(event.target.value)} placeholder="e.g. Signed service agreement" /></label>
          <div className="customer-crm__field-row">
            <label>Type<select value={documentKind} onChange={event => setDocumentKind(event.target.value)}><option>Other</option><option>Contract</option><option>Identification</option><option>Quotation</option><option>Agreement</option><option>Brief</option></select></label>
          </div>
          <label>Document URL<input value={documentUrl} onChange={event => setDocumentUrl(event.target.value)} placeholder="https://..." /></label>
          <button type="button" className="customer-crm__primary" disabled={savingAction || !documentTitle.trim() || !documentUrl.trim()} onClick={() => void addDocument()}>Save document link</button>
        </div>
        <div>
          <h3>Customer documents</h3>
          {crmData.documents.length ? (
            <div className="customer-crm__records">
              {[...crmData.documents].sort((a, b) => (recordDate(b.data)?.getTime() ?? 0) - (recordDate(a.data)?.getTime() ?? 0)).map(row => {
                const url = firstText(row.data, ['url'])
                return (
                  <article className="customer-crm__record" key={row.id}>
                    <div>{url ? <a href={url} target="_blank" rel="noreferrer"><strong>{firstText(row.data, ['title']) || 'Document'}</strong></a> : <strong>{firstText(row.data, ['title']) || 'Document'}</strong>}<span>{firstText(row.data, ['kind']) || 'Other'}</span></div>
                    <small>{formatDate(readPath(row.data, 'createdAt'), true)}</small>
                  </article>
                )
              })}
            </div>
          ) : <EmptySection>No attached document links yet.</EmptySection>}
          <div className="customer-crm__financial-docs">
            <h4>Financial documents</h4>
            <p>{crmData.invoices.length} invoice{crmData.invoices.length === 1 ? '' : 's'} • {crmData.receipts.length} receipt{crmData.receipts.length === 1 ? '' : 's'}</p>
            <div><Link to="/invoices">Invoices</Link><Link to="/receipts">Receipts</Link></div>
          </div>
        </div>
      </div>
    )
  }

  function renderActiveTab() {
    switch (activeTab) {
      case 'sales': return renderSales()
      case 'bookings': return renderBookings()
      case 'invoices': return renderInvoices()
      case 'events': return renderEvents()
      case 'courses': return renderCourses()
      case 'payments': return renderPayments()
      case 'messages': return renderMessages()
      case 'notes': return renderNotes()
      case 'documents': return renderDocuments()
      default:
        return (
          <div className="customer-crm__overview-grid">
            <section className="customer-crm__panel">
              <div className="customer-crm__panel-head"><div><span>Activity</span><h3>Unified customer timeline</h3></div><button type="button" onClick={() => void loadProfile()} disabled={loadingProfile}>Refresh</button></div>
              <Timeline items={activity} />
            </section>
            <aside className="customer-crm__panel customer-crm__finance-panel">
              <span>Account snapshot</span>
              <h3>Money & follow-up</h3>
              <dl>
                <div><dt>Recorded outstanding balance</dt><dd>{formatMoney(totals.outstanding)}</dd></div>
                <div><dt>Open invoices</dt><dd>{totals.openInvoiceCount}</dd></div>
                <div><dt>Open invoice value</dt><dd>{formatMoney(totals.openInvoiceTotal)}</dd></div>
                <div><dt>Debt due date</dt><dd>{formatDate(selectedCustomer?.debt?.dueDate)}</dd></div>
                <div><dt>Last reminder</dt><dd>{formatDate(selectedCustomer?.debt?.lastReminderAt, true)}</dd></div>
              </dl>
              <div className="customer-crm__quick-links">
                <Link to={`/sell?customerId=${encodeURIComponent(selectedCustomer?.id || '')}`}>Start sale</Link>
                <Link to="/invoices">Create invoice</Link>
                <Link to="/bookings/new">Add booking</Link>
                <button type="button" onClick={() => setActiveTab('messages')}>Message customer</button>
              </div>
            </aside>
          </div>
        )
    }
  }

  return (
    <main className="customer-crm">
      <header className="customer-crm__hero">
        <div>
          <span className="customer-crm__eyebrow">Unified CRM</span>
          <h1>Customers & clients</h1>
          <p>One profile across POS sales, bookings, invoices, event projects, payments, courses, messages, notes, and documents.</p>
        </div>
        <div className="customer-crm__hero-actions">
          <Link className="customer-crm__secondary" to="/customers/manage">Manage customer list</Link>
          <Link className="customer-crm__primary" to="/customers/manage">Add customer</Link>
        </div>
      </header>

      {error ? <div className="customer-crm__alert" role="alert">{error}</div> : null}

      <div className="customer-crm__layout">
        <aside className={`customer-crm__directory${selectedCustomer ? ' customer-crm__directory--with-selection' : ''}`}>
          <div className="customer-crm__directory-head">
            <div><span>Directory</span><strong>{customers.length} customers</strong></div>
            <button type="button" onClick={() => void loadCustomers()} disabled={loadingCustomers}>Refresh</button>
          </div>
          <label className="customer-crm__search">
            <span>Search customers</span>
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, phone, email, tag..." />
          </label>
          <div className="customer-crm__customer-list">
            {loadingCustomers ? <p className="customer-crm__list-status">Loading customers…</p> : null}
            {!loadingCustomers && !filteredCustomers.length ? <p className="customer-crm__list-status">No customers match your search.</p> : null}
            {filteredCustomers.map(customer => {
              const active = customer.id === selectedCustomer?.id
              const outstandingCents = typeof customer.debt?.outstandingCents === 'number' ? customer.debt.outstandingCents : 0
              return (
                <button
                  key={customer.id}
                  type="button"
                  className={`customer-crm__customer${active ? ' is-active' : ''}`}
                  onClick={() => navigate(`/customers/${encodeURIComponent(customer.id)}`)}
                >
                  <span className="customer-crm__avatar">{customerName(customer).slice(0, 2).toUpperCase()}</span>
                  <span className="customer-crm__customer-copy">
                    <strong>{customerName(customer)}</strong>
                    <small>{customer.phone || customer.email || 'No contact details'}</small>
                    {outstandingCents > 0 ? <em>{formatMoney(outstandingCents / 100)} outstanding</em> : null}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className={`customer-crm__workspace${!selectedCustomer && !customerId ? ' customer-crm__workspace--empty' : ''}`}>
          {!selectedCustomer ? (
            <div className="customer-crm__welcome">
              <span>Customer 360°</span>
              <h2>{customerId ? 'Customer not found' : 'Select a customer'}</h2>
              <p>{customerId ? 'This customer may have been removed or belongs to another workspace.' : 'Choose a customer from the directory to open their unified profile and activity across Sedifex.'}</p>
              <Link to="/customers/manage">Open customer management</Link>
            </div>
          ) : (
            <>
              <div className="customer-crm__profile-head">
                <div className="customer-crm__identity">
                  <span className="customer-crm__profile-avatar">{customerName(selectedCustomer).slice(0, 2).toUpperCase()}</span>
                  <div>
                    <span className="customer-crm__eyebrow">Customer profile</span>
                    <h2>{customerName(selectedCustomer)}</h2>
                    <p>{[selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(' • ') || 'No contact details saved'}</p>
                    {selectedCustomer.tags?.length ? <div className="customer-crm__tags">{selectedCustomer.tags.map(tag => <span key={tag}>#{tag}</span>)}</div> : null}
                  </div>
                </div>
                <Link className="customer-crm__secondary" to="/customers/manage">Edit customer</Link>
              </div>

              {storeId ? (
                <CustomerPortalShareCard
                  storeId={storeId}
                  customerId={selectedCustomer.id}
                  customerName={customerName(selectedCustomer)}
                  customerEmail={selectedCustomer.email}
                />
              ) : null}

              <section className="customer-crm__stats" aria-label="Customer CRM summary">
                <StatCard label="Sales" value={formatMoney(totals.salesTotal)} hint={`${crmData.sales.length} linked transaction${crmData.sales.length === 1 ? '' : 's'}`} />
                <StatCard label="Bookings" value={crmData.bookings.length} hint="Service activity" />
                <StatCard label="Invoices" value={crmData.invoices.length} hint={`${totals.openInvoiceCount} open`} />
                <StatCard label="Event projects" value={crmData.events.length} hint="Planning workspaces" />
                <StatCard label="Outstanding" value={formatMoney(totals.outstanding)} hint="Recorded CRM debt" />
                <StatCard label="Courses" value={crmData.courses.length} hint="Student / course records" />
              </section>

              <div className="customer-crm__tabs" role="tablist" aria-label="Customer profile sections">
                {TABS.map(tab => (
                  <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
                ))}
              </div>

              <section className="customer-crm__tab-content" aria-live="polite">
                {loadingProfile ? <div className="customer-crm__loading">Connecting customer activity across Sedifex…</div> : renderActiveTab()}
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
