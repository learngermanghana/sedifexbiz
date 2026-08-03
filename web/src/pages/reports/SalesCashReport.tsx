import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase'
import { useActiveStore } from '../../hooks/useActiveStore'
import ReportDataTable, { type ReportColumn } from './ReportDataTable'
import { asNumber, asText, downloadCsv, exportReportPdf, formatDate, formatMoney, getNestedObject, toDate } from './reportUtils'
import { canonicalBookingOrderKey, chooseMoreCompleteRecord, deriveCanonicalOrderStatus, deriveOnlineOrderStatusFromBooking, deriveReportPaymentFields, normalizeBookingStatusFromRecord } from '../../lib/bookingStatus'

type BusinessSaleRow = {
  id: string
  type: 'pos' | 'online' | 'booking' | 'cash'
  label: string
  reference: string
  bookingId: string
  customerName: string
  customerContact: string
  itemName: string
  amount: number
  currency: string
  paymentMethod: string
  paymentStatus: string
  orderStatus: string
  settlementScope: 'store_only' | 'sedifex_settlement' | 'pos'
  createdAt: Date | null
  updatedAt: Date | null
}

function firstItem(data: Record<string, unknown>) {
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.cart) ? data.cart : []
  const first = items[0]
  return first && typeof first === 'object' ? first as Record<string, unknown> : {}
}

function readAmount(data: Record<string, unknown>) {
  const payment = getNestedObject(data, 'payment')
  const pricing = getNestedObject(data, 'pricingSnapshot')
  const pricingSnake = getNestedObject(data, 'pricing_snapshot')
  const amountMinor = asNumber(data.amountMinor, 0)
  if (amountMinor > 0) return amountMinor / 100
  return asNumber(
    data.total ??
      data.grandTotal ??
      data.amountPaid ??
      data.amount_paid ??
      data.confirmedAmount ??
      data.amount ??
      payment.customerTotal ??
      payment.amount ??
      pricing.final_total ??
      pricingSnake.final_total ??
      pricing.subtotal ??
      pricingSnake.subtotal,
    0,
  )
}

function isPaidLike(status: string) {
  const normalized = status.toLowerCase()
  return ['paid', 'paid_cash', 'success', 'confirmed', 'captured', 'completed'].some(token => normalized.includes(token))
}

function isPendingLike(status: string) {
  return status.toLowerCase().includes('pending') || status.toLowerCase().includes('awaiting')
}

function rangeStart(range: string) {
  const now = new Date()
  const start = new Date(now)
  if (range === 'today') start.setHours(0, 0, 0, 0)
  if (range === '7d') start.setDate(now.getDate() - 7)
  if (range === '30d') start.setDate(now.getDate() - 30)
  if (range === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }
  return start
}

function inRange(date: Date | null, range: string) {
  if (range === 'all') return true
  if (!date) return false
  return date >= rangeStart(range)
}

function mapPosSale(id: string, data: Record<string, unknown>): BusinessSaleRow {
  const customer = getNestedObject(data, 'customer')
  const first = firstItem(data)
  const isVoided = asText(data.status).toLowerCase() === 'voided'
  const amount = isVoided ? 0 : asNumber(data.total ?? data.grandTotal ?? data.amount, readAmount(data))
  return {
    id: `pos-${id}`,
    type: 'pos',
    label: 'POS / Sell',
    reference: asText(data.receiptNumber ?? data.reference ?? data.saleId, id),
    bookingId: '',
    customerName: asText(customer.name ?? data.customerName, 'Walk-in customer'),
    customerContact: asText(customer.phone ?? customer.email ?? data.customerPhone ?? data.customerEmail, ''),
    itemName: asText(first.name ?? first.itemName ?? data.itemName, 'POS sale'),
    amount,
    currency: asText(data.currency, 'GHS'),
    paymentMethod: asText(data.paymentMethod ?? data.paymentType, 'POS'),
    paymentStatus: asText(data.paymentStatus ?? data.status, 'completed'),
    orderStatus: asText(data.orderStatus ?? data.status, 'completed'),
    settlementScope: 'pos',
    createdAt: toDate(data.createdAt ?? data.saleDate ?? data.updatedAt),
    updatedAt: toDate(data.updatedAt ?? data.updated_at),
  }
}

function mapIntegrationOrder(id: string, data: Record<string, unknown>, type: 'online' | 'booking'): BusinessSaleRow {
  const customer = getNestedObject(data, 'customer')
  const payment = getNestedObject(data, 'payment')
  const first = firstItem(data)
  const storeOnly = data.storeOnly === true || data.excludedFromSedifexSettlement === true
  const reportFields = deriveReportPaymentFields(data)
  const bookingStatus = normalizeBookingStatusFromRecord(data)
  const orderStatus = String(deriveCanonicalOrderStatus(data, type === 'booking' ? deriveOnlineOrderStatusFromBooking(bookingStatus) : 'pending'))
  return {
    id: `${type}-${id}`,
    type,
    label: type === 'booking' ? 'Booking / Service' : 'Online order',
    reference: asText(data.reference ?? data.paymentReference ?? data.payment_reference ?? payment.reference, id),
    bookingId: asText(data.booking_id ?? data.bookingId, type === 'booking' ? id : ''),
    customerName: asText(customer.name ?? data.customerName ?? data.name, 'Customer'),
    customerContact: asText(customer.phone ?? customer.email ?? data.customerPhone ?? data.customerEmail ?? data.phone ?? data.email, ''),
    itemName: asText(data.itemName ?? data.productName ?? data.serviceName ?? first.name ?? first.itemName ?? first.productName, type === 'booking' ? 'Service booking' : 'Online order'),
    amount: reportFields.amountReceived,
    currency: asText(payment.currency ?? data.currency, 'GHS'),
    paymentMethod: asText(data.paymentCollectionMode ?? data.paymentMethod ?? data.payment_method ?? payment.mode, 'online_checkout'),
    paymentStatus: reportFields.paymentStatus,
    orderStatus,
    settlementScope: storeOnly ? 'store_only' : 'sedifex_settlement',
    createdAt: toDate(data.createdAtServer ?? data.createdAt ?? data.updatedAt),
    updatedAt: toDate(data.updatedAt ?? data.updated_at ?? data.paymentUpdatedAt),
  }
}

function mapCashOrder(id: string, data: Record<string, unknown>): BusinessSaleRow {
  const customer = getNestedObject(data, 'customer')
  const first = firstItem(data)
  return {
    id: `cash-${id}`,
    type: 'cash',
    label: 'Store cash / Manual',
    reference: asText(data.reference ?? data.paymentReference ?? data.payment_reference, id),
    bookingId: '',
    customerName: asText(customer.name ?? data.customerName, 'Customer'),
    customerContact: asText(customer.phone ?? customer.email ?? data.customerPhone ?? data.customerEmail, ''),
    itemName: asText(data.itemName ?? data.serviceName ?? data.productName ?? first.name ?? first.itemName, 'Manual cash sale'),
    amount: readAmount(data),
    currency: asText(data.currency, 'GHS'),
    paymentMethod: asText(data.paymentMethod ?? data.payment_method ?? data.paymentCollectionMode, 'CASH'),
    paymentStatus: asText(data.paymentStatus ?? data.payment_status, 'pending_cash'),
    orderStatus: asText(data.orderStatus ?? data.order_status, 'awaiting_cash_confirmation'),
    settlementScope: 'store_only',
    createdAt: toDate(data.createdAtServer ?? data.createdAt ?? data.updatedAt),
    updatedAt: toDate(data.updatedAt ?? data.updated_at ?? data.paymentUpdatedAt),
  }
}

export default function SalesCashReport() {
  const { storeId } = useActiveStore()
  const [posRows, setPosRows] = useState<BusinessSaleRow[]>([])
  const [onlineRows, setOnlineRows] = useState<BusinessSaleRow[]>([])
  const [bookingRows, setBookingRows] = useState<BusinessSaleRow[]>([])
  const [cashRows, setCashRows] = useState<BusinessSaleRow[]>([])
  const [range, setRange] = useState('30d')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    if (!storeId) {
      setPosRows([])
      setOnlineRows([])
      setBookingRows([])
      setCashRows([])
      return undefined
    }

    const unsubSales = onSnapshot(query(collection(db, 'sales'), where('storeId', '==', storeId)), snapshot => {
      setPosRows(snapshot.docs.map(docSnap => mapPosSale(docSnap.id, docSnap.data() as Record<string, unknown>)))
    })
    const unsubOrders = onSnapshot(query(collection(db, 'integrationOrders'), where('storeId', '==', storeId)), snapshot => {
      setOnlineRows(snapshot.docs.map(docSnap => mapIntegrationOrder(docSnap.id, docSnap.data() as Record<string, unknown>, 'online')))
    })
    const unsubBookings = onSnapshot(query(collection(db, 'integrationBookings'), where('storeId', '==', storeId)), snapshot => {
      setBookingRows(snapshot.docs.map(docSnap => mapIntegrationOrder(docSnap.id, docSnap.data() as Record<string, unknown>, 'booking')))
    })
    const unsubCash = onSnapshot(collection(db, 'stores', storeId, 'cashOrders'), snapshot => {
      setCashRows(snapshot.docs.map(docSnap => mapCashOrder(docSnap.id, docSnap.data() as Record<string, unknown>)))
    })

    return () => {
      unsubSales()
      unsubOrders()
      unsubBookings()
      unsubCash()
    }
  }, [storeId])

  const rows = useMemo(() => {
    const rowsByKey = new Map<string, BusinessSaleRow>()
    ;[...onlineRows, ...bookingRows].forEach(row => {
      const key = canonicalBookingOrderKey({ booking_id: row.bookingId, payment_reference: row.reference }, row.id)
      const existing = rowsByKey.get(key)
      rowsByKey.set(key, existing ? chooseMoreCompleteRecord(existing, { ...existing, ...row, id: row.bookingId ? `booking-${row.bookingId}` : row.id }) : row)
    })
    return [...posRows, ...Array.from(rowsByKey.values()), ...cashRows]
      .filter(row => inRange(row.createdAt, range))
    .filter(row => typeFilter === 'all' || row.type === typeFilter)
    .filter(row => {
      if (statusFilter === 'all') return true
      if (statusFilter === 'paid') return isPaidLike(row.paymentStatus) || isPaidLike(row.orderStatus)
      if (statusFilter === 'pending') return isPendingLike(row.paymentStatus) || isPendingLike(row.orderStatus)
      if (statusFilter === 'store_only') return row.settlementScope === 'store_only'
      if (statusFilter === 'settlement') return row.settlementScope === 'sedifex_settlement'
      return true
    })
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
  }, [bookingRows, cashRows, onlineRows, posRows, range, statusFilter, typeFilter])

  const totals = useMemo(() => {
    const paidRows = rows.filter(row => isPaidLike(row.paymentStatus) || isPaidLike(row.orderStatus))
    const pendingRows = rows.filter(row => isPendingLike(row.paymentStatus) || isPendingLike(row.orderStatus))
    const basis = rows
    return {
      records: rows.length,
      totalValue: basis.reduce((sum, row) => sum + row.amount, 0),
      paidValue: paidRows.reduce((sum, row) => sum + row.amount, 0),
      pendingValue: pendingRows.reduce((sum, row) => sum + row.amount, 0),
      posValue: rows.filter(row => row.type === 'pos').reduce((sum, row) => sum + row.amount, 0),
      onlineValue: rows.filter(row => row.type === 'online').reduce((sum, row) => sum + row.amount, 0),
      cashValue: rows.filter(row => row.type === 'cash').reduce((sum, row) => sum + row.amount, 0),
      bookingValue: rows.filter(row => row.type === 'booking').reduce((sum, row) => sum + row.amount, 0),
      storeOnlyValue: rows.filter(row => row.settlementScope === 'store_only').reduce((sum, row) => sum + row.amount, 0),
      settlementValue: rows.filter(row => row.settlementScope === 'sedifex_settlement').reduce((sum, row) => sum + row.amount, 0),
      currency: rows[0]?.currency ?? 'GHS',
    }
  }, [rows])

  const columns: ReportColumn<BusinessSaleRow>[] = [
    { key: 'date', label: 'Date', sortable: true, value: row => row.createdAt ?? undefined, render: row => formatDate(row.createdAt) },
    { key: 'type', label: 'Type', sortable: true, value: row => row.label, render: row => <><strong>{row.label}</strong><br /><small>{row.settlementScope === 'store_only' ? 'Store-only' : row.settlementScope === 'pos' ? 'POS' : 'Settlement data'}</small></> },
    { key: 'reference', label: 'Reference', sortable: true, value: row => row.reference },
    { key: 'customer', label: 'Customer', sortable: true, value: row => `${row.customerName} ${row.customerContact}`, render: row => <><strong>{row.customerName}</strong><br /><small>{row.customerContact || 'No contact'}</small></> },
    { key: 'item', label: 'Item / Service', sortable: true, value: row => row.itemName },
    { key: 'amount', label: 'Amount', sortable: true, align: 'right', value: row => row.amount, render: row => formatMoney(row.amount, row.currency) },
    { key: 'payment', label: 'Payment', sortable: true, value: row => `${row.paymentMethod} ${row.paymentStatus}`, render: row => <>{row.paymentMethod}<br /><small>{row.paymentStatus}</small></> },
    { key: 'status', label: 'Order status', sortable: true, value: row => row.orderStatus },
  ]

  function exportRows() {
    downloadCsv('sedifex-sales-and-cash-report.csv', rows.map(row => ({
      date: formatDate(row.createdAt),
      type: row.label,
      settlementScope: row.settlementScope,
      reference: row.reference,
      customer: row.customerName,
      contact: row.customerContact,
      item: row.itemName,
      amount: row.amount,
      currency: row.currency,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      orderStatus: row.orderStatus,
    })))
  }

  function exportPdf() {
    exportReportPdf({
      title: 'Sales & Cash report',
      subtitle: 'Business activity from POS, online orders, bookings, and store-only manual cash entries.',
      summary: [
        { label: 'Records', value: totals.records },
        { label: 'Total activity', value: formatMoney(totals.totalValue, totals.currency) },
        { label: 'Paid/confirmed', value: formatMoney(totals.paidValue, totals.currency) },
        { label: 'Store-only cash', value: formatMoney(totals.storeOnlyValue, totals.currency) },
      ],
      rows: rows.map(row => ({
        date: formatDate(row.createdAt),
        type: row.label,
        scope: row.settlementScope,
        reference: row.reference,
        customer: row.customerName,
        item: row.itemName,
        amount: row.amount,
        payment: row.paymentMethod,
        paymentStatus: row.paymentStatus,
        orderStatus: row.orderStatus,
      })),
    })
  }

  return (
    <div className="workspace-page">
      <section className="workspace-card">
        <p className="workspace-eyebrow">Reports / Sales & Cash</p>
        <h1>Sales & Cash Report</h1>
        <p className="workspace-muted">This is the main business activity report. It includes POS sales, online orders, service bookings, and store-only cash/manual records.</p>
      </section>

      <section className="workspace-grid workspace-grid--four">
        <article className="workspace-card"><strong>{formatMoney(totals.totalValue, totals.currency)}</strong><span>Total activity</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.paidValue, totals.currency)}</strong><span>Paid / confirmed</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.pendingValue, totals.currency)}</strong><span>Pending / awaiting</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.storeOnlyValue, totals.currency)}</strong><span>Store-only cash</span></article>
      </section>

      <section className="workspace-grid workspace-grid--four">
        <article className="workspace-card"><strong>{formatMoney(totals.posValue, totals.currency)}</strong><span>POS / Sell</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.onlineValue, totals.currency)}</strong><span>Online orders</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.bookingValue, totals.currency)}</strong><span>Bookings / services</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.settlementValue, totals.currency)}</strong><span>Sedifex settlement value</span></article>
      </section>

      <section className="workspace-card">
        <div className="workspace-section-header">
          <div>
            <h2>Filter report</h2>
            <p className="workspace-muted">Use this page for store activity. Use Settlement Report only for Paystack/commission/payout.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button button--secondary" onClick={exportPdf} disabled={!rows.length}>Export PDF</button>
            <button type="button" className="button button--primary" onClick={exportRows} disabled={!rows.length}>Export CSV</button>
          </div>
        </div>
        <div className="workspace-toolbar">
          <select value={range} onChange={event => setRange(event.target.value)}>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
            <option value="all">All activity</option>
            <option value="pos">POS / Sell</option>
            <option value="online">Online orders</option>
            <option value="booking">Bookings / services</option>
            <option value="cash">Store cash / manual</option>
          </select>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="paid">Paid / confirmed</option>
            <option value="pending">Pending / awaiting</option>
            <option value="store_only">Store-only records</option>
            <option value="settlement">Sedifex settlement records</option>
          </select>
        </div>
      </section>

      <ReportDataTable rows={rows} columns={columns} getRowKey={row => row.id} searchPlaceholder="Search reference, customer, item, payment status…" />
    </div>
  )
}
