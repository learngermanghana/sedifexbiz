import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../../firebase'
import { useActiveStore } from '../../hooks/useActiveStore'
import { buildEventPortfolioRows, eventPackageLabel, eventStatusLabel, type EventPortfolioRow, type EventPortfolioSource } from '../../lib/eventPortfolio'
import ReportDataTable, { type ReportColumn } from './ReportDataTable'
import { downloadCsv, exportReportPdf, formatMoney } from './reportUtils'

function reportDate(value: Date | null) {
  return value ? value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

function activeEvent(row: EventPortfolioRow) {
  return !['completed', 'cancelled'].includes(row.status)
}

function eventInRange(row: EventPortfolioRow, range: string) {
  if (range === 'all') return true
  if (!row.eventDate) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (range === 'upcoming') return row.eventDate >= today
  const end = new Date(today)
  end.setDate(end.getDate() + Number(range))
  return row.eventDate >= today && row.eventDate <= end
}

export default function EventPortfolioReport() {
  const { storeId } = useActiveStore()
  const [events, setEvents] = useState<EventPortfolioSource[]>([])
  const [invoices, setInvoices] = useState<EventPortfolioSource[]>([])
  const [receipts, setReceipts] = useState<EventPortfolioSource[]>([])
  const [expenses, setExpenses] = useState<EventPortfolioSource[]>([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [range, setRange] = useState('all')

  useEffect(() => {
    if (!storeId) {
      setEvents([])
      setInvoices([])
      setReceipts([])
      setExpenses([])
      return undefined
    }
    const unsubscribers = [
      onSnapshot(collection(db, 'stores', storeId, 'events'), snapshot => setEvents(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))),
      onSnapshot(collection(db, 'stores', storeId, 'invoices'), snapshot => setInvoices(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))),
      onSnapshot(collection(db, 'stores', storeId, 'receipts'), snapshot => setReceipts(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))),
      onSnapshot(query(collection(db, 'expenses'), where('storeId', '==', storeId)), snapshot => setExpenses(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))),
    ]
    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
  }, [storeId])

  const allRows = useMemo(() => buildEventPortfolioRows(events, invoices, receipts, expenses), [events, expenses, invoices, receipts])
  const rows = useMemo(() => allRows.filter(row => {
    if (!eventInRange(row, range)) return false
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return activeEvent(row)
    return row.status === statusFilter
  }), [allRows, range, statusFilter])

  const totals = useMemo(() => ({
    events: rows.length,
    active: rows.filter(activeEvent).length,
    contractValue: rows.reduce((sum, row) => sum + (row.contractValue || 0), 0),
    received: rows.reduce((sum, row) => sum + row.received, 0),
    clientBalance: rows.reduce((sum, row) => sum + (row.clientBalance || 0), 0),
    vendorOutstanding: rows.reduce((sum, row) => sum + row.vendorOutstanding, 0),
    expenses: rows.reduce((sum, row) => sum + row.expenses, 0),
    expectedProfit: rows.reduce((sum, row) => sum + (row.expectedProfit || 0), 0),
  }), [rows])

  const columns: ReportColumn<EventPortfolioRow>[] = [
    { key: 'date', label: 'Date', sortable: true, value: row => row.eventDate ?? undefined, render: row => reportDate(row.eventDate) },
    { key: 'event', label: 'Event', sortable: true, value: row => `${row.title} ${row.eventCode}`, render: row => <><Link to={`/event-planning/${row.id}`}><strong>{row.title}</strong></Link><br /><small>{row.eventCode} · {eventPackageLabel(row.planningPackage)}</small></> },
    { key: 'client', label: 'Client', sortable: true, value: row => row.clientName },
    { key: 'status', label: 'Status', sortable: true, value: row => eventStatusLabel(row.status), render: row => <>{eventStatusLabel(row.status)}<br /><small>{row.contractStatus === 'approved' ? 'Contract approved' : `Contract: ${row.contractStatus}`}</small></> },
    { key: 'readiness', label: 'Readiness', sortable: true, align: 'right', value: row => row.progress, render: row => <>{row.progress}%<br /><small>{row.openChecklistTasks} checklist open</small></> },
    { key: 'contract', label: 'Contract', sortable: true, align: 'right', value: row => row.contractValue, render: row => row.contractValue === null ? 'Not set' : formatMoney(row.contractValue) },
    { key: 'received', label: 'Received', sortable: true, align: 'right', value: row => row.received, render: row => formatMoney(row.received) },
    { key: 'balance', label: 'Client balance', sortable: true, align: 'right', value: row => row.clientBalance, render: row => row.clientBalance === null ? '—' : formatMoney(row.clientBalance) },
    { key: 'vendors', label: 'Vendor outstanding', sortable: true, align: 'right', value: row => row.vendorOutstanding, render: row => <>{formatMoney(row.vendorOutstanding)}<br /><small>{formatMoney(row.vendorQuoted)} quoted</small></> },
    { key: 'expenses', label: 'Expenses', sortable: true, align: 'right', value: row => row.expenses, render: row => formatMoney(row.expenses) },
    { key: 'profit', label: 'Expected profit', sortable: true, align: 'right', value: row => row.expectedProfit, render: row => row.expectedProfit === null ? '—' : formatMoney(row.expectedProfit) },
  ]

  function exportRows() {
    downloadCsv('sedifex-event-performance-financial-report.csv', rows.map(row => ({
      eventCode: row.eventCode,
      event: row.title,
      client: row.clientName,
      eventDate: reportDate(row.eventDate),
      status: eventStatusLabel(row.status),
      package: eventPackageLabel(row.planningPackage),
      guests: row.guestCount,
      readinessPercent: row.progress,
      checklistOpen: row.openChecklistTasks,
      contractStatus: row.contractStatus,
      contractValue: row.contractValue ?? '',
      invoiced: row.invoiced,
      received: row.received,
      clientBalance: row.clientBalance ?? '',
      vendorQuoted: row.vendorQuoted,
      vendorPaid: row.vendorPaid,
      vendorOutstanding: row.vendorOutstanding,
      expenses: row.expenses,
      expectedProfit: row.expectedProfit ?? '',
    })))
  }

  function exportPdf() {
    exportReportPdf({
      title: 'Event Performance & Financial Report',
      subtitle: 'Portfolio performance using Event Management, invoices, receipts, expenses and vendor commitments.',
      summary: [
        { label: 'Events', value: totals.events },
        { label: 'Contract value', value: formatMoney(totals.contractValue) },
        { label: 'Received', value: formatMoney(totals.received) },
        { label: 'Client balance', value: formatMoney(totals.clientBalance) },
        { label: 'Vendor outstanding', value: formatMoney(totals.vendorOutstanding) },
        { label: 'Expected profit', value: formatMoney(totals.expectedProfit) },
      ],
      rows: rows.map(row => ({
        event: row.title,
        client: row.clientName,
        date: reportDate(row.eventDate),
        status: eventStatusLabel(row.status),
        readiness: `${row.progress}%`,
        contract: row.contractValue === null ? 'Not set' : formatMoney(row.contractValue),
        received: formatMoney(row.received),
        balance: row.clientBalance === null ? '—' : formatMoney(row.clientBalance),
        vendorsOutstanding: formatMoney(row.vendorOutstanding),
        expenses: formatMoney(row.expenses),
        expectedProfit: row.expectedProfit === null ? '—' : formatMoney(row.expectedProfit),
      })),
    })
  }

  return (
    <section id="event-performance-report" style={{ scrollMarginTop: 24 }}>
      <div className="workspace-card">
        <p className="workspace-eyebrow">Reports / Event planning</p>
        <h1>Event Performance & Financial Report</h1>
        <p className="workspace-muted">One portfolio report built from the same event, invoice, receipt, expense and vendor records already used inside Event Management.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '16px 0' }}>
        <div className="workspace-card"><small className="workspace-muted">Events</small><h2>{totals.events}</h2><p className="workspace-muted">{totals.active} active</p></div>
        <div className="workspace-card"><small className="workspace-muted">Contract value</small><h2>{formatMoney(totals.contractValue)}</h2><p className="workspace-muted">Across filtered events</p></div>
        <div className="workspace-card"><small className="workspace-muted">Received</small><h2>{formatMoney(totals.received)}</h2><p className="workspace-muted">Linked receipts</p></div>
        <div className="workspace-card"><small className="workspace-muted">Client balance</small><h2>{formatMoney(totals.clientBalance)}</h2><p className="workspace-muted">Contract value less receipts</p></div>
        <div className="workspace-card"><small className="workspace-muted">Vendor outstanding</small><h2>{formatMoney(totals.vendorOutstanding)}</h2><p className="workspace-muted">Unpaid vendor commitments</p></div>
        <div className="workspace-card"><small className="workspace-muted">Expected profit</small><h2>{formatMoney(totals.expectedProfit)}</h2><p className="workspace-muted">Same calculation used in Event Management</p></div>
      </div>

      <ReportDataTable
        title="Event portfolio"
        subtitle="Search, sort and filter event performance without creating duplicate finance records."
        rows={rows}
        columns={columns}
        getRowKey={row => row.id}
        searchPlaceholder="Search event, client, code or status…"
        actions={<><button type="button" className="button button--secondary" onClick={exportRows}>Download CSV</button><button type="button" className="button button--primary" onClick={exportPdf}>Print / PDF</button></>}
        filters={<><label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active only</option><option value="new">New enquiry</option><option value="planning">Planning</option><option value="awaiting_client">Awaiting client</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label><label>Event date<select value={range} onChange={event => setRange(event.target.value)}><option value="all">All dates</option><option value="7">Next 7 days</option><option value="30">Next 30 days</option><option value="90">Next 90 days</option><option value="upcoming">All upcoming</option></select></label></>}
      />
    </section>
  )
}
