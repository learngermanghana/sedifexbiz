import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useActiveStore } from '../../hooks/useActiveStore'
import { useStorePreferences } from '../../hooks/useStorePreferences'
import EventPortfolioReport from './EventPortfolioReport'
import './reportsHome.css'

type ReportItem = { title: string; href: string; description: string; badge: string; inline?: boolean }
type ReportGroup = { title: string; reports: ReportItem[] }

const reportGroups: ReportGroup[] = [
  { title: 'Business data', reports: [
    { title: 'Sales & Cash Report', href: '/reports/sales-cash', description: 'Main business activity: POS, online, bookings, and manual cash records.', badge: 'Main' },
    { title: 'Settlement Report', href: '/reports/settlement', description: 'Paystack/Sedifex settlements, commission, split status, and merchant net.', badge: 'Finance' },
    { title: 'Marketplace Orders', href: '/marketplace-orders', description: 'Order operations, delivery status, and customer follow-up records.', badge: 'Orders' },
    { title: 'Inventory Report', href: '/reports/inventory', description: 'Products, services, stock levels, low-stock alerts, and value history.', badge: 'Stock' },
  ] },
  { title: 'Sales details', reports: [
    { title: 'POS Sales Report', href: '/reports/pos-sales', description: 'Detailed internal sales from the Sell/POS workflow.', badge: 'POS' },
    { title: 'Website Sales Report', href: '/reports/website-sales', description: 'Online orders from Sedifex Market and public storefront pages.', badge: 'Online' },
    { title: 'Bookings Report', href: '/reports/bookings', description: 'Service bookings, appointment status, payment status, and exports.', badge: 'Bookings' },
  ] },
  { title: 'School data', reports: [{ title: 'Student Registrations', href: '/reports/student-registrations', description: 'Admissions, enquiries, program interest, and payment progress.', badge: 'School' }] },
  { title: 'NGO data', reports: [
    { title: 'Donors Report', href: '/reports/donors', description: 'Donor profiles, giving totals, and engagement history.', badge: 'Donors' },
    { title: 'Funds Report', href: '/reports/funds', description: 'Fund ledger inflows, outflows, and balance tracking.', badge: 'Funds' },
    { title: 'Volunteers Report', href: '/reports/volunteers', description: 'Volunteer applications, skills, availability, and follow-up status.', badge: 'NGO' },
  ] },
  { title: 'Content data', reports: [{ title: 'Blog Report', href: '/reports/blog', description: 'Published and draft post history with export-ready records.', badge: 'Content' }] },
]

const eventReportGroup: ReportGroup = {
  title: 'Event planning',
  reports: [{
    title: 'Event Performance & Financial Report',
    href: '#event-performance-report',
    description: 'Portfolio readiness, client balances, vendor commitments, expenses and expected profit using the same Event Management records.',
    badge: 'Events',
    inline: true,
  }],
}

export default function ReportsHome() {
  const { storeId } = useActiveStore()
  const { preferences } = useStorePreferences(storeId)
  const isEventBusiness = preferences.navigation.industry === 'event'
  const [search, setSearch] = useState('')
  const visibleGroups = useMemo(() => isEventBusiness ? [eventReportGroup, ...reportGroups] : reportGroups, [isEventBusiness])
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return visibleGroups
    return visibleGroups
      .map(group => ({ ...group, reports: group.reports.filter(report => [report.title, report.badge, report.description].join(' ').toLowerCase().includes(term)) }))
      .filter(group => group.reports.length > 0)
  }, [search, visibleGroups])

  return (
    <div className="workspace-page reports-directory-page">
      <section className="reports-directory-header">
        <h1>Reports & data history</h1>
        <p className="workspace-muted">Open historical data, filter records, and download reports. Use Dashboard for metrics and Marketplace Orders for order follow-up.</p>
      </section>
      <section className="reports-toolbar">
        <input className="reports-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search reports..." />
      </section>

      {filteredGroups.length === 0 ? <section className="reports-section reports-empty-state">No reports match your search.</section> : null}
      {filteredGroups.map(group => (
        <section className="reports-section" key={group.title}>
          <h2 className="reports-section-title">{group.title}</h2>
          <div className="reports-list">
            {group.reports.map(report => (
              <article className="reports-row" key={report.href}>
                <div className="reports-row-main">
                  <span className="reports-badge">{report.badge}</span>
                  <strong>{report.title}</strong>
                  <p className="workspace-muted">{report.description}</p>
                </div>
                <div className="reports-row-action">
                  {report.inline
                    ? <a href={report.href} className="button button--primary">Open report</a>
                    : <Link to={report.href} className="button button--primary">Open report</Link>}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {isEventBusiness ? <EventPortfolioReport /> : null}
    </div>
  )
}
