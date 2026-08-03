import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../../firebase'
import { functions } from '../../firebase'
import { useActiveStore } from '../../hooks/useActiveStore'
import { useMemberships } from '../../hooks/useMemberships'
import { useToast } from '../../components/ToastProvider'
import ReportDataTable, { type ReportColumn } from './ReportDataTable'
import { asNumber, asText, downloadCsv, exportReportPdf, formatDate, formatMoney, getNestedObject, toDate } from './reportUtils'

type SaleRow = {
  id: string
  receiptNo: string
  customerName: string
  total: number
  cashTotal: number
  cardTotal: number
  momoTotal: number
  unitsSold: number
  paymentSummary: string
  createdAt: Date | null
  status: 'completed' | 'voided'
  voidReason: string
}

function mapSale(id: string, data: Record<string, unknown>): SaleRow {
  const tenders = getNestedObject(data, 'tenders')
  const customer = getNestedObject(data, 'customer')
  const items = Array.isArray(data.items) ? data.items as Array<Record<string, unknown>> : []
  const cashTotal = asNumber(tenders.cash, 0)
  const cardTotal = asNumber(tenders.card, 0)
  const momoTotal = asNumber(tenders.momo ?? tenders.mobileMoney ?? tenders.mobile_money, 0)
  const unitsSold = items.reduce((sum, item) => sum + asNumber(item.qty ?? item.quantity, 0), 0)
  const paymentParts = [
    cashTotal > 0 ? `Cash ${formatMoney(cashTotal)}` : '',
    cardTotal > 0 ? `Card ${formatMoney(cardTotal)}` : '',
    momoTotal > 0 ? `MoMo ${formatMoney(momoTotal)}` : '',
  ].filter(Boolean)

  return {
    id,
    receiptNo: asText(data.receiptNo ?? data.receiptNumber ?? data.reference, id),
    customerName: asText(customer.name ?? data.customerName, 'Walk-in customer'),
    total: asNumber(data.total ?? data.grandTotal ?? data.amount, 0),
    cashTotal,
    cardTotal,
    momoTotal,
    unitsSold,
    paymentSummary: paymentParts.join(' · ') || 'Not specified',
    createdAt: toDate(data.createdAt),
    status: asText(data.status, '').toLowerCase() === 'voided' ? 'voided' : 'completed',
    voidReason: asText(data.voidReason, ''),
  }
}

export default function PosSalesReport() {
  const { storeId } = useActiveStore()
  const { memberships } = useMemberships()
  const { publish } = useToast()
  const [sales, setSales] = useState<SaleRow[]>([])
  const [range, setRange] = useState('all')
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const isOwner = memberships.some(membership => membership.storeId === storeId && membership.role === 'owner')

  useEffect(() => {
    if (!storeId) {
      setSales([])
      return undefined
    }

    const unsubscribe = onSnapshot(query(collection(db, 'sales'), where('storeId', '==', storeId)), snapshot => {
      setSales(snapshot.docs.map(docSnap => mapSale(docSnap.id, docSnap.data() as Record<string, unknown>)).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)))
    })

    return unsubscribe
  }, [storeId])

  const filtered = useMemo(() => {
    if (range === 'all') return sales
    const now = new Date()
    const start = new Date(now)
    if (range === 'today') start.setHours(0, 0, 0, 0)
    if (range === '7') start.setDate(start.getDate() - 7)
    if (range === '30') start.setDate(start.getDate() - 30)
    return sales.filter(sale => sale.createdAt && sale.createdAt >= start)
  }, [range, sales])

  const totals = useMemo(() => ({
    count: filtered.filter(sale => sale.status !== 'voided').length,
    revenue: filtered.reduce((sum, sale) => sum + (sale.status === 'voided' ? 0 : sale.total), 0),
    units: filtered.reduce((sum, sale) => sum + (sale.status === 'voided' ? 0 : sale.unitsSold), 0),
    cash: filtered.reduce((sum, sale) => sum + (sale.status === 'voided' ? 0 : sale.cashTotal), 0),
  }), [filtered])


  const columns: ReportColumn<SaleRow>[] = [
    { key: 'receiptNo', label: 'Receipt', sortable: true, value: row => row.receiptNo },
    { key: 'customer', label: 'Customer', sortable: true, value: row => row.customerName },
    { key: 'total', label: 'Total', sortable: true, align: 'right', value: row => row.total, render: row => formatMoney(row.total) },
    { key: 'payment', label: 'Payment', sortable: true, value: row => row.paymentSummary },
    { key: 'units', label: 'Units', sortable: true, align: 'right', value: row => row.unitsSold },
    { key: 'date', label: 'Date', sortable: true, value: row => row.createdAt ?? undefined, render: row => formatDate(row.createdAt) },
    { key: 'status', label: 'Status', sortable: true, value: row => row.status, render: row => row.status === 'voided' ? `Voided${row.voidReason ? ` — ${row.voidReason}` : ''}` : 'Completed' },
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
      const callable = httpsCallable(functions, 'voidSale')
      await callable({ storeId, saleId: sale.id, reason })
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
      total: sale.total,
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
      subtitle: 'Detailed POS sales with receipts, payment split, units sold, and totals.',
      summary: [
        { label: 'Sales', value: totals.count },
        { label: 'Sales value', value: formatMoney(totals.revenue) },
        { label: 'Units sold', value: totals.units },
        { label: 'Cash collected', value: formatMoney(totals.cash) },
      ],
      rows: filtered.map(sale => ({
        receiptNo: sale.receiptNo,
        customer: sale.customerName,
        total: sale.total,
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
    <div className="workspace-page">
      <section className="workspace-card">
        <p className="workspace-eyebrow">Reports / POS sales</p>
        <h1>Internal sales report</h1>
        <p className="workspace-muted">Review completed sales, void mistakes with owner approval, restore inventory, and export an audit-friendly history.</p>
      </section>
      <section className="workspace-grid workspace-grid--four">
        <article className="workspace-card"><strong>{totals.count}</strong><span>Sales</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.revenue)}</strong><span>Total sales value</span></article>
        <article className="workspace-card"><strong>{totals.units}</strong><span>Units sold</span></article>
        <article className="workspace-card"><strong>{formatMoney(totals.cash)}</strong><span>Cash collected</span></article>
      </section>
      <section className="workspace-card">
        <div className="workspace-section-header">
          <div><h2>Sale details</h2><p className="workspace-muted">Owners can void an incorrect sale, then record the corrected sale in Sell. Payment refunds must be completed separately with the payment provider.</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button button--secondary" onClick={exportPdf} disabled={!filtered.length}>Export PDF</button>
            <button type="button" className="button button--primary" onClick={exportRows} disabled={!filtered.length}>Export CSV</button>
          </div>
        </div>
        <div className="workspace-toolbar">
          <select value={range} onChange={event => setRange(event.target.value)}>
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </div>
        <ReportDataTable rows={filtered} columns={columns} getRowKey={row => row.id} searchPlaceholder="Search receipt, customer, payment…" />
      </section>
    </div>
  )
}
