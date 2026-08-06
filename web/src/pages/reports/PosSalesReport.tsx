import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../../firebase'
import { useActiveStore } from '../../hooks/useActiveStore'
import { useMemberships } from '../../hooks/useMemberships'
import { useToast } from '../../components/ToastProvider'
import ReportDataTable, { type ReportColumn } from './ReportDataTable'
import { asNumber, asText, downloadCsv, exportReportPdf, formatDate, formatMoney, getNestedObject, toDate } from './reportUtils'
import './PosSalesReport.css'

type SaleRow = {
  id: string
  receiptNo: string
  customerName: string
  originalTotal: number
  discount: number
  discountPercent: number
  total: number
  cashTotal: number
  cardTotal: number
  momoTotal: number
  unitsSold: number
  itemsSummary: string
  paymentSummary: string
  createdAt: Date | null
  status: 'completed' | 'voided'
  voidReason: string
}

type SalesMetric = { count: number; revenue: number }

export function mapSale(id: string, data: Record<string, unknown>): SaleRow {
  const tenders = getNestedObject(data, 'tenders')
  const payment = getNestedObject(data, 'payment')
  const paymentTenders = getNestedObject(payment, 'tenders')
  const totals = getNestedObject(data, 'totals')
  const customer = getNestedObject(data, 'customer')
  const items = Array.isArray(data.items) ? data.items as Array<Record<string, unknown>> : []
  const cashTotal = asNumber(tenders.cash ?? paymentTenders.cash, 0)
  const cardTotal = asNumber(tenders.card ?? paymentTenders.card, 0)
  const momoTotal = asNumber(tenders.momo ?? tenders.mobileMoney ?? tenders.mobile_money ?? paymentTenders.momo, 0)
  const unitsSold = items.reduce((sum, item) => sum + asNumber(item.qty ?? item.quantity, 0), 0)
  const itemsSummary = items.map(item => {
    const name = asText(item.name ?? item.productName, 'Unnamed item')
    const quantity = asNumber(item.qty ?? item.quantity, 0)
    return quantity > 0 ? `${name} × ${quantity}` : name
  }).join(', ')
  const paymentParts = [
    cashTotal > 0 ? `Cash ${formatMoney(cashTotal)}` : '',
    cardTotal > 0 ? `Card ${formatMoney(cardTotal)}` : '',
    momoTotal > 0 ? `MoMo ${formatMoney(momoTotal)}` : '',
  ].filter(Boolean)

  const total = asNumber(data.total ?? totals.total ?? data.grandTotal ?? data.amount, 0)
  const subTotal = asNumber(data.subTotal ?? totals.subTotal ?? data.subtotal, 0)
  const taxTotal = asNumber(data.taxTotal ?? totals.taxTotal ?? data.tax, 0)
  const storedDiscount = Math.max(0, asNumber(data.discount ?? totals.discount ?? data.discountAmount, 0))
  const originalTotal = Math.max(total, subTotal + taxTotal, total + storedDiscount)
  const discount = Math.max(storedDiscount, originalTotal - total)
  const discountPercent = originalTotal > 0 ? (discount / originalTotal) * 100 : 0

  return {
    id,
    receiptNo: asText(data.receiptNo ?? data.receiptNumber ?? data.reference, id),
    customerName: asText(customer.name ?? data.customerName, 'Walk-in customer'),
    originalTotal,
    discount,
    discountPercent,
    total,
    cashTotal,
    cardTotal,
    momoTotal,
    unitsSold,
    itemsSummary: itemsSummary || 'No item details',
    paymentSummary: paymentParts.join(' · ') || asText(payment.method, 'Not specified'),
    createdAt: toDate(data.createdAt),
    status: asText(data.status, '').toLowerCase() === 'voided' ? 'voided' : 'completed',
    voidReason: asText(data.voidReason, ''),
  }
}

function startOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function endOfDay(date: Date) {
  const result = new Date(date)
  result.setHours(23, 59, 59, 999)
  return result
}

function metricForRange(sales: SaleRow[], start: Date, end: Date): SalesMetric {
  return sales.reduce<SalesMetric>((metric, sale) => {
    if (sale.status === 'voided' || !sale.createdAt || sale.createdAt < start || sale.createdAt > end) return metric
    return { count: metric.count + 1, revenue: metric.revenue + sale.total }
  }, { count: 0, revenue: 0 })
}

function formatDiscountPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0$/, '')}%`
}

export default function PosSalesReport() {
  const { storeId } = useActiveStore()
  const { memberships } = useMemberships()
  const { publish } = useToast()
  const [sales, setSales] = useState<SaleRow[]>([])
  const [range, setRange] = useState('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loadError, setLoadError] = useState('')
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const isOwner = memberships.some(membership => membership.storeId === storeId && membership.role === 'owner')

  useEffect(() => {
    if (!storeId) {
      setSales([])
      return undefined
    }
    setLoadError('')
    return onSnapshot(
      query(collection(db, 'sales'), where('storeId', '==', storeId)),
      snapshot => {
        setLoadError('')
        setSales(snapshot.docs.map(docSnap => mapSale(docSnap.id, docSnap.data() as Record<string, unknown>)).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)))
      },
      error => {
        console.error('[pos-sales-report] Failed to load sales', error)
        setSales([])
        setLoadError('Sales could not be loaded. Check your connection and try again.')
      },
    )
  }, [storeId])

  const dashboardMetrics = useMemo(() => {
    const now = new Date()
    const todayStart = startOfDay(now)
    const todayEnd = endOfDay(now)
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const sevenDaysStart = startOfDay(new Date(now))
    sevenDaysStart.setDate(sevenDaysStart.getDate() - 6)
    const thirtyDaysStart = startOfDay(new Date(now))
    thirtyDaysStart.setDate(thirtyDaysStart.getDate() - 29)
    return {
      today: metricForRange(sales, todayStart, todayEnd),
      yesterday: metricForRange(sales, startOfDay(yesterday), endOfDay(yesterday)),
      sevenDays: metricForRange(sales, sevenDaysStart, todayEnd),
      thirtyDays: metricForRange(sales, thirtyDaysStart, todayEnd),
    }
  }, [sales])

  const filtered = useMemo(() => {
    if (range === 'all') return sales
    const now = new Date()
    let start = startOfDay(now)
    let end = endOfDay(now)
    if (range === 'yesterday') {
      start.setDate(start.getDate() - 1)
      end.setDate(end.getDate() - 1)
    }
    if (range === '7') start.setDate(start.getDate() - 6)
    if (range === '30') start.setDate(start.getDate() - 29)
    if (range === 'this-month') start = new Date(now.getFullYear(), now.getMonth(), 1)
    if (range === 'custom') {
      if (!customStart && !customEnd) return sales
      start = customStart ? startOfDay(new Date(`${customStart}T00:00:00`)) : new Date(0)
      end = customEnd ? endOfDay(new Date(`${customEnd}T00:00:00`)) : endOfDay(now)
    }
    return sales.filter(sale => sale.createdAt && sale.createdAt >= start && sale.createdAt <= end)
  }, [customEnd, customStart, range, sales])

  const totals = useMemo(() => ({
    count: filtered.filter(sale => sale.status !== 'voided').length,
    revenue: filtered.reduce((sum, sale) => sum + (sale.status === 'voided' ? 0 : sale.total), 0),
    discount: filtered.reduce((sum, sale) => sum + (sale.status === 'voided' ? 0 : sale.discount), 0),
    units: filtered.reduce((sum, sale) => sum + (sale.status === 'voided' ? 0 : sale.unitsSold), 0),
    cash: filtered.reduce((sum, sale) => sum + (sale.status === 'voided' ? 0 : sale.cashTotal), 0),
  }), [filtered])

  const columns: ReportColumn<SaleRow>[] = [
    { key: 'receiptNo', label: 'Receipt', sortable: true, value: row => row.receiptNo },
    { key: 'customer', label: 'Customer', sortable: true, value: row => row.customerName },
    { key: 'items', label: 'Items sold', value: row => row.itemsSummary, render: row => <span className="pos-sales-report__items">{row.itemsSummary}</span> },
    {
      key: 'total', label: 'Total', sortable: true, align: 'right', value: row => row.total,
      render: row => row.discount > 0 ? (
        <span className="pos-sales-report__discount-total">
          <strong>{formatMoney(row.total)}</strong>
          <span className="pos-sales-report__original-total">{formatMoney(row.originalTotal)}</span>
          <span className="pos-sales-report__discount-badge">Discount {formatMoney(row.discount)} · {formatDiscountPercent(row.discountPercent)}</span>
        </span>
      ) : formatMoney(row.total),
    },
    { key: 'payment', label: 'Payment', sortable: true, value: row => row.paymentSummary },
    { key: 'units', label: 'Units', sortable: true, align: 'right', value: row => row.unitsSold },
    { key: 'date', label: 'Date', sortable: true, value: row => row.createdAt ?? undefined, render: row => formatDate(row.createdAt) },
    { key: 'status', label: 'Status', sortable: true, value: row => row.status, render: row => row.status === 'voided' ? `Voided${row.voidReason ? ` — ${row.voidReason}` : ''}` : row.discount > 0 ? 'Completed · Discounted' : 'Completed' },
    { key: 'actions', label: 'Actions', render: row => row.status === 'voided' ? '—' : isOwner ? <button type="button" className="button button--secondary button--small" disabled={voidingId === row.id} onClick={() => void handleVoidSale(row)}>{voidingId === row.id ? 'Voiding…' : 'Void sale'}</button> : 'Owner approval required' },
  ]

  async function handleVoidSale(sale: SaleRow) {
    if (!storeId || !isOwner || voidingId) return
    const reason = window.prompt(`Why are you voiding receipt ${sale.receiptNo}?\n\nInventory will be restored. Refunds must still be completed through the original payment provider.`)?.trim()
    if (!reason) return
    if (reason.length < 5) {
      publish({ tone: 'error', message: 'Enter a correction reason of at least 5 characters.' })
      return
    }
    if (!window.confirm(`Void ${sale.receiptNo} and restore ${sale.unitsSold} unit(s) to stock? This action cannot be undone.`)) return
    setVoidingId(sale.id)
    try {
      await httpsCallable(functions, 'voidSale')({ storeId, saleId: sale.id, reason })
      publish({ tone: 'success', message: 'Sale voided and inventory restored. Record the corrected sale if needed.' })
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Firebase:\s*/i, '') : 'The sale could not be voided.'
      publish({ tone: 'error', message })
    } finally {
      setVoidingId(null)
    }
  }

  function exportRows() {
    downloadCsv('sedifex-pos-sales-report.csv', filtered.map(sale => ({
      receiptNo: sale.receiptNo,
      customer: sale.customerName,
      itemsSold: sale.itemsSummary,
      originalTotal: sale.originalTotal,
      discountAmount: sale.discount,
      discountPercent: Number(sale.discountPercent.toFixed(2)),
      finalTotal: sale.total,
      cash: sale.cashTotal,
      card: sale.cardTotal,
      momo: sale.momoTotal,
      unitsSold: sale.unitsSold,
      createdAt: formatDate(sale.createdAt),
      status: sale.status,
      voidReason: sale.voidReason,
    })))
  }

  function exportPdf() {
    exportReportPdf({
      title: 'POS sales report',
      subtitle: 'Detailed POS sales with original totals, discounts, final totals, payment split, and units sold.',
      summary: [
        { label: 'Sales', value: totals.count },
        { label: 'Sales value', value: formatMoney(totals.revenue) },
        { label: 'Discounts given', value: formatMoney(totals.discount) },
        { label: 'Units sold', value: totals.units },
        { label: 'Cash collected', value: formatMoney(totals.cash) },
      ],
      rows: filtered.map(sale => ({
        receiptNo: sale.receiptNo,
        customer: sale.customerName,
        itemsSold: sale.itemsSummary,
        originalTotal: sale.originalTotal,
        discountAmount: sale.discount,
        discountPercent: Number(sale.discountPercent.toFixed(2)),
        finalTotal: sale.total,
        cash: sale.cashTotal,
        card: sale.cardTotal,
        momo: sale.momoTotal,
        unitsSold: sale.unitsSold,
        paymentSummary: sale.paymentSummary,
        createdAt: formatDate(sale.createdAt),
        status: sale.status,
        voidReason: sale.voidReason,
      })),
    })
  }

  return (
    <div className="workspace-page pos-sales-report">
      <section className="workspace-card">
        <p className="workspace-eyebrow">Reports / POS sales</p>
        <h1>Sales history</h1>
        <p className="workspace-muted">Track daily performance, filter sales by date, and review every transaction.</p>
      </section>
      <section className="workspace-grid workspace-grid--four">
        <article className="workspace-card"><strong>{formatMoney(dashboardMetrics.today.revenue)}</strong><span>Sales today · {dashboardMetrics.today.count} transaction{dashboardMetrics.today.count === 1 ? '' : 's'}</span></article>
        <article className="workspace-card"><strong>{formatMoney(dashboardMetrics.yesterday.revenue)}</strong><span>Sales yesterday · {dashboardMetrics.yesterday.count} transaction{dashboardMetrics.yesterday.count === 1 ? '' : 's'}</span></article>
        <article className="workspace-card"><strong>{formatMoney(dashboardMetrics.sevenDays.revenue)}</strong><span>Last 7 days · {dashboardMetrics.sevenDays.count} transaction{dashboardMetrics.sevenDays.count === 1 ? '' : 's'}</span></article>
        <article className="workspace-card"><strong>{formatMoney(dashboardMetrics.thirtyDays.revenue)}</strong><span>Last 30 days · {dashboardMetrics.thirtyDays.count} transaction{dashboardMetrics.thirtyDays.count === 1 ? '' : 's'}</span></article>
      </section>
      <section className="workspace-card">
        {loadError && <p className="products__message products__message--error" role="alert">{loadError}</p>}
        <div className="workspace-section-header">
          <div><h2>Sale details</h2><p className="workspace-muted">The totals and exports below follow the selected date filter.</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button button--secondary" onClick={exportPdf} disabled={!filtered.length}>Export PDF</button>
            <button type="button" className="button button--primary" onClick={exportRows} disabled={!filtered.length}>Export CSV</button>
          </div>
        </div>
        <div className="workspace-grid workspace-grid--four">
          <article><strong>{totals.count}</strong><span>Filtered sales</span></article>
          <article><strong>{formatMoney(totals.revenue)}</strong><span>Filtered sales value</span></article>
          <article><strong>{formatMoney(totals.discount)}</strong><span>Discounts given</span></article>
          <article><strong>{totals.units}</strong><span>Filtered units sold</span></article>
        </div>
        <div className="workspace-toolbar" style={{ alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
          <label>
            <span className="workspace-muted">Date range</span>
            <select value={range} onChange={event => setRange(event.target.value)}>
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="this-month">This month</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {range === 'custom' && (
            <>
              <label><span className="workspace-muted">From</span><input type="date" value={customStart} max={customEnd || undefined} onChange={event => setCustomStart(event.target.value)} /></label>
              <label><span className="workspace-muted">To</span><input type="date" value={customEnd} min={customStart || undefined} onChange={event => setCustomEnd(event.target.value)} /></label>
            </>
          )}
        </div>
        <ReportDataTable rows={filtered} columns={columns} getRowKey={row => row.id} searchPlaceholder="Search receipt, item, customer, payment…" />
      </section>
    </div>
  )
}
