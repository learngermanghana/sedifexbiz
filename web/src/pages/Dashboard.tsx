// web/src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useStorePreferences } from '../hooks/useStorePreferences'
import type { Industry } from '../config/navigation'
import './Dashboard.css'

type MetricGroup = 'sales' | 'inventory' | 'orders' | 'customers' | 'content' | 'ngo' | 'school'

type Metric = {
  id: string
  label: string
  value: string
  hint: string
  tone: string
  group: MetricGroup
  moduleIds: string[]
  industries?: Industry[]
  priority: number
  highlight?: boolean
}

type QuickAction = {
  id: string
  label: string
  hint: string
  to: string
  moduleIds: string[]
  industries?: Industry[]
}

type LowStockItem = {
  id: string
  name: string
  sku: string
  stock: number
  reorderPoint: number
}

const DEFAULT_KPI_IDS_BY_INDUSTRY: Record<Industry, string[]> = {
  shop: ['inventory', 'online-orders', 'online-value', 'internal-sales', 'pending-delivery', 'manual-payments'],
  travel: ['bookings', 'confirmed-bookings', 'paid-bookings', 'booking-value', 'customers', 'manual-payments'],
  ngo: ['donors', 'donor-lifetime-giving', 'volunteers', 'support-requests', 'all-products', 'blog-posts'],
  school: ['student-registrations', 'active-students', 'paid-students', 'pending-students', 'bookings', 'all-products'],
}

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { id: 'add-item', label: 'Add item', hint: 'Create product, service, or course', to: '/products', moduleIds: ['products'] },
  { id: 'record-sale', label: 'Record sale', hint: 'Open POS and sell quickly', to: '/sell', moduleIds: ['sell'], industries: ['shop'] },
  { id: 'orders', label: 'Review orders', hint: 'Open website and marketplace orders', to: '/online-orders', moduleIds: ['online-orders', 'marketplace-orders'] },
  { id: 'bookings', label: 'Add booking', hint: 'Create or review appointments/classes', to: '/bookings', moduleIds: ['bookings'], industries: ['shop', 'travel', 'school'] },
  { id: 'student-registration', label: 'Register student', hint: 'Review applications and print IDs', to: '/student-registration', moduleIds: ['student-registration'], industries: ['school'] },
  { id: 'students', label: 'Students', hint: 'Open confirmed student records', to: '/students', moduleIds: ['students'], industries: ['school'] },
  { id: 'sms', label: 'Send SMS', hint: 'Broadcast to customers or students', to: '/bulk-messaging', moduleIds: ['bulk-messaging'] },
  { id: 'reports', label: 'Reports', hint: 'Open deeper exports and history', to: '/reports', moduleIds: ['reports'] },
]

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
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

function isToday(value: unknown) {
  const date = toDate(value)
  if (!date) return false
  const now = new Date()
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

function formatMoney(value: number, currency = 'GHS') {
  return `${currency} ${value.toFixed(2)}`
}

function normalizeSourceChannel(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_') : ''
  if (normalized.includes('website') || normalized.includes('client') || normalized.includes('wordpress')) return 'client_website'
  if (normalized.includes('market')) return 'sedifex_market'
  if (normalized.includes('custom') || normalized.includes('public')) return 'sedifex_custom_page'
  return normalized || 'sedifex_market'
}

function normalizedStatus(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '_') : ''
}

function normalizeSelectedKpis(value: unknown, availableIds: string[], fallbackIds: string[]) {
  if (!Array.isArray(value)) return fallbackIds.filter(id => availableIds.includes(id))
  const cleaned = value.filter((item): item is string => typeof item === 'string' && availableIds.includes(item))
  return cleaned.length > 0 ? cleaned : fallbackIds.filter(id => availableIds.includes(id))
}

function groupLabel(group: MetricGroup) {
  const labels: Record<MetricGroup, string> = {
    sales: 'Sales', inventory: 'Inventory', orders: 'Orders', customers: 'Customers', content: 'Content', ngo: 'NGO', school: 'School',
  }
  return labels[group]
}

function dashboardIntro(industry: Industry) {
  const copy: Record<Industry, { eyebrow: string; title: string; subtitle: string }> = {
    shop: { eyebrow: 'Business overview', title: 'Quick business overview', subtitle: 'A clean KPI board for daily decisions. Orders, sales, inventory, and alerts stay visible while deeper exports stay inside Reports.' },
    travel: { eyebrow: 'Service overview', title: 'Booking and client overview', subtitle: 'Track bookings, paid requests, pending verification, and client follow-up without mixing in unrelated modules.' },
    ngo: { eyebrow: 'Impact overview', title: 'Donor and volunteer overview', subtitle: 'See donor activity, volunteer requests, campaign records, and important follow-ups in one clean workspace.' },
    school: { eyebrow: 'School overview', title: 'Student and admissions overview', subtitle: 'Monitor registrations, confirmed students, payment follow-ups, classes, and school records from one focused dashboard.' },
  }
  return copy[industry]
}

function kpiStyle(tone: string) {
  return { '--dashboard-kpi-tone': tone } as React.CSSProperties
}

function metricIsAllowed(metric: Metric, industry: Industry, enabledModules: Set<string>) {
  if (metric.industries && !metric.industries.includes(industry)) return false
  return metric.moduleIds.length === 0 || metric.moduleIds.some(moduleId => enabledModules.has(moduleId))
}

function actionIsAllowed(action: QuickAction, industry: Industry, enabledModules: Set<string>) {
  if (action.industries && !action.industries.includes(industry)) return false
  return action.moduleIds.some(moduleId => enabledModules.has(moduleId))
}

export default function Dashboard() {
  const { storeId } = useActiveStore()
  const { preferences } = useStorePreferences(storeId)
  const industry = preferences.navigation.industry
  const enabledModuleIds = preferences.navigation.enabledModules
  const enabledModules = useMemo(() => new Set(enabledModuleIds), [enabledModuleIds])
  const [products, setProducts] = useState<Array<Record<string, unknown>>>([])
  const [sales, setSales] = useState<Array<Record<string, unknown>>>([])
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([])
  const [bookings, setBookings] = useState<Array<Record<string, unknown>>>([])
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([])
  const [volunteers, setVolunteers] = useState<Array<Record<string, unknown>>>([])
  const [donors, setDonors] = useState<Array<Record<string, unknown>>>([])
  const [registrations, setRegistrations] = useState<Array<Record<string, unknown>>>([])
  const [blogPosts, setBlogPosts] = useState<Array<Record<string, unknown>>>([])
  const [customers, setCustomers] = useState<Array<Record<string, unknown>>>([])
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>(DEFAULT_KPI_IDS_BY_INDUSTRY.shop)
  const [isCustomizing, setIsCustomizing] = useState(false)
  const [isSavingKpis, setIsSavingKpis] = useState(false)
  const [kpiMessage, setKpiMessage] = useState('')

  useEffect(() => {
    if (!storeId) {
      setProducts([]); setSales([]); setOrders([]); setBookings([]); setStudents([]); setVolunteers([]); setDonors([]); setRegistrations([]); setBlogPosts([]); setCustomers([])
      return undefined
    }
    const unsubscribers = [
      onSnapshot(query(collection(db, 'products'), where('storeId', '==', storeId)), snapshot => setProducts(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'sales'), where('storeId', '==', storeId)), snapshot => setSales(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'integrationOrders'), where('storeId', '==', storeId)), snapshot => setOrders(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'integrationBookings'), where('storeId', '==', storeId)), snapshot => setBookings(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'students'), where('storeId', '==', storeId)), snapshot => setStudents(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'volunteer_applications'), where('storeId', '==', storeId)), snapshot => setVolunteers(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'donor_profiles'), where('storeId', '==', storeId)), snapshot => setDonors(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'student_registrations'), where('storeId', '==', storeId)), snapshot => setRegistrations(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'blogPosts'), where('storeId', '==', storeId)), snapshot => setBlogPosts(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
      onSnapshot(query(collection(db, 'customers'), where('storeId', '==', storeId)), snapshot => setCustomers(snapshot.docs.map(itemDoc => ({ id: itemDoc.id, ...itemDoc.data() })))),
    ]
    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
  }, [storeId])

  const todaySales = sales.filter(item => item.status !== 'voided' && isToday(item.createdAt))
  const todayOrders = orders.filter(item => isToday(item.createdAtServer ?? item.createdAt))
  const todayBookings = bookings.filter(item => isToday(item.createdAtServer ?? item.createdAt))
  const todayVolunteers = volunteers.filter(item => isToday(item.createdAtServer ?? item.createdAt))
  const todayDonors = donors.filter(item => isToday(item.createdAtServer ?? item.createdAt))
  const todayRegistrations = registrations.filter(item => isToday(item.createdAtServer ?? item.createdAt))
  const todayStudents = students.filter(item => isToday(item.createdAtServer ?? item.createdAt))
  const todayBlogPosts = blogPosts.filter(item => isToday(item.createdAtServer ?? item.createdAt))

  const inventory = useMemo(() => {
    const inventoryItems = products.filter(item => item.itemType === 'product')
    const totalStock = inventoryItems.reduce((sum, item) => sum + asNumber(item.stockCount, 0), 0)
    const stockValue = inventoryItems.reduce((sum, item) => sum + asNumber(item.stockCount, 0) * asNumber(item.price, 0), 0)
    const lowStockItems: LowStockItem[] = inventoryItems
      .map(item => ({
        id: asText(item.id),
        name: asText(item.name ?? item.productName ?? item.title, 'Unnamed product'),
        sku: asText(item.sku ?? item.barcode),
        stock: asNumber(item.stockCount, 0),
        reorderPoint: asNumber(item.reorderPoint, 0),
      }))
      .filter(item => item.stock <= 0 || (item.reorderPoint > 0 && item.stock <= item.reorderPoint))
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
    return { inventoryItems, totalStock, stockValue, lowStockItems, lowStock: lowStockItems.length }
  }, [products])

  const stockAlertHint = inventory.lowStockItems.length
    ? `${inventory.lowStockItems.slice(0, 3).map(item => `${item.name} (${item.stock})`).join(' · ')}${inventory.lowStockItems.length > 3 ? ` · +${inventory.lowStockItems.length - 3} more` : ''}`
    : 'No low-stock products'

  const onlineRevenueToday = todayOrders.reduce((sum, item) => asNumber(item.amountMinor, 0) > 0 ? sum + asNumber(item.amountMinor, 0) / 100 : sum + asNumber(item.amount ?? item.total, 0), 0)
  const bookingRevenueToday = todayBookings.reduce((sum, item) => sum + asNumber(item.paymentAmount ?? item.amount ?? item.total, 0), 0)
  const donorLifetimeGiving = donors.reduce((sum, item) => sum + asNumber(item.lifetimeGiving, 0), 0)
  const websiteOrdersToday = todayOrders.filter(item => normalizeSourceChannel(item.sourceChannel ?? item.source_channel ?? item.source) === 'client_website').length
  const marketOrdersToday = todayOrders.filter(item => normalizeSourceChannel(item.sourceChannel ?? item.source_channel ?? item.source) === 'sedifex_market').length
  const pendingDeliveryOrders = orders.filter(item => normalizedStatus(item.orderStatus ?? item.order_status).includes('delivery')).length
  const pendingManualPayments = [...orders, ...bookings].filter(item => normalizedStatus(item.paymentStatus ?? item.payment_status).includes('manual')).length
  const pendingBookings = bookings.filter(item => ['pending', 'pending_approval', 'manual_review'].includes(normalizedStatus(item.bookingStatus ?? item.status))).length
  const confirmedBookings = bookings.filter(item => ['confirmed', 'paid'].includes(normalizedStatus(item.bookingStatus ?? item.status))).length
  const completedBookings = bookings.filter(item => normalizedStatus(item.bookingStatus ?? item.status) === 'completed').length
  const activeStudents = students.filter(item => ['active', 'confirmed'].includes(normalizedStatus(item.studentStatus ?? item.status))).length
  const paidStudents = students.filter(item => ['paid', 'success', 'confirmed', 'captured'].includes(normalizedStatus(item.paymentStatus ?? (item.payment as Record<string, unknown> | undefined)?.status))).length
  const pendingStudents = students.filter(item => ['pending', 'new', 'manual_review'].includes(normalizedStatus(item.studentStatus ?? item.status))).length

  const allMetrics: Metric[] = [
    { id: 'inventory', label: 'Total inventory', value: String(inventory.totalStock), hint: `${inventory.inventoryItems.length} stock-tracked items · ${formatMoney(inventory.stockValue)} estimated value`, tone: '#4f46e5', group: 'inventory', moduleIds: ['products'], priority: 10, industries: ['shop'] },
    { id: 'stock-alerts', label: 'Stock alerts', value: String(inventory.lowStock), hint: stockAlertHint, tone: '#ef4444', group: 'inventory', moduleIds: ['products'], priority: 70, industries: ['shop'] },
    { id: 'internal-sales', label: 'Internal sales today', value: String(todaySales.length), hint: 'Recorded in Sell (POS)', tone: '#0f766e', group: 'sales', moduleIds: ['sell'], priority: 40, industries: ['shop'] },
    { id: 'online-orders', label: 'Online orders today', value: String(todayOrders.length), hint: `${websiteOrdersToday} website · ${marketOrdersToday} marketplace`, tone: '#2563eb', group: 'orders', moduleIds: ['online-orders', 'marketplace-orders'], priority: 20 },
    { id: 'online-value', label: 'Online order value today', value: formatMoney(onlineRevenueToday), hint: 'From connected websites and Sedifex Market', tone: '#2563eb', group: 'orders', moduleIds: ['online-orders', 'marketplace-orders'], priority: 30, highlight: true },
    { id: 'pending-delivery', label: 'Pending delivery', value: String(pendingDeliveryOrders), hint: 'Orders waiting for delivery/action', tone: '#f59e0b', group: 'orders', moduleIds: ['online-orders', 'marketplace-orders'], priority: 50, industries: ['shop'] },
    { id: 'manual-payments', label: 'Manual payment pending', value: String(pendingManualPayments), hint: 'Orders/bookings waiting for manual verification', tone: '#f59e0b', group: 'orders', moduleIds: ['online-orders', 'marketplace-orders', 'bookings'], priority: 60 },
    { id: 'bookings', label: industry === 'school' ? 'Classes/bookings today' : 'Bookings today', value: String(todayBookings.length), hint: 'New booking entries', tone: '#d97706', group: 'orders', moduleIds: ['bookings'], priority: 15, industries: ['shop', 'travel', 'school'] },
    { id: 'pending-bookings', label: 'Pending bookings', value: String(pendingBookings), hint: 'Need confirmation or follow-up', tone: '#f97316', group: 'orders', moduleIds: ['bookings'], priority: 35, industries: ['travel', 'school', 'shop'] },
    { id: 'confirmed-bookings', label: 'Confirmed bookings', value: String(confirmedBookings), hint: `${completedBookings} completed bookings`, tone: '#059669', group: 'orders', moduleIds: ['bookings'], priority: 45, industries: ['travel', 'school', 'shop'] },
    { id: 'paid-bookings', label: 'Paid bookings', value: String(bookings.filter(item => normalizedStatus(item.paymentStatus ?? (item.payment as Record<string, unknown> | undefined)?.status) === 'paid').length), hint: 'Bookings with confirmed payment', tone: '#0f766e', group: 'orders', moduleIds: ['bookings'], priority: 55, industries: ['travel', 'school', 'shop'] },
    { id: 'booking-value', label: 'Booking value today', value: formatMoney(bookingRevenueToday), hint: 'From bookings created today', tone: '#0f766e', group: 'orders', moduleIds: ['bookings'], priority: 65, industries: ['travel', 'school', 'shop'] },
    { id: 'all-orders', label: 'All online orders', value: String(orders.length), hint: 'Full history for this workspace', tone: '#1d4ed8', group: 'orders', moduleIds: ['online-orders', 'marketplace-orders'], priority: 80 },
    { id: 'all-products', label: industry === 'school' ? 'Course/catalog records' : 'Catalog records', value: String(products.length), hint: 'Products, services, courses, and made-to-order records', tone: '#9333ea', group: 'inventory', moduleIds: ['products'], priority: 75 },
    { id: 'customers', label: industry === 'school' ? 'Contacts' : 'Customer records', value: String(customers.length), hint: 'People saved in the CRM/contact list', tone: '#0ea5e9', group: 'customers', moduleIds: ['customers'], priority: 90 },
    { id: 'donors', label: 'New donors today', value: String(todayDonors.length), hint: `${donors.length} donor profiles total`, tone: '#16a34a', group: 'ngo', moduleIds: ['donor-management'], priority: 10, industries: ['ngo'] },
    { id: 'donor-lifetime-giving', label: 'Donor lifetime giving', value: formatMoney(donorLifetimeGiving), hint: 'From donor profiles', tone: '#15803d', group: 'ngo', moduleIds: ['donor-management'], priority: 20, industries: ['ngo'], highlight: true },
    { id: 'volunteers', label: 'Volunteers today', value: String(todayVolunteers.length), hint: 'New volunteer applications', tone: '#7c3aed', group: 'ngo', moduleIds: ['volunteers'], priority: 30, industries: ['ngo'] },
    { id: 'support-requests', label: 'Support requests', value: '0', hint: 'Requests from support/campaign pages', tone: '#0891b2', group: 'ngo', moduleIds: ['support-requests'], priority: 40, industries: ['ngo'] },
    { id: 'student-registrations', label: 'Incoming registrations today', value: String(todayRegistrations.length), hint: `${registrations.length} total registration records`, tone: '#db2777', group: 'school', moduleIds: ['student-registration'], priority: 10, industries: ['school'] },
    { id: 'active-students', label: 'Active students', value: String(activeStudents), hint: `${students.length} saved student records`, tone: '#4f46e5', group: 'school', moduleIds: ['students'], priority: 20, industries: ['school'] },
    { id: 'paid-students', label: 'Paid students', value: String(paidStudents), hint: 'Student records with paid/confirmed payment', tone: '#059669', group: 'school', moduleIds: ['students', 'student-registration'], priority: 30, industries: ['school'] },
    { id: 'pending-students', label: 'Student follow-up', value: String(pendingStudents), hint: 'Students still pending or needing manual review', tone: '#f59e0b', group: 'school', moduleIds: ['students', 'student-registration'], priority: 40, industries: ['school'] },
    { id: 'student-today', label: 'Students added today', value: String(todayStudents.length), hint: 'New confirmed student records today', tone: '#8b5cf6', group: 'school', moduleIds: ['students'], priority: 50, industries: ['school'] },
    { id: 'blog-posts', label: 'New blog posts today', value: String(todayBlogPosts.length), hint: 'Published or drafted today', tone: '#0891b2', group: 'content', moduleIds: ['blog'], priority: 100 },
  ]

  const enabledMetrics = allMetrics.filter(metric => metricIsAllowed(metric, industry, enabledModules)).sort((a, b) => a.priority - b.priority)
  const availableMetricIds = enabledMetrics.map(metric => metric.id)
  const defaultKpiIds = DEFAULT_KPI_IDS_BY_INDUSTRY[industry].filter(id => availableMetricIds.includes(id))
  const fallbackKpiIds = defaultKpiIds.length > 0 ? defaultKpiIds : enabledMetrics.slice(0, 6).map(metric => metric.id)
  const availableMetricKey = availableMetricIds.join('|')
  const fallbackMetricKey = fallbackKpiIds.join('|')

  useEffect(() => {
    if (!storeId) {
      setSelectedKpiIds(fallbackKpiIds)
      return undefined
    }
    return onSnapshot(doc(db, 'dashboardPreferences', storeId), snapshot => {
      const data = snapshot.data() as { selectedKpiIds?: unknown } | undefined
      setSelectedKpiIds(normalizeSelectedKpis(data?.selectedKpiIds, availableMetricIds, fallbackKpiIds))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, availableMetricKey, fallbackMetricKey])

  const selectedMetrics = enabledMetrics.filter(metric => selectedKpiIds.includes(metric.id))
  const visibleMetrics = selectedMetrics.length > 0 ? selectedMetrics : enabledMetrics.slice(0, 6)
  const secondaryMetrics = enabledMetrics.filter(metric => !visibleMetrics.some(selected => selected.id === metric.id)).slice(0, 4)
  const quickActions = DEFAULT_QUICK_ACTIONS.filter(action => actionIsAllowed(action, industry, enabledModules)).slice(0, 6)
  const intro = dashboardIntro(industry)

  function toggleKpi(metricId: string) {
    setKpiMessage('')
    setSelectedKpiIds(current => current.includes(metricId) ? (current.length > 1 ? current.filter(id => id !== metricId) : current) : [...current, metricId])
  }

  async function saveKpiPreferences() {
    if (!storeId) return
    try {
      setIsSavingKpis(true)
      await setDoc(doc(db, 'dashboardPreferences', storeId), { storeId, selectedKpiIds, updatedAt: serverTimestamp() }, { merge: true })
      setKpiMessage('Dashboard KPIs saved for this store.')
      setIsCustomizing(false)
    } catch (error) {
      console.error('[dashboard] Failed to save KPI preferences', error)
      setKpiMessage('Unable to save KPI preferences right now.')
    } finally {
      setIsSavingKpis(false)
    }
  }

  return (
    <div className="workspace-page dashboard-page">
      <section className="dashboard-hero dashboard-hero--minimal">
        <p className="dashboard-hero__eyebrow">{intro.eyebrow}</p>
        <h1>{intro.title}</h1>
        <p>{intro.subtitle}</p>
        <div className="dashboard-hero__actions">
          <button type="button" className="button button--secondary" onClick={() => setIsCustomizing(value => !value)}>{isCustomizing ? 'Close KPI picker' : 'Customize KPIs'}</button>
          <Link className="button button--primary" to="/reports">Open Reports</Link>
        </div>
        {kpiMessage ? <p className={`dashboard-kpi-message${kpiMessage.includes('Unable') ? ' is-error' : ''}`}>{kpiMessage}</p> : null}
      </section>

      {isCustomizing ? (
        <section className="dashboard-panel" aria-label="Customize dashboard KPIs">
          <div className="dashboard-panel__header">
            <div><h2>Choose dashboard KPIs</h2><p>Selected KPIs show first on this store dashboard. At least one KPI must remain selected.</p></div>
            <div className="dashboard-panel__actions">
              <button type="button" className="button button--secondary" onClick={() => setSelectedKpiIds(fallbackKpiIds)}>Reset default</button>
              <button type="button" className="button button--primary" disabled={isSavingKpis} onClick={() => void saveKpiPreferences()}>{isSavingKpis ? 'Saving…' : 'Save KPIs'}</button>
            </div>
          </div>
          <div className="dashboard-kpi-picker-grid">
            {enabledMetrics.map(metric => (
              <label key={metric.id} className={`dashboard-kpi-picker-option${selectedKpiIds.includes(metric.id) ? ' is-selected' : ''}`} style={kpiStyle(metric.tone)}>
                <span><input type="checkbox" checked={selectedKpiIds.includes(metric.id)} onChange={() => toggleKpi(metric.id)} /><strong>{metric.label}</strong></span>
                <small>{groupLabel(metric.group)} · {metric.hint}</small>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-label="Quick KPI board" className="dashboard-kpi-grid dashboard-kpi-grid--clean">
        {visibleMetrics.map(metric => (
          <article key={metric.id} className={`dashboard-kpi-card dashboard-kpi-card--clean${metric.highlight ? ' is-highlighted' : ''}`} style={kpiStyle(metric.tone)}>
            <p className="dashboard-kpi-card__badge">{groupLabel(metric.group)}</p>
            <h2 className="dashboard-kpi-card__value">{metric.value}</h2>
            <p className="dashboard-kpi-card__label">{metric.label}</p>
            <p className="dashboard-kpi-card__hint">{metric.hint}</p>
          </article>
        ))}
      </section>

      {industry === 'shop' && enabledModules.has('products') ? (
        <section className="dashboard-panel" aria-label="Stock alerts">
          <div className="dashboard-panel__header">
            <div>
              <h2>Products needing stock attention</h2>
              <p>{inventory.lowStock ? `${inventory.lowStock} product${inventory.lowStock === 1 ? '' : 's'} are low or out of stock.` : 'All tracked products are above their reorder levels.'}</p>
            </div>
            <div className="dashboard-panel__actions"><Link className="button button--primary" to="/products">Manage inventory</Link></div>
          </div>
          {inventory.lowStockItems.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {inventory.lowStockItems.map(item => (
                <Link key={item.id || item.name} to="/products" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 16, alignItems: 'center', padding: 14, border: '1px solid #e2e8f0', borderRadius: 16, color: 'inherit', textDecoration: 'none' }}>
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block' }}>{item.name}</strong>
                    <small style={{ color: '#667085' }}>{item.sku ? `SKU: ${item.sku} · ` : ''}Reorder at {item.reorderPoint || 'not set'}</small>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <strong style={{ display: 'block', color: item.stock <= 0 ? '#b91c1c' : '#b45309' }}>{item.stock <= 0 ? 'Out of stock' : `${item.stock} left`}</strong>
                    <small style={{ color: '#667085' }}>Update product</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="dashboard-empty-note">No stock alerts right now.</p>}
        </section>
      ) : null}

      <section className="dashboard-panel">
        <div className="dashboard-panel__header dashboard-panel__header--centered"><div><h2>Quick actions</h2><p>Open the module you need without turning the dashboard into a full report page.</p></div></div>
        <div className="dashboard-action-grid">
          {quickActions.map(action => <Link key={action.id} to={action.to} className="dashboard-action-card"><strong>{action.label}</strong><span>{action.hint}</span></Link>)}
        </div>
      </section>

      <section className="dashboard-panel dashboard-panel--muted">
        <div className="dashboard-panel__header">
          <div><h2>More numbers</h2><p>Dashboard stays focused. Deeper exports and full histories stay inside Reports.</p></div>
          <div className="dashboard-panel__actions"><Link className="button button--secondary" to="/online-orders">Online Orders</Link><Link className="button button--primary" to="/reports">Reports</Link></div>
        </div>
        <div className="dashboard-report-strip">
          {secondaryMetrics.map(metric => <article key={metric.id} className="dashboard-report-mini-card"><span>{groupLabel(metric.group)}</span><strong>{metric.value}</strong><p>{metric.label}</p><small>{metric.hint}</small></article>)}
          {secondaryMetrics.length === 0 ? <p className="dashboard-empty-note">No extra dashboard metrics are enabled for this store.</p> : null}
        </div>
      </section>
    </div>
  )
}
