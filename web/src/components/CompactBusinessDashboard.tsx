import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useStorePreferences } from '../hooks/useStorePreferences'
import type { Industry } from '../config/navigation'
import './CompactBusinessDashboard.css'

type RecordData = Record<string, unknown>
type WidgetId =
  | 'needs-attention'
  | 'todays-sales'
  | 'upcoming'
  | 'outstanding-invoices'
  | 'low-stock'
  | 'payments-due'
  | 'pending-client-tasks'
  | 'recent-leads'
  | 'staff-activity'

type WidgetItem = {
  id: string
  title: string
  meta: string
  value?: string
  to?: string
  tone?: 'warning' | 'danger' | 'success'
}

type WidgetView = {
  id: WidgetId
  title: string
  eyebrow: string
  summary: string
  description: string
  to: string
  linkLabel: string
  items: WidgetItem[]
  empty: string
}

type KpiView = {
  id: string
  label: string
  value: string
  hint: string
}

const MAX_WIDGETS = 6
const STAFF_AUDIT_LIMIT = 50

const WIDGET_LABELS: Record<WidgetId, { label: string; description: string }> = {
  'needs-attention': { label: 'Needs attention', description: 'Urgent payments, stock, bookings and event follow-up.' },
  'todays-sales': { label: "Today's sales", description: 'A compact view of sales recorded today.' },
  upcoming: { label: 'Upcoming appointments/events', description: 'The next scheduled bookings, classes or events.' },
  'outstanding-invoices': { label: 'Outstanding invoices', description: 'Invoices that still have an unpaid balance.' },
  'low-stock': { label: 'Low-stock products', description: 'Products at or below their reorder point.' },
  'payments-due': { label: 'Customer balances', description: 'Recorded customer balances and due dates from CRM.' },
  'pending-client-tasks': { label: 'Pending client tasks', description: 'Open event tasks and client actions.' },
  'recent-leads': { label: 'Recent leads', description: 'Newest lead or customer activity in CRM.' },
  'staff-activity': { label: 'Staff activity', description: 'Recent staff changes and team activity.' },
}

const DEFAULT_WIDGETS_BY_INDUSTRY: Record<Industry, WidgetId[]> = {
  shop: ['needs-attention', 'todays-sales', 'low-stock', 'outstanding-invoices'],
  travel: ['needs-attention', 'upcoming', 'payments-due', 'recent-leads'],
  ngo: ['needs-attention', 'recent-leads', 'payments-due', 'staff-activity'],
  school: ['needs-attention', 'upcoming', 'outstanding-invoices', 'recent-leads'],
  event: ['needs-attention', 'upcoming', 'payments-due', 'pending-client-tasks', 'recent-leads'],
}

function asRecord(value: unknown): RecordData {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {}
}

function pickText(record: RecordData, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return fallback
}

function pickNumber(record: RecordData, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = record[key]
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (typeof (value as { toDate?: unknown })?.toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate()
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null
  }
  return null
}

function pickDate(record: RecordData, keys: string[]) {
  for (const key of keys) {
    const date = toDate(record[key])
    if (date) return date
  }
  return null
}

function startOfToday() {
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  return value
}

function isToday(value: Date | null) {
  if (!value) return false
  const today = startOfToday()
  return value.getFullYear() === today.getFullYear()
    && value.getMonth() === today.getMonth()
    && value.getDate() === today.getDate()
}

function normalizeStatus(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(value)
}

function formatCompactDate(value: Date | null) {
  if (!value) return 'Date not set'
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatActivityDate(value: Date | null) {
  if (!value) return 'Recently'
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function saleAmount(record: RecordData) {
  const minor = pickNumber(record, ['amountMinor', 'totalMinor'], 0)
  if (minor > 0) return minor / 100
  return pickNumber(record, ['total', 'amount', 'totalAmount', 'grandTotal', 'netTotal'], 0)
}

function saleDate(record: RecordData) {
  return pickDate(record, ['createdAt', 'createdAtServer', 'saleDate', 'updatedAt'])
}

function bookingDate(record: RecordData) {
  const booking = asRecord(record.booking)
  const metadata = asRecord(record.metadata)
  const rawDate = pickText(record, ['bookingDate', 'date'])
    || pickText(booking, ['preferredDate', 'date'])
    || pickText(metadata, ['bookingDate', 'eventDate'])
  const rawTime = pickText(record, ['bookingTime', 'time']) || pickText(booking, ['preferredTime', 'time'])
  if (rawDate) {
    const combined = new Date(rawTime ? `${rawDate}T${rawTime}` : rawDate)
    if (!Number.isNaN(combined.getTime())) return combined
  }
  return pickDate(record, ['startAt', 'scheduledAt', 'appointmentAt', 'createdAtServer', 'createdAt'])
}

function eventDate(record: RecordData) {
  return pickDate(record, ['eventDate', 'date', 'startDate', 'startAt'])
    || toDate(pickText(record, ['eventDate', 'date', 'startDate']))
}

function customerName(record: RecordData) {
  const customer = asRecord(record.customer)
  return pickText(record, ['customerName', 'clientName', 'name'])
    || pickText(customer, ['name', 'fullName'])
    || 'Customer'
}

function customerCreatedAt(record: RecordData) {
  return pickDate(record, ['createdAt', 'createdAtServer', 'updatedAt'])
}

function invoiceDueDate(record: RecordData) {
  return pickDate(record, ['dueDate', 'paymentDueDate', 'dueAt'])
    || toDate(pickText(record, ['dueDate', 'paymentDueDate']))
}

function invoiceTotal(record: RecordData) {
  return pickNumber(record, ['total', 'totalAmount', 'grandTotal', 'amount', 'contractValue'], 0)
}

function invoiceBalance(record: RecordData) {
  const explicit = pickNumber(record, ['balance', 'balanceDue', 'amountDue', 'outstanding', 'remainingBalance'], Number.NaN)
  if (Number.isFinite(explicit)) return Math.max(0, explicit)
  const status = normalizeStatus(record.paymentStatus ?? record.status)
  return ['paid', 'settled', 'completed', 'cancelled', 'void'].includes(status) ? 0 : Math.max(0, invoiceTotal(record))
}

function invoiceReference(record: RecordData) {
  return pickText(record, ['invoiceNumber', 'number', 'reference', 'invoiceNo'], 'Invoice')
}

function productName(record: RecordData) {
  return pickText(record, ['name', 'productName', 'title'], 'Unnamed product')
}

function eventTitle(record: RecordData) {
  return pickText(record, ['title', 'eventName', 'name'], 'Untitled event')
}

function openClientTaskCount(record: RecordData) {
  const direct = pickNumber(record, ['openChecklistTasks', 'pendingClientTasks', 'openTasks', 'pendingTasks'], Number.NaN)
  if (Number.isFinite(direct)) return Math.max(0, direct)

  const checklistTaskCount = pickNumber(record, ['checklistTaskCount'], Number.NaN)
  const checklistCompletedCount = pickNumber(record, ['checklistCompletedCount'], 0)
  if (Number.isFinite(checklistTaskCount)) {
    return Math.max(0, Math.floor(checklistTaskCount) - Math.max(0, Math.floor(checklistCompletedCount)))
  }

  const summary = asRecord(record.checklistSummary)
  const summaryCount = pickNumber(summary, ['open', 'pending', 'remaining'], Number.NaN)
  if (Number.isFinite(summaryCount)) return Math.max(0, summaryCount)

  const taskLists = [record.clientTasks, record.tasks, record.checklist]
  for (const value of taskLists) {
    if (!Array.isArray(value)) continue
    return value.filter(item => {
      const task = asRecord(item)
      const status = normalizeStatus(task.status)
      return !['done', 'completed', 'complete', 'cancelled'].includes(status) && task.completed !== true
    }).length
  }
  return 0
}

function normalizeWidgetIds(value: unknown, availableIds: WidgetId[], fallback: WidgetId[]) {
  if (!Array.isArray(value)) return fallback.filter(id => availableIds.includes(id)).slice(0, MAX_WIDGETS)
  const cleaned: WidgetId[] = []
  for (const raw of value) {
    if (typeof raw !== 'string' || !availableIds.includes(raw as WidgetId)) continue
    const id = raw as WidgetId
    if (!cleaned.includes(id)) cleaned.push(id)
  }
  return cleaned.slice(0, MAX_WIDGETS)
}

function reorder<T>(items: T[], fromIndex: number, toIndex: number) {
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export default function CompactBusinessDashboard() {
  const { storeId } = useActiveStore()
  const { preferences } = useStorePreferences(storeId)
  const industry = preferences.navigation.industry
  const enabledModules = useMemo(() => new Set(preferences.navigation.enabledModules), [preferences.navigation.enabledModules])

  const [sales, setSales] = useState<RecordData[]>([])
  const [orders, setOrders] = useState<RecordData[]>([])
  const [bookings, setBookings] = useState<RecordData[]>([])
  const [products, setProducts] = useState<RecordData[]>([])
  const [customers, setCustomers] = useState<RecordData[]>([])
  const [invoices, setInvoices] = useState<RecordData[]>([])
  const [events, setEvents] = useState<RecordData[]>([])
  const [staffAudits, setStaffAudits] = useState<RecordData[]>([])
  const [teamMembers, setTeamMembers] = useState<RecordData[]>([])

  const [selectedWidgetIds, setSelectedWidgetIds] = useState<WidgetId[]>([])
  const [savedWidgetIds, setSavedWidgetIds] = useState<WidgetId[]>([])
  const [isCustomizing, setIsCustomizing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [layoutMessage, setLayoutMessage] = useState('')
  const [draggedWidgetId, setDraggedWidgetId] = useState<WidgetId | null>(null)
  const [showMoreInsights, setShowMoreInsights] = useState(false)

  useEffect(() => {
    if (!storeId) {
      setSales([])
      setOrders([])
      setBookings([])
      setProducts([])
      setCustomers([])
      setInvoices([])
      setEvents([])
      setStaffAudits([])
      setTeamMembers([])
      return undefined
    }

    // These widgets calculate counts/totals after applying business criteria in
    // the client, so the listeners must preserve the complete candidate set.
    // Only staff audit activity is deliberately bounded because the UI renders
    // recent activity only; that query is explicitly ordered before limiting.
    const unsubscribers = [
      onSnapshot(query(collection(db, 'sales'), where('storeId', '==', storeId)), snapshot => setSales(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setSales([])),
      onSnapshot(query(collection(db, 'integrationOrders'), where('storeId', '==', storeId)), snapshot => setOrders(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setOrders([])),
      onSnapshot(query(collection(db, 'integrationBookings'), where('storeId', '==', storeId)), snapshot => setBookings(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setBookings([])),
      onSnapshot(query(collection(db, 'products'), where('storeId', '==', storeId)), snapshot => setProducts(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setProducts([])),
      onSnapshot(query(collection(db, 'customers'), where('storeId', '==', storeId)), snapshot => setCustomers(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setCustomers([])),
      onSnapshot(collection(db, 'stores', storeId, 'invoices'), snapshot => setInvoices(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setInvoices([])),
      onSnapshot(collection(db, 'stores', storeId, 'events'), snapshot => setEvents(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setEvents([])),
      onSnapshot(query(collection(db, 'staffAudit'), where('storeId', '==', storeId), orderBy('createdAt', 'desc'), limit(STAFF_AUDIT_LIMIT)), snapshot => setStaffAudits(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setStaffAudits([])),
      onSnapshot(query(collection(db, 'teamMembers'), where('storeId', '==', storeId)), snapshot => setTeamMembers(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setTeamMembers([])),
    ]

    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
  }, [storeId])

  const availableWidgetIds = useMemo(() => {
    const ids: WidgetId[] = ['needs-attention', 'staff-activity']
    if (industry === 'shop' || enabledModules.has('sell') || enabledModules.has('marketplace-orders')) ids.push('todays-sales')
    if (enabledModules.has('bookings') || enabledModules.has('upcoming-events') || enabledModules.has('events')) ids.push('upcoming')
    if (enabledModules.has('invoices')) ids.push('outstanding-invoices')
    if (enabledModules.has('products')) ids.push('low-stock')
    if (industry === 'event' || enabledModules.has('events')) ids.push('pending-client-tasks')
    if (enabledModules.has('customers')) ids.push('payments-due', 'recent-leads')
    return Array.from(new Set(ids))
  }, [enabledModules, industry])

  const defaultWidgetIds = useMemo(() => {
    const preset = DEFAULT_WIDGETS_BY_INDUSTRY[industry].filter(id => availableWidgetIds.includes(id))
    return (preset.length ? preset : availableWidgetIds.slice(0, 4)).slice(0, MAX_WIDGETS)
  }, [availableWidgetIds, industry])

  const availableWidgetKey = availableWidgetIds.join('|')
  const defaultWidgetKey = defaultWidgetIds.join('|')

  useEffect(() => {
    if (!storeId) {
      setSelectedWidgetIds(defaultWidgetIds)
      setSavedWidgetIds(defaultWidgetIds)
      return undefined
    }

    return onSnapshot(doc(db, 'dashboardPreferences', storeId), snapshot => {
      const data = snapshot.data() as { selectedWidgetIds?: unknown; widgetOrder?: unknown } | undefined
      const storedValue = data?.selectedWidgetIds ?? data?.widgetOrder
      const normalized = normalizeWidgetIds(storedValue, availableWidgetIds, defaultWidgetIds)
      setSelectedWidgetIds(normalized)
      setSavedWidgetIds(normalized)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, availableWidgetKey, defaultWidgetKey])

  const today = startOfToday()
  const todaySales = sales.filter(item => normalizeStatus(item.status) !== 'voided' && isToday(saleDate(item)))
  const todaySalesTotal = todaySales.reduce((sum, item) => sum + saleAmount(item), 0)
  const todayOrders = orders.filter(item => isToday(pickDate(item, ['createdAtServer', 'createdAt', 'updatedAt'])))
  const todayBookings = bookings.filter(item => isToday(pickDate(item, ['createdAtServer', 'createdAt', 'updatedAt'])))

  const lowStockItems = products
    .filter(item => (item.itemType ?? 'product') === 'product')
    .map(item => ({
      id: pickText(item, ['id'], productName(item)),
      name: productName(item),
      stock: pickNumber(item, ['stockCount', 'stock', 'quantity'], 0),
      reorderPoint: pickNumber(item, ['reorderPoint', 'lowStockThreshold'], 0),
    }))
    .filter(item => item.stock <= 0 || (item.reorderPoint > 0 && item.stock <= item.reorderPoint))
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))

  const invoiceRows = invoices.map(item => ({
    id: pickText(item, ['id'], invoiceReference(item)),
    reference: invoiceReference(item),
    customer: customerName(item),
    dueDate: invoiceDueDate(item),
    balance: invoiceBalance(item),
    status: normalizeStatus(item.paymentStatus ?? item.status),
  }))

  const outstandingInvoices = invoiceRows
    .filter(item => item.balance > 0 || !['paid', 'settled', 'completed', 'cancelled', 'void'].includes(item.status))
    .sort((a, b) => (a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY))

  const outstandingBalance = outstandingInvoices.reduce((sum, item) => sum + item.balance, 0)
  const overdueInvoices = outstandingInvoices.filter(item => item.dueDate && item.dueDate < today)

  const customerDebtRows = customers
    .map(item => {
      const debt = asRecord(item.debt)
      const outstandingCents = Math.max(0, pickNumber(debt, ['outstandingCents'], 0))
      return {
        id: pickText(item, ['id'], customerName(item)),
        customer: customerName(item),
        balance: outstandingCents / 100,
        dueDate: toDate(debt.dueDate),
      }
    })
    .filter(item => item.balance > 0)
    .sort((a, b) => (a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY) - (b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY))

  const customerOutstandingBalance = customerDebtRows.reduce((sum, item) => sum + item.balance, 0)
  const overdueCustomerDebts = customerDebtRows.filter(item => item.dueDate && item.dueDate < today)

  const bookingEntries = bookings
    .map(item => ({
      id: pickText(item, ['id'], pickText(item, ['reference', 'bookingId'], 'booking')),
      title: pickText(item, ['serviceName', 'internalServiceName', 'itemName', 'productName'], 'Booking'),
      customer: customerName(item),
      date: bookingDate(item),
      status: normalizeStatus(item.bookingStatus ?? item.status),
      to: `/bookings/${pickText(item, ['id'], '')}`,
    }))
    .filter(item => item.date && item.date >= today && !['cancelled', 'deleted', 'completed'].includes(item.status))

  const allEventEntries = events.map(item => ({
    id: pickText(item, ['id'], eventTitle(item)),
    title: eventTitle(item),
    customer: pickText(item, ['clientName', 'customerName'], 'Client'),
    date: eventDate(item),
    status: normalizeStatus(item.status),
    openTasks: openClientTaskCount(item),
    to: `/event-planning/${pickText(item, ['id'], '')}`,
  }))

  const eventEntries = allEventEntries
    .filter(item => item.date && item.date >= today && !['cancelled', 'completed'].includes(item.status))

  const clientTaskEntries = allEventEntries
    .filter(item => !['cancelled', 'completed'].includes(item.status) && item.openTasks > 0)
    .sort((a, b) => (a.date?.getTime() ?? Number.POSITIVE_INFINITY) - (b.date?.getTime() ?? Number.POSITIVE_INFINITY))

  const upcomingEntries = [...bookingEntries, ...eventEntries]
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0))

  const pendingClientTasks = clientTaskEntries.reduce((sum, item) => sum + item.openTasks, 0)

  const recentCustomerRows = [...customers]
    .sort((a, b) => (customerCreatedAt(b)?.getTime() ?? 0) - (customerCreatedAt(a)?.getTime() ?? 0))
  const explicitLeadRows = recentCustomerRows.filter(item => {
    const status = normalizeStatus(item.lifecycleStage ?? item.stage ?? item.status ?? item.type)
    return ['lead', 'prospect', 'inquiry', 'new_lead', 'new'].includes(status)
  })
  const leadRows = explicitLeadRows.length > 0 ? explicitLeadRows : recentCustomerRows
  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const newLeadCount = leadRows.filter(item => {
    const createdAt = customerCreatedAt(item)
    return createdAt ? createdAt >= sevenDaysAgo : false
  }).length

  const sortedStaffAudits = [...staffAudits].sort((a, b) => {
    const bDate = pickDate(b, ['createdAt', 'updatedAt'])?.getTime() ?? 0
    const aDate = pickDate(a, ['createdAt', 'updatedAt'])?.getTime() ?? 0
    return bDate - aDate
  })

  const activeEvents = events.filter(item => !['completed', 'cancelled'].includes(normalizeStatus(item.status))).length
  const attentionCount = lowStockItems.length + overdueInvoices.length + overdueCustomerDebts.length
    + bookings.filter(item => ['pending', 'pending_approval', 'manual_review'].includes(normalizeStatus(item.bookingStatus ?? item.status))).length
    + pendingClientTasks

  const customerBalanceHint = `${customerDebtRows.length} customer${customerDebtRows.length === 1 ? '' : 's'} owing`

  const topKpis: KpiView[] = (() => {
    if (industry === 'event') {
      return [
        { id: 'active-events', label: 'Active events', value: String(activeEvents), hint: 'Events still in progress' },
        { id: 'upcoming-events', label: 'Upcoming events', value: String(eventEntries.length), hint: 'Future active events' },
        { id: 'payments-due', label: 'Customer balance', value: formatMoney(customerOutstandingBalance), hint: customerBalanceHint },
        { id: 'client-tasks', label: 'Client tasks', value: String(pendingClientTasks), hint: 'Open event/client actions' },
      ]
    }
    if (industry === 'travel' || industry === 'school') {
      return [
        { id: 'bookings-today', label: industry === 'school' ? 'Classes/bookings today' : 'Bookings today', value: String(todayBookings.length), hint: 'New booking records today' },
        { id: 'upcoming', label: 'Upcoming', value: String(bookingEntries.length), hint: industry === 'school' ? 'Future classes/bookings' : 'Future bookings' },
        { id: 'payments-due', label: 'Customer balance', value: formatMoney(customerOutstandingBalance), hint: customerBalanceHint },
        { id: 'new-leads', label: industry === 'school' ? 'New contacts' : 'New leads', value: String(newLeadCount), hint: 'Added in the last 7 days' },
      ]
    }
    if (industry === 'ngo') {
      return [
        { id: 'contacts', label: 'Contacts', value: String(customers.length), hint: 'Saved CRM records' },
        { id: 'upcoming', label: 'Upcoming activity', value: String(bookingEntries.length), hint: 'Future campaigns/bookings' },
        { id: 'payments-due', label: 'Customer balance', value: formatMoney(customerOutstandingBalance), hint: customerBalanceHint },
        { id: 'attention', label: 'Needs attention', value: String(attentionCount), hint: 'Items requiring follow-up' },
      ]
    }
    return [
      { id: 'sales-today', label: "Today's sales", value: formatMoney(todaySalesTotal), hint: `${todaySales.length} POS sale${todaySales.length === 1 ? '' : 's'}` },
      { id: 'orders-today', label: 'Orders today', value: String(todayOrders.length), hint: 'Website and marketplace orders' },
      { id: 'low-stock', label: 'Low stock', value: String(lowStockItems.length), hint: 'Products needing attention' },
      { id: 'payments-due', label: 'Customer balance', value: formatMoney(customerOutstandingBalance), hint: customerBalanceHint },
    ]
  })()

  const needsAttentionItems: WidgetItem[] = [
    ...overdueCustomerDebts.slice(0, 2).map(item => ({ id: `customer-debt-${item.id}`, title: `${item.customer} has an overdue balance`, meta: `Due ${formatCompactDate(item.dueDate)}`, value: formatMoney(item.balance), to: `/customers/${item.id}`, tone: 'danger' as const })),
    ...overdueInvoices.slice(0, 2).map(item => ({ id: `invoice-${item.id}`, title: `${item.reference} is overdue`, meta: `${item.customer} · due ${formatCompactDate(item.dueDate)}`, value: item.balance > 0 ? formatMoney(item.balance) : undefined, to: '/invoices', tone: 'danger' as const })),
    ...lowStockItems.slice(0, 2).map(item => ({ id: `stock-${item.id}`, title: item.stock <= 0 ? `${item.name} is out of stock` : `${item.name} is running low`, meta: item.reorderPoint ? `Reorder point ${item.reorderPoint}` : 'Check inventory level', value: item.stock <= 0 ? 'Out' : `${item.stock} left`, to: '/products', tone: 'warning' as const })),
    ...bookings.filter(item => ['pending', 'pending_approval', 'manual_review'].includes(normalizeStatus(item.bookingStatus ?? item.status))).slice(0, 2).map(item => ({ id: `booking-${pickText(item, ['id'], Math.random().toString())}`, title: 'Booking needs confirmation', meta: customerName(item), to: '/bookings', tone: 'warning' as const })),
    ...clientTaskEntries.slice(0, 2).map(item => ({ id: `event-${item.id}`, title: `${item.title} has open tasks`, meta: `${item.customer} · ${item.openTasks} pending`, to: item.to, tone: 'warning' as const })),
  ].slice(0, 3)

  function buildWidget(id: WidgetId): WidgetView {
    switch (id) {
      case 'todays-sales':
        return {
          id,
          title: "Today's sales",
          eyebrow: 'Sales',
          summary: formatMoney(todaySalesTotal),
          description: `${todaySales.length} POS sale${todaySales.length === 1 ? '' : 's'} recorded today.`,
          to: '/reports/pos-sales',
          linkLabel: 'View sales',
          items: todaySales.slice(0, 3).map(item => ({ id: pickText(item, ['id'], Math.random().toString()), title: customerName(item), meta: pickText(item, ['reference', 'saleId', 'receiptNumber'], 'POS sale'), value: formatMoney(saleAmount(item)), to: '/reports/pos-sales' })),
          empty: 'No sales recorded today.',
        }
      case 'upcoming':
        return {
          id,
          title: 'Upcoming appointments/events',
          eyebrow: 'Schedule',
          summary: String(upcomingEntries.length),
          description: 'Future bookings, classes and events in one compact list.',
          to: industry === 'event' ? '/event-planning' : '/upcoming-events',
          linkLabel: 'View schedule',
          items: upcomingEntries.slice(0, 3).map(item => ({ id: `${item.to}-${item.id}`, title: item.title, meta: `${item.customer} · ${formatCompactDate(item.date)}`, to: item.to })),
          empty: 'Nothing upcoming right now.',
        }
      case 'outstanding-invoices':
        return {
          id,
          title: 'Outstanding invoices',
          eyebrow: 'Invoices',
          summary: String(outstandingInvoices.length),
          description: `${formatMoney(outstandingBalance)} still outstanding.`,
          to: '/invoices',
          linkLabel: 'View invoices',
          items: outstandingInvoices.slice(0, 3).map(item => ({ id: item.id, title: item.reference, meta: `${item.customer} · ${item.dueDate ? `due ${formatCompactDate(item.dueDate)}` : 'no due date'}`, value: item.balance > 0 ? formatMoney(item.balance) : 'Open', to: '/invoices', tone: item.dueDate && item.dueDate < today ? 'danger' : undefined })),
          empty: 'No outstanding invoices.',
        }
      case 'low-stock':
        return {
          id,
          title: 'Low-stock products',
          eyebrow: 'Inventory',
          summary: String(lowStockItems.length),
          description: 'Only products at or below their reorder level appear here.',
          to: '/products',
          linkLabel: 'Manage inventory',
          items: lowStockItems.slice(0, 3).map(item => ({ id: item.id, title: item.name, meta: item.reorderPoint ? `Reorder at ${item.reorderPoint}` : 'Reorder point not set', value: item.stock <= 0 ? 'Out' : `${item.stock} left`, to: '/products', tone: item.stock <= 0 ? 'danger' : 'warning' })),
          empty: 'No low-stock products.',
        }
      case 'payments-due':
        return {
          id,
          title: 'Customer balances',
          eyebrow: 'Cash flow',
          summary: formatMoney(customerOutstandingBalance),
          description: `${overdueCustomerDebts.length} overdue · ${customerDebtRows.length} customer${customerDebtRows.length === 1 ? '' : 's'} owing.`,
          to: '/customers',
          linkLabel: 'Review customers',
          items: customerDebtRows.slice(0, 3).map(item => ({ id: `payment-${item.id}`, title: item.customer, meta: item.dueDate ? `due ${formatCompactDate(item.dueDate)}` : 'No due date', value: formatMoney(item.balance), to: `/customers/${item.id}`, tone: item.dueDate && item.dueDate < today ? 'danger' : undefined })),
          empty: 'No customers have a recorded outstanding balance.',
        }
      case 'pending-client-tasks':
        return {
          id,
          title: 'Pending client tasks',
          eyebrow: 'Events',
          summary: String(pendingClientTasks),
          description: 'Open checklist and client-action items across active events.',
          to: '/event-planning',
          linkLabel: 'Manage events',
          items: clientTaskEntries.slice(0, 3).map(item => ({ id: item.id, title: item.title, meta: `${item.customer} · ${formatCompactDate(item.date)}`, value: `${item.openTasks} open`, to: item.to, tone: 'warning' })),
          empty: 'No pending client tasks.',
        }
      case 'recent-leads':
        return {
          id,
          title: 'Recent leads',
          eyebrow: 'CRM',
          summary: String(newLeadCount),
          description: explicitLeadRows.length > 0 ? 'New CRM leads added in the last 7 days.' : 'Recent CRM contacts; lead stages appear here when available.',
          to: '/customers',
          linkLabel: 'Open CRM',
          items: leadRows.slice(0, 3).map(item => ({ id: pickText(item, ['id'], customerName(item)), title: customerName(item), meta: `${pickText(item, ['email', 'phone'], 'CRM contact')} · ${formatActivityDate(customerCreatedAt(item))}`, to: `/customers/${pickText(item, ['id'], '')}` })),
          empty: 'No recent leads or CRM contacts.',
        }
      case 'staff-activity':
        return {
          id,
          title: 'Staff activity',
          eyebrow: 'Team',
          summary: String(teamMembers.filter(item => normalizeStatus(item.status) !== 'inactive').length),
          description: `${teamMembers.length} team member${teamMembers.length === 1 ? '' : 's'} · recent account activity below.`,
          to: '/staff',
          linkLabel: 'Manage staff',
          items: sortedStaffAudits.slice(0, 3).map(item => ({ id: pickText(item, ['id'], Math.random().toString()), title: pickText(item, ['targetEmail'], 'Staff account'), meta: `${pickText(item, ['action'], 'Activity').replace(/_/g, ' ')} · ${formatActivityDate(pickDate(item, ['createdAt', 'updatedAt']))}`, value: normalizeStatus(item.outcome) === 'failure' ? 'Failed' : undefined, to: '/staff', tone: normalizeStatus(item.outcome) === 'failure' ? 'danger' : 'success' })),
          empty: teamMembers.length ? 'No recent staff audit activity.' : 'No staff members have been added yet.',
        }
      case 'needs-attention':
      default:
        return {
          id: 'needs-attention',
          title: 'Needs attention',
          eyebrow: 'Priority',
          summary: String(attentionCount),
          description: 'Sedifex combines urgent signals here so you do not need every widget visible.',
          to: overdueCustomerDebts.length ? '/customers' : overdueInvoices.length ? '/invoices' : lowStockItems.length ? '/products' : industry === 'event' ? '/event-planning' : '/bookings',
          linkLabel: 'Review',
          items: needsAttentionItems,
          empty: 'Nothing urgent needs attention right now.',
        }
    }
  }

  const visibleWidgets = selectedWidgetIds.map(buildWidget)
  const extraWidgets = availableWidgetIds.filter(id => !selectedWidgetIds.includes(id)).map(buildWidget)

  function toggleWidget(id: WidgetId) {
    setLayoutMessage('')
    setSelectedWidgetIds(current => {
      if (current.includes(id)) return current.filter(item => item !== id)
      if (current.length >= MAX_WIDGETS) {
        setLayoutMessage(`Choose up to ${MAX_WIDGETS} dashboard widgets.`)
        return current
      }
      return [...current, id]
    })
  }

  function moveWidget(id: WidgetId, direction: -1 | 1) {
    const index = selectedWidgetIds.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= selectedWidgetIds.length) return

    const next = reorder(selectedWidgetIds, index, nextIndex)
    setSelectedWidgetIds(next)
    if (!isCustomizing) void persistLayout(next, false)
  }

  async function persistLayout(nextIds = selectedWidgetIds, closeWhenSaved = true) {
    if (!storeId) return
    try {
      setIsSaving(true)
      setLayoutMessage('')
      await setDoc(doc(db, 'dashboardPreferences', storeId), {
        storeId,
        selectedWidgetIds: nextIds,
        widgetOrder: nextIds,
        dashboardVersion: 2,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setSavedWidgetIds(nextIds)
      setLayoutMessage('Dashboard layout saved for this store.')
      if (closeWhenSaved) setIsCustomizing(false)
    } catch (error) {
      console.error('[dashboard-v2] Failed to save dashboard layout', error)
      setLayoutMessage('Unable to save the dashboard layout right now.')
    } finally {
      setIsSaving(false)
    }
  }

  function handleDrop(targetId: WidgetId) {
    if (!draggedWidgetId || draggedWidgetId === targetId) return
    const fromIndex = selectedWidgetIds.indexOf(draggedWidgetId)
    const toIndex = selectedWidgetIds.indexOf(targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const next = reorder(selectedWidgetIds, fromIndex, toIndex)
    setSelectedWidgetIds(next)
    setDraggedWidgetId(null)
    void persistLayout(next, false)
  }

  function handleDragStart(event: DragEvent<HTMLElement>, widgetId: WidgetId) {
    setDraggedWidgetId(widgetId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', widgetId)
  }

  function closeCustomizer() {
    setSelectedWidgetIds(savedWidgetIds)
    setLayoutMessage('')
    setIsCustomizing(false)
  }

  return (
    <main className="compact-dashboard">
      <header className="compact-dashboard__header">
        <div>
          <p className="compact-dashboard__eyebrow">Business dashboard</p>
          <h1>What needs your attention today?</h1>
          <p>Four quick numbers at the top, then only the widgets this store chooses to keep.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setIsCustomizing(true)}>Customize dashboard</button>
      </header>

      {layoutMessage && !isCustomizing ? <p className={`compact-dashboard__message${layoutMessage.startsWith('Unable') ? ' is-error' : ''}`}>{layoutMessage}</p> : null}

      <section className="compact-dashboard__kpis" aria-label="Business summary">
        {topKpis.map(kpi => (
          <article key={kpi.id} className="compact-dashboard__kpi">
            <p>{kpi.label}</p>
            <strong>{kpi.value}</strong>
            <span>{kpi.hint}</span>
          </article>
        ))}
      </section>

      {visibleWidgets.length ? (
        <section className="compact-dashboard__widgets" aria-label="Selected dashboard widgets">
          {visibleWidgets.map((widget, index) => (
            <article
              key={widget.id}
              className={`compact-dashboard__widget${draggedWidgetId === widget.id ? ' is-dragging' : ''}`}
              draggable
              onDragStart={event => handleDragStart(event, widget.id)}
              onDragEnd={() => setDraggedWidgetId(null)}
              onDragOver={event => event.preventDefault()}
              onDrop={() => handleDrop(widget.id)}
            >
              <div className="compact-dashboard__widget-header">
                <div>
                  <p className="compact-dashboard__widget-eyebrow">{widget.eyebrow}</p>
                  <h2>{widget.title}</h2>
                </div>
                <div className="compact-dashboard__widget-actions" aria-label={`Reorder ${widget.title}`}>
                  <button type="button" onClick={() => moveWidget(widget.id, -1)} disabled={index === 0} aria-label={`Move ${widget.title} up`}>↑</button>
                  <button type="button" onClick={() => moveWidget(widget.id, 1)} disabled={index === visibleWidgets.length - 1} aria-label={`Move ${widget.title} down`}>↓</button>
                  <span aria-hidden="true" title="Drag to reorder">⋮⋮</span>
                </div>
              </div>
              <div className="compact-dashboard__widget-summary">
                <strong>{widget.summary}</strong>
                <p>{widget.description}</p>
              </div>
              {widget.items.length ? (
                <div className="compact-dashboard__list">
                  {widget.items.slice(0, 3).map(item => {
                    const content = (
                      <>
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.meta}</small>
                        </span>
                        {item.value ? <b className={item.tone ? `is-${item.tone}` : ''}>{item.value}</b> : null}
                      </>
                    )
                    return item.to ? <Link key={item.id} to={item.to} className="compact-dashboard__list-row">{content}</Link> : <div key={item.id} className="compact-dashboard__list-row">{content}</div>
                  })}
                </div>
              ) : <p className="compact-dashboard__empty">{widget.empty}</p>}
              <Link className="compact-dashboard__view-all" to={widget.to}>{widget.linkLabel} →</Link>
            </article>
          ))}
        </section>
      ) : (
        <section className="compact-dashboard__empty-state">
          <strong>No dashboard widgets selected.</strong>
          <p>Your four summary cards will stay visible. Add widgets only when you want more detail.</p>
          <button type="button" className="button button--secondary" onClick={() => setIsCustomizing(true)}>Choose widgets</button>
        </section>
      )}

      {extraWidgets.length ? (
        <section className="compact-dashboard__more">
          <button type="button" className="compact-dashboard__more-toggle" onClick={() => setShowMoreInsights(value => !value)} aria-expanded={showMoreInsights}>
            More insights <span>{showMoreInsights ? '↑' : '↓'}</span>
          </button>
          {showMoreInsights ? (
            <div className="compact-dashboard__more-grid">
              {extraWidgets.map(widget => (
                <button key={widget.id} type="button" onClick={() => { setIsCustomizing(true); setShowMoreInsights(false) }}>
                  <span>{widget.title}</span><strong>{widget.summary}</strong>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {isCustomizing ? (
        <div className="compact-dashboard__overlay" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) closeCustomizer() }}>
          <section className="compact-dashboard__customizer" role="dialog" aria-modal="true" aria-labelledby="dashboard-customizer-title">
            <div className="compact-dashboard__customizer-header">
              <div>
                <p className="compact-dashboard__eyebrow">Store dashboard</p>
                <h2 id="dashboard-customizer-title">Choose what appears</h2>
                <p>Select up to {MAX_WIDGETS} widgets. The order below is the order saved for this store.</p>
              </div>
              <button type="button" className="compact-dashboard__close" onClick={closeCustomizer} aria-label="Close dashboard customizer">×</button>
            </div>

            <div className="compact-dashboard__selection-count">
              <strong>{selectedWidgetIds.length}/{MAX_WIDGETS}</strong>
              <span>widgets selected</span>
            </div>

            <div className="compact-dashboard__picker">
              {availableWidgetIds.map(id => {
                const selected = selectedWidgetIds.includes(id)
                const details = WIDGET_LABELS[id]
                return (
                  <label key={id} className={`compact-dashboard__picker-option${selected ? ' is-selected' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleWidget(id)} aria-label={details.label} />
                    <span><strong>{details.label}</strong><small>{details.description}</small></span>
                  </label>
                )
              })}
            </div>

            {selectedWidgetIds.length > 1 ? (
              <div className="compact-dashboard__order-list">
                <p>Order</p>
                {selectedWidgetIds.map((id, index) => (
                  <div key={id}>
                    <span>{index + 1}. {WIDGET_LABELS[id].label}</span>
                    <span>
                      <button type="button" onClick={() => moveWidget(id, -1)} disabled={index === 0} aria-label={`Move ${WIDGET_LABELS[id].label} up`}>↑</button>
                      <button type="button" onClick={() => moveWidget(id, 1)} disabled={index === selectedWidgetIds.length - 1} aria-label={`Move ${WIDGET_LABELS[id].label} down`}>↓</button>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {layoutMessage ? <p className={`compact-dashboard__message${layoutMessage.startsWith('Unable') || layoutMessage.startsWith('Choose') ? ' is-error' : ''}`}>{layoutMessage}</p> : null}

            <div className="compact-dashboard__customizer-footer">
              <button type="button" className="button button--secondary" onClick={() => { setSelectedWidgetIds(defaultWidgetIds); setLayoutMessage('') }}>Reset to {industry} preset</button>
              <div>
                <button type="button" className="button button--secondary" onClick={closeCustomizer}>Cancel</button>
                <button type="button" className="button button--primary" disabled={isSaving} onClick={() => void persistLayout()}>{isSaving ? 'Saving…' : 'Save dashboard'}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
