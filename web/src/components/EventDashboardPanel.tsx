import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { buildEventPortfolioRows, eventStatusLabel, type EventPortfolioSource } from '../lib/eventPortfolio'

function money(value: number) {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(value)
}

function formatDate(value: Date | null) {
  return value ? value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not set'
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

export default function EventDashboardPanel() {
  const { storeId } = useActiveStore()
  const [events, setEvents] = useState<EventPortfolioSource[]>([])
  const [invoices, setInvoices] = useState<EventPortfolioSource[]>([])
  const [receipts, setReceipts] = useState<EventPortfolioSource[]>([])
  const [expenses, setExpenses] = useState<EventPortfolioSource[]>([])

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

  const rows = useMemo(() => buildEventPortfolioRows(events, invoices, receipts, expenses), [events, expenses, invoices, receipts])
  const activeRows = useMemo(() => rows.filter(row => !['completed', 'cancelled'].includes(row.status)), [rows])

  const stats = useMemo(() => {
    const today = startOfToday()
    const sevenDays = new Date(today)
    sevenDays.setDate(sevenDays.getDate() + 7)
    const upcoming = activeRows.filter(row => row.eventDate && row.eventDate >= today && row.eventDate <= sevenDays)
    const averageReadiness = activeRows.length
      ? Math.round(activeRows.reduce((sum, row) => sum + row.progress, 0) / activeRows.length)
      : 0
    return {
      active: activeRows.length,
      upcoming: upcoming.length,
      readiness: averageReadiness,
      awaitingClient: activeRows.filter(row => row.status === 'awaiting_client' || ['sent', 'changes_requested'].includes(row.contractStatus)).length,
      clientBalance: activeRows.reduce((sum, row) => sum + (row.clientBalance || 0), 0),
      vendorOutstanding: activeRows.reduce((sum, row) => sum + row.vendorOutstanding, 0),
      expectedProfit: activeRows.reduce((sum, row) => sum + (row.expectedProfit || 0), 0),
    }
  }, [activeRows])

  const attentionRows = useMemo(() => {
    const today = startOfToday()
    return activeRows
      .filter(row => row.status === 'awaiting_client'
        || ['sent', 'changes_requested'].includes(row.contractStatus)
        || row.openChecklistTasks > 0
        || (row.eventDate && row.eventDate >= today && row.progress < 70))
      .slice(0, 6)
  }, [activeRows])

  return (
    <>
      <section className="dashboard-panel" aria-label="Event portfolio overview">
        <div className="dashboard-panel__header">
          <div>
            <h2>Event portfolio</h2>
            <p>Live operational and financial signals from Event Management, invoices, receipts, expenses and vendor commitments.</p>
          </div>
          <div className="dashboard-panel__actions">
            <Link className="button button--secondary" to="/reports#event-performance-report">Event report</Link>
            <Link className="button button--primary" to="/event-planning">Manage events</Link>
          </div>
        </div>
        <div className="dashboard-kpi-grid dashboard-kpi-grid--clean">
          <article className="dashboard-kpi-card dashboard-kpi-card--clean"><p className="dashboard-kpi-card__badge">Events</p><h2 className="dashboard-kpi-card__value">{stats.active}</h2><p className="dashboard-kpi-card__label">Active events</p><p className="dashboard-kpi-card__hint">Excludes completed and cancelled events</p></article>
          <article className="dashboard-kpi-card dashboard-kpi-card--clean"><p className="dashboard-kpi-card__badge">Events</p><h2 className="dashboard-kpi-card__value">{stats.upcoming}</h2><p className="dashboard-kpi-card__label">Next 7 days</p><p className="dashboard-kpi-card__hint">Upcoming active events</p></article>
          <article className="dashboard-kpi-card dashboard-kpi-card--clean"><p className="dashboard-kpi-card__badge">Readiness</p><h2 className="dashboard-kpi-card__value">{stats.readiness}%</h2><p className="dashboard-kpi-card__label">Average readiness</p><p className="dashboard-kpi-card__hint">Average planning progress across active events</p></article>
          <article className="dashboard-kpi-card dashboard-kpi-card--clean"><p className="dashboard-kpi-card__badge">Client</p><h2 className="dashboard-kpi-card__value">{stats.awaitingClient}</h2><p className="dashboard-kpi-card__label">Awaiting client</p><p className="dashboard-kpi-card__hint">Event status or contract action needs the client</p></article>
          <article className="dashboard-kpi-card dashboard-kpi-card--clean"><p className="dashboard-kpi-card__badge">Finance</p><h2 className="dashboard-kpi-card__value">{money(stats.clientBalance)}</h2><p className="dashboard-kpi-card__label">Client balance</p><p className="dashboard-kpi-card__hint">Contract value less linked receipts</p></article>
          <article className="dashboard-kpi-card dashboard-kpi-card--clean"><p className="dashboard-kpi-card__badge">Vendors</p><h2 className="dashboard-kpi-card__value">{money(stats.vendorOutstanding)}</h2><p className="dashboard-kpi-card__label">Vendor outstanding</p><p className="dashboard-kpi-card__hint">Quoted vendor commitments still unpaid</p></article>
        </div>
        <p className="dashboard-empty-note">Estimated portfolio profit: <strong>{money(stats.expectedProfit)}</strong>. This follows the same event finance calculation used in Event Management.</p>
      </section>

      <section className="dashboard-panel" aria-label="Event attention list">
        <div className="dashboard-panel__header">
          <div><h2>Needs attention</h2><p>Events with client actions, open checklist work, contract follow-up or low readiness.</p></div>
        </div>
        {attentionRows.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {attentionRows.map(row => (
              <Link key={row.id} to={`/event-planning/${row.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 16, alignItems: 'center', padding: 14, border: '1px solid #e2e8f0', borderRadius: 16, color: 'inherit', textDecoration: 'none' }}>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{row.title}</strong>
                  <small style={{ color: '#667085' }}>{row.clientName} · {formatDate(row.eventDate)} · {eventStatusLabel(row.status)}</small>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <strong style={{ display: 'block' }}>{row.progress}% ready</strong>
                  <small style={{ color: '#667085' }}>{row.openChecklistTasks ? `${row.openChecklistTasks} checklist open` : row.contractStatus === 'sent' ? 'Contract awaiting signature' : 'Review event'}</small>
                </span>
              </Link>
            ))}
          </div>
        ) : <p className="dashboard-empty-note">No active event needs attention right now.</p>}
      </section>
    </>
  )
}
