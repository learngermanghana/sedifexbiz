import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useActiveStore } from '../../hooks/useActiveStore'
import { asNumber, asText, downloadCsv, exportReportPdf, formatDate, formatMoney, getNestedObject, normalizeSourceChannel, toDate } from './reportUtils'
import { canonicalBookingOrderKey, chooseMoreCompleteRecord, deriveReportPaymentFields, normalizeBookingStatusFromRecord } from '../../lib/bookingStatus'

type BookingRow = {
  id: string
  reference: string
  bookingId: string
  serviceName: string
  recordType: string
  customerName: string
  customerPhone: string
  sourceChannel: string
  sourceLabel: string
  sourcePath: 'root' | 'store'
  bookingDate: string
  bookingTime: string
  paymentStatus: string
  bookingStatus: string
  syncStatus: string
  syncReason: string
  reminderStatus: string
  confirmedAt: Date | null
  cancelledAt: Date | null
  completedAt: Date | null
  registrationStatus: string
  slotStartAt: string
  slotEndAt: string
  amount: number
  amountReceived: number
  amountOutstanding: number
  createdAt: Date | null
  updatedAt: Date | null
}

type SummaryCard = { label: string; value: string | number; helper: string; tone: string }

function sourceLabel(sourceChannel: string) {
  if (sourceChannel === 'client_website') return 'Client website'
  if (sourceChannel === 'sedifex_market') return 'Sedifex Market'
  if (sourceChannel === 'sedifex_custom_page') return 'Sedifex public page'
  if (sourceChannel === 'manual_admin') return 'Manual/admin'
  return sourceChannel.replace(/_/g, ' ')
}

function normalizeStatus(value: unknown, fallback = 'pending') {
  const raw = asText(value, fallback).toLowerCase().replace(/\s+/g, '_')
  if (['paid', 'success', 'succeeded', 'confirmed', 'complete'].includes(raw)) return raw === 'confirmed' ? 'confirmed' : 'paid'
  if (raw === 'canceled') return 'cancelled'
  return raw || fallback
}

function readReminderStatus(data: Record<string, unknown>) {
  const sent = [
    data.reminder_3d_sent_at || data.reminder3dSentAt ? '3d' : '',
    data.reminder_2d_sent_at || data.reminder2dSentAt ? '2d' : '',
    data.reminder_1d_sent_at || data.reminder1dSentAt ? '1d' : '',
    data.thank_you_sent_at || data.thankYouSentAt ? 'thanks' : '',
  ].filter(Boolean)
  return sent.length ? sent.join(', ') : 'Not sent'
}

function mapBooking(id: string, data: Record<string, unknown>, sourcePath: 'root' | 'store'): BookingRow {
  const customer = getNestedObject(data, 'customer')
  const booking = getNestedObject(data, 'booking')
  const payment = getNestedObject(data, 'payment')
  const sourceChannel = normalizeSourceChannel(data.sourceChannel ?? data.source_channel ?? data.source)
  const reportFields = deriveReportPaymentFields(data)
  return {
    id,
    reference: asText(data.reference ?? data.paymentReference ?? data.payment_reference ?? payment.reference, id),
    bookingId: asText(data.booking_id ?? data.bookingId, id),
    serviceName: asText(data.serviceName ?? data.internalServiceName ?? booking.serviceName ?? data.itemName ?? data.productName, 'Service booking'),
    recordType: asText(data.recordType ?? data.listingType, 'booking'),
    customerName: asText(customer.name ?? data.customerName ?? data.name ?? data.fullName, 'Customer'),
    customerPhone: asText(customer.phone ?? customer.email ?? data.customerPhone ?? data.phone ?? data.email, ''),
    sourceChannel,
    sourceLabel: sourceLabel(sourceChannel),
    sourcePath,
    bookingDate: asText(data.bookingDate ?? data.date ?? booking.preferredDate ?? booking.date, '—'),
    bookingTime: asText(data.bookingTime ?? data.time ?? booking.preferredTime ?? booking.time, '—'),
    paymentStatus: reportFields.paymentStatus,
    bookingStatus: normalizeBookingStatusFromRecord(data),
    syncStatus: normalizeStatus(data.syncStatus ?? data.sync_status, 'not_ready'),
    syncReason: asText(data.syncReason ?? data.sync_reason, '—'),
    reminderStatus: readReminderStatus(data),
    confirmedAt: toDate(data.confirmedAt ?? data.paymentConfirmedAt ?? data.payment_confirmed_at),
    cancelledAt: toDate(data.cancelledAt ?? data.cancelled_at),
    completedAt: toDate(data.completedAt ?? data.completed_at),
    registrationStatus: asText(data.registrationStatus, '—'),
    slotStartAt: asText(data.startAt ?? booking.startAt, '—'),
    slotEndAt: asText(data.endAt ?? booking.endAt, '—'),
    amount: reportFields.totalAmount || asNumber(payment.amount ?? data.paymentAmount ?? data.amount ?? data.total, 0),
    amountReceived: reportFields.amountReceived,
    amountOutstanding: reportFields.amountOutstanding,
    createdAt: toDate(data.createdAtServer ?? data.createdAt ?? data.updatedAt),
    updatedAt: toDate(data.updatedAt ?? data.updated_at ?? data.paymentUpdatedAt),
  }
}

function startForRange(range: string) {
  const now = new Date()
  const start = new Date(now)
  if (range === 'today') start.setHours(0, 0, 0, 0)
  if (range === 'yesterday') { start.setDate(now.getDate() - 1); start.setHours(0, 0, 0, 0) }
  if (range === '7d') start.setDate(now.getDate() - 7)
  if (range === '30d') start.setDate(now.getDate() - 30)
  if (range === 'month') { start.setDate(1); start.setHours(0, 0, 0, 0) }
  if (range === 'last_month') { start.setMonth(now.getMonth() - 1, 1); start.setHours(0, 0, 0, 0) }
  return start
}

function endForRange(range: string) {
  const now = new Date()
  if (range === 'yesterday') { const end = new Date(now); end.setHours(0, 0, 0, 0); return end }
  if (range === 'last_month') return new Date(now.getFullYear(), now.getMonth(), 1)
  return now
}

function inDateRange(date: Date | null, range: string) {
  if (range === 'all') return true
  if (!date) return false
  return date >= startForRange(range) && date <= endForRange(range)
}

function isPaidLike(status: string) {
  return ['paid', 'success', 'confirmed', 'completed'].some(token => status.toLowerCase().includes(token))
}

function badgeClass(status: string, type: 'booking' | 'payment' | 'sync' = 'booking') {
  const value = status.toLowerCase()
  if (type === 'payment' && isPaidLike(value)) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (type === 'sync' && value === 'synced') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value.includes('confirmed') || value.includes('completed')) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value.includes('pending') || value.includes('not_ready')) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (value.includes('cancel') || value.includes('failed')) return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

function formatLabel(value: string) { return value.replace(/_/g, ' ') }

function SummaryMetric({ item }: { item: SummaryCard }) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderLeft: `6px solid ${item.tone}` }}>
    <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: item.tone }}>{item.label}</p>
    <strong className="mt-3 block text-3xl font-semibold tracking-tight text-slate-950">{item.value}</strong>
    <p className="mt-2 text-sm leading-6 text-slate-500">{item.helper}</p>
  </article>
}

function StatusPill({ label, type = 'booking' }: { label: string; type?: 'booking' | 'payment' | 'sync' }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold capitalize ${badgeClass(label, type)}`}>{formatLabel(label)}</span>
}

export default function BookingsReport() {
  const { storeId } = useActiveStore()
  const [rootBookings, setRootBookings] = useState<BookingRow[]>([])
  const [storeBookings, setStoreBookings] = useState<BookingRow[]>([])
  const [status, setStatus] = useState('all')
  const [source, setSource] = useState('all')
  const [sync, setSync] = useState('all')
  const [range, setRange] = useState('all')
  const [search, setSearch] = useState('')
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deletingIds, setDeletingIds] = useState<string[]>([])
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) { setRootBookings([]); setStoreBookings([]); setSelectedIds([]); setDeletingIds([]); return undefined }
    const unsubRoot = onSnapshot(query(collection(db, 'integrationBookings'), where('storeId', '==', storeId)), snapshot => {
      setRootBookings(snapshot.docs.map(docSnap => mapBooking(docSnap.id, docSnap.data() as Record<string, unknown>, 'root')))
    })
    const unsubStore = onSnapshot(collection(db, 'stores', storeId, 'integrationBookings'), snapshot => {
      setStoreBookings(snapshot.docs.map(docSnap => mapBooking(docSnap.id, docSnap.data() as Record<string, unknown>, 'store')))
    })
    return () => { unsubRoot(); unsubStore() }
  }, [storeId])

  const bookings = useMemo(() => {
    const merged = new Map<string, BookingRow>()
    ;[...rootBookings, ...storeBookings].forEach(row => {
      const key = canonicalBookingOrderKey({ booking_id: row.bookingId, payment_reference: row.reference }, row.id)
      const existing = merged.get(key)
      merged.set(key, existing ? chooseMoreCompleteRecord(existing, { ...existing, ...row, sourcePath: row.sourcePath }) : row)
    })
    return Array.from(merged.values()).sort((a, b) => ((b.updatedAt ?? b.createdAt)?.getTime() ?? 0) - ((a.updatedAt ?? a.createdAt)?.getTime() ?? 0))
  }, [rootBookings, storeBookings])

  const filtered = useMemo(() => bookings.filter(booking => {
    const queryText = search.trim().toLowerCase()
    const searchOk = !queryText || [booking.reference, booking.serviceName, booking.customerName, booking.customerPhone, booking.sourceLabel, booking.bookingDate, booking.paymentStatus, booking.bookingStatus].some(value => value.toLowerCase().includes(queryText))
    return searchOk && (status === 'all' || booking.bookingStatus === status || booking.paymentStatus === status) && (source === 'all' || booking.sourceChannel === source) && (sync === 'all' || booking.syncStatus === sync) && inDateRange(booking.createdAt, range)
  }), [bookings, range, search, source, status, sync])

  useEffect(() => { setPage(1) }, [range, rowsPerPage, search, source, status, sync])
  useEffect(() => { setSelectedIds(current => current.filter(id => filtered.some(booking => booking.id === id))) }, [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage))
  const safePage = Math.min(page, totalPages)

  useEffect(() => {
    setPage(current => Math.min(current, totalPages))
  }, [totalPages])

  const pageRows = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage)
  const firstRow = filtered.length ? (safePage - 1) * rowsPerPage + 1 : 0
  const lastRow = Math.min(safePage * rowsPerPage, filtered.length)

  async function deleteBookingRecords(booking: BookingRow) {
    if (!storeId) return
    await Promise.all([deleteDoc(doc(db, 'stores', storeId, 'integrationBookings', booking.id)), deleteDoc(doc(db, 'integrationBookings', booking.id))])
  }

  async function deleteOneBooking(booking: BookingRow) {
    if (!window.confirm(`Delete ${booking.serviceName || booking.reference || 'this booking'}? This cannot be undone.`)) return
    setDeletingIds(current => Array.from(new Set([...current, booking.id])))
    setSuccessMessage(null); setErrorMessage(null)
    try { await deleteBookingRecords(booking); setSelectedIds(current => current.filter(id => id !== booking.id)); setSuccessMessage('Booking deleted successfully.') }
    catch (error) { console.error(error); setErrorMessage('Unable to delete booking right now. Please try again.') }
    finally { setDeletingIds(current => current.filter(id => id !== booking.id)) }
  }

  async function deleteSelectedBookings() {
    const selected = filtered.filter(booking => selectedIds.includes(booking.id))
    if (!selected.length || !window.confirm(`Delete ${selected.length} selected booking${selected.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    setDeletingIds(current => Array.from(new Set([...current, ...selected.map(booking => booking.id)])))
    setSuccessMessage(null); setErrorMessage(null)
    try { await Promise.all(selected.map(deleteBookingRecords)); setSelectedIds([]); setSuccessMessage(`${selected.length} booking${selected.length === 1 ? '' : 's'} deleted successfully.`) }
    catch (error) { console.error(error); setErrorMessage('Unable to delete selected bookings right now. Please try again.') }
    finally { setDeletingIds(current => current.filter(id => !selected.some(booking => booking.id === id))) }
  }

  const totals = useMemo(() => ({
    count: filtered.length,
    pending: filtered.filter(booking => booking.paymentStatus.includes('pending') || booking.bookingStatus.includes('pending')).length,
    confirmed: filtered.filter(booking => booking.bookingStatus === 'confirmed').length,
    cancelled: filtered.filter(booking => booking.bookingStatus === 'cancelled').length,
    completed: filtered.filter(booking => booking.bookingStatus === 'completed').length,
    syncPending: filtered.filter(booking => booking.syncStatus === 'pending').length,
    value: filtered.reduce((sum, booking) => sum + booking.amount, 0),
    received: filtered.reduce((sum, booking) => sum + booking.amountReceived, 0),
  }), [filtered])

  const summaryCards: SummaryCard[] = [
    { label: 'Total bookings', value: totals.count, helper: 'Bookings in the selected range', tone: '#4f46e5' },
    { label: 'Confirmed', value: totals.confirmed, helper: 'Approved booking records', tone: '#16a34a' },
    { label: 'Sync pending', value: totals.syncPending, helper: 'Waiting for App Script sync', tone: '#a855f7' },
    { label: 'Booking value', value: formatMoney(totals.value), helper: 'Value from filtered rows', tone: '#0f766e' },
    { label: 'Pending', value: totals.pending, helper: 'Needs payment or confirmation review', tone: '#f97316' },
    { label: 'Received', value: formatMoney(totals.received), helper: 'Revenue already received', tone: '#059669' },
    { label: 'Cancelled', value: totals.cancelled, helper: 'Cancelled booking records', tone: '#ef4444' },
    { label: 'Completed', value: totals.completed, helper: 'Finished booking records', tone: '#2563eb' },
  ]

  function exportRows() {
    downloadCsv('sedifex-bookings-report.csv', filtered.map(booking => ({ reference: booking.reference, serviceName: booking.serviceName, recordType: booking.recordType, customer: booking.customerName, contact: booking.customerPhone, source: booking.sourceLabel, sourcePath: booking.sourcePath, bookingDate: booking.bookingDate, bookingTime: booking.bookingTime, paymentStatus: booking.paymentStatus, bookingStatus: booking.bookingStatus, syncStatus: booking.syncStatus, syncReason: booking.syncReason, reminderStatus: booking.reminderStatus, confirmedAt: formatDate(booking.confirmedAt), cancelledAt: formatDate(booking.cancelledAt), completedAt: formatDate(booking.completedAt), amount: booking.amount, amountReceived: booking.amountReceived, amountOutstanding: booking.amountOutstanding, createdAt: formatDate(booking.createdAt) })))
  }

  function exportPdf() {
    exportReportPdf({ title: 'Bookings report', subtitle: 'Service, class, appointment, and website bookings with payment, source, sync, and reminder status.', summary: [{ label: 'Total bookings', value: totals.count }, { label: 'Confirmed', value: totals.confirmed }, { label: 'Sync pending', value: totals.syncPending }, { label: 'Booking value', value: formatMoney(totals.value) }], rows: filtered.map(booking => ({ reference: booking.reference, serviceName: `${booking.serviceName} (${booking.recordType})`, customer: booking.customerName, source: booking.sourceLabel, bookingDate: booking.bookingDate, bookingTime: booking.bookingTime, paymentStatus: booking.paymentStatus, bookingStatus: booking.bookingStatus, syncStatus: booking.syncStatus, reminderStatus: booking.reminderStatus, amount: booking.amount, amountReceived: booking.amountReceived, amountOutstanding: booking.amountOutstanding, createdAt: formatDate(booking.createdAt) })) })
  }

  return <div className="space-y-6">
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div><p className="text-sm font-medium text-slate-500">Reports / Bookings</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">Bookings report</h1><p className="mt-4 max-w-4xl text-lg leading-8 text-slate-600">Review bookings in a compact table with payment, confirmation, source, schedule, sync, and reminder details.</p></div>
        <div className="flex flex-wrap gap-3"><button type="button" className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-50" onClick={exportPdf} disabled={!filtered.length}>Export PDF</button><button type="button" className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-sm disabled:opacity-50" onClick={exportRows} disabled={!filtered.length}>Export CSV</button></div>
      </div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{summaryCards.map(item => <SummaryMetric key={item.label} item={item} />)}</section>

    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-2xl font-semibold tracking-tight text-slate-950">Booking details</h2><p className="mt-2 text-sm leading-6 text-slate-500">Use the filters and search, then review all records in the table below.</p></div><span className="w-fit rounded-full bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700">{filtered.length} showing</span></div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block text-sm font-semibold text-slate-700">Date range<select className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3" value={range} onChange={event => setRange(event.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="month">This month</option><option value="last_month">Last month</option><option value="all">All time</option></select></label>
        <label className="block text-sm font-semibold text-slate-700">Source<select className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3" value={source} onChange={event => setSource(event.target.value)}><option value="all">All sources</option><option value="sedifex_market">Sedifex Market</option><option value="client_website">Client website</option><option value="sedifex_custom_page">Sedifex public page</option><option value="manual_admin">Manual/admin</option></select></label>
        <label className="block text-sm font-semibold text-slate-700">Status<select className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option></select></label>
        <label className="block text-sm font-semibold text-slate-700">Sync state<select className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3" value={sync} onChange={event => setSync(event.target.value)}><option value="all">All sync states</option><option value="pending">Sync pending</option><option value="synced">Synced</option><option value="not_ready">Not ready / not configured</option></select></label>
      </div>

      <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <input className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 lg:max-w-xl" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reference, service, customer, phone, source or status…" />
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">Rows per page<select className="rounded-xl border border-slate-300 bg-white px-3 py-2" value={rowsPerPage} onChange={event => setRowsPerPage(Number(event.target.value))}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"><span className="text-sm font-bold text-slate-700">{selectedIds.length} selected</span><button type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50" onClick={() => setSelectedIds(pageRows.map(booking => booking.id))} disabled={!pageRows.length}>Select page</button><button type="button" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold disabled:opacity-50" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>Clear selection</button><button type="button" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-50" onClick={() => void deleteSelectedBookings()} disabled={!selectedIds.length || deletingIds.length > 0}>{deletingIds.length ? 'Deleting…' : 'Delete selected'}</button></div>
      {successMessage ? <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{successMessage}</p> : null}
      {errorMessage ? <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{errorMessage}</p> : null}

      <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600"><tr><th className="px-4 py-3"><input type="checkbox" aria-label="Select all rows on this page" checked={pageRows.length > 0 && pageRows.every(row => selectedIds.includes(row.id))} onChange={event => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...pageRows.map(row => row.id)])) : selectedIds.filter(id => !pageRows.some(row => row.id === id)))} /></th><th className="px-4 py-3">Booking</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Sync / reminder</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-200 bg-white">{pageRows.map(booking => <tr key={booking.id} className="align-top hover:bg-slate-50"><td className="px-4 py-4"><input type="checkbox" checked={selectedIds.includes(booking.id)} onChange={event => setSelectedIds(current => event.target.checked ? Array.from(new Set([...current, booking.id])) : current.filter(id => id !== booking.id))} /></td><td className="px-4 py-4"><strong className="block max-w-[220px] text-slate-950">{booking.serviceName}</strong><span className="mt-1 block text-xs capitalize text-slate-500">{formatLabel(booking.recordType)}</span><span className="mt-2 block max-w-[220px] break-all font-mono text-xs text-slate-500">{booking.reference}</span></td><td className="px-4 py-4"><strong className="block text-slate-950">{booking.customerName}</strong><span className="mt-1 block max-w-[170px] break-all text-xs text-slate-500">{booking.customerPhone || 'No contact'}</span></td><td className="px-4 py-4"><strong className="block text-slate-950">{booking.bookingDate}</strong><span className="mt-1 block text-xs text-slate-500">{booking.bookingTime}</span>{booking.slotStartAt !== '—' ? <span className="mt-1 block max-w-[180px] text-xs font-semibold text-indigo-700">Slot: {booking.slotStartAt}{booking.slotEndAt !== '—' ? ` – ${booking.slotEndAt}` : ''}</span> : null}<span className="mt-1 block max-w-[150px] text-xs text-slate-400">Created {formatDate(booking.createdAt)}</span></td><td className="px-4 py-4"><span className="inline-flex rounded-full bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700">{booking.sourceLabel}</span><span className="mt-2 block text-xs capitalize text-slate-500">{booking.sourcePath} record</span></td><td className="px-4 py-4"><strong className="block text-slate-950">{formatMoney(booking.amount)}</strong><span className="mt-1 block text-xs text-emerald-700">Received {formatMoney(booking.amountReceived)}</span><span className="mt-1 block text-xs text-slate-500">Balance {formatMoney(booking.amountOutstanding)}</span></td><td className="px-4 py-4"><div className="flex max-w-[170px] flex-wrap gap-1"><StatusPill label={booking.bookingStatus} /><StatusPill label={booking.paymentStatus} type="payment" /></div></td><td className="px-4 py-4"><StatusPill label={booking.syncStatus} type="sync" /><span className="mt-2 block max-w-[180px] text-xs text-slate-500">Reminder: {booking.reminderStatus}</span><span className="mt-1 block max-w-[180px] text-xs text-slate-400">{booking.syncReason}</span></td><td className="px-4 py-4"><div className="flex flex-col gap-2"><Link className="rounded-xl bg-slate-950 px-3 py-2 text-center text-xs font-bold text-white" to={`/bookings/${booking.id}`}>Open</Link><button type="button" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50" onClick={() => void deleteOneBooking(booking)} disabled={deletingIds.includes(booking.id)}>{deletingIds.includes(booking.id) ? 'Deleting…' : 'Delete'}</button></div></td></tr>)}</tbody>
        </table>
        {!pageRows.length ? <div className="p-10 text-center"><h3 className="text-xl font-semibold text-slate-950">No booking records found</h3><p className="mt-2 text-slate-500">Change the date range, search, or filters to see more records.</p></div> : null}
      </div>

      <div className="mt-4 flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>Showing {firstRow}–{lastRow} of {filtered.length} rows</span><div className="flex gap-2"><button type="button" className="rounded-xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700 disabled:opacity-40" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>Prev</button><span className="rounded-xl bg-slate-100 px-4 py-2 font-semibold text-slate-700">Page {safePage} of {totalPages}</span><button type="button" className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-40" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>Next</button></div></div>
    </section>
  </div>
}
