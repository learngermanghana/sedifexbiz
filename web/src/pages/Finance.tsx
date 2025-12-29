// web/src/pages/Finance.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { CUSTOMER_CACHE_LIMIT } from '../utils/offlineCache'
import { DebtSummary, formatGhsFromCents, summarizeCustomerDebt } from '../utils/debt'
import Expenses from './Expenses'

type RangeKey = 'month' | '30d' | '7d' | 'all'
type DownloadTab = 'sales' | 'products' | 'expenses'

type SaleRow = {
  id: string
  total: number
  taxTotal: number
  createdAt: Date | null
}

type ExpenseRow = {
  id: string
  amount: number
  category: string
  description: string
  date: string // yyyy-mm-dd
  createdAt: Date | null
}

type ProductRow = {
  id: string
  name: string
  sku: string | null
  price: number | null
  stockCount: number | null
  itemType: 'product' | 'service'
  updatedAt: Date | null
}

function toDate(value: any): Date | null {
  if (!value) return null
  if (value.toDate && typeof value.toDate === 'function') {
    // Firestore Timestamp
    return value.toDate()
  }
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export default function Finance() {
  const { storeId } = useActiveStore()

  const [sales, setSales] = useState<SaleRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [range, setRange] = useState<RangeKey>('month')
  const [products, setProducts] = useState<ProductRow[]>([])
  const [activeDownloadTab, setActiveDownloadTab] = useState<DownloadTab>('sales')
  const [debtSummary, setDebtSummary] = useState<DebtSummary | null>(null)
  const [isLoadingDebt, setIsLoadingDebt] = useState(false)
  const [debtError, setDebtError] = useState<string | null>(null)

  // --- Load sales for this workspace ---
  useEffect(() => {
    if (!storeId) {
      setSales([])
      return
    }

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', storeId), // 👈 match Dashboard query
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: SaleRow[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any
        const createdAt = toDate(data.createdAt)

        const total =
          typeof data.totals?.total === 'number'
            ? data.totals.total
            : typeof data.total === 'number'
              ? data.total
              : 0

        const taxTotal =
          typeof data.totals?.taxTotal === 'number'
            ? data.totals.taxTotal
            : typeof data.taxTotal === 'number'
              ? data.taxTotal
              : 0

        return {
          id: docSnap.id,
          total: Number(total) || 0,
          taxTotal: Number(taxTotal) || 0,
          createdAt,
        }
      })
      setSales(rows)
    })

    return unsubscribe
  }, [storeId])

  // --- Load customer debt for this workspace ---
  useEffect(() => {
    if (!storeId) {
      setDebtSummary(null)
      setDebtError(null)
      return () => {}
    }

    setIsLoadingDebt(true)
    setDebtError(null)

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', storeId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const rows = snapshot.docs.map(docSnap => docSnap.data())
        setDebtSummary(summarizeCustomerDebt(rows))
        setIsLoadingDebt(false)
      },
      error => {
        console.error('[finance] Failed to load customer debt', error)
        setDebtError('Unable to load customer debt balances right now.')
        setIsLoadingDebt(false)
      },
    )

    return unsubscribe
  }, [storeId])

  // --- Load expenses for this workspace ---
  useEffect(() => {
    if (!storeId) {
      setExpenses([])
      return
    }

    const q = query(
      collection(db, 'expenses'),
      where('storeId', '==', storeId),
      orderBy('date', 'desc'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: ExpenseRow[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any
        const createdAt = toDate(data.createdAt)
        const amount = Number(data.amount) || 0
        const date = typeof data.date === 'string' ? data.date : ''
        return {
          id: docSnap.id,
          amount,
          category: typeof data.category === 'string' && data.category.trim() ? data.category : 'Uncategorized',
          description: typeof data.description === 'string' ? data.description : '',
          date,
          createdAt,
        }
      })
      setExpenses(rows)
    })

    return unsubscribe
  }, [storeId])

  // --- Load products for this workspace ---
  useEffect(() => {
    if (!storeId) {
      setProducts([])
      return
    }

    const q = query(collection(db, 'products'), where('storeId', '==', storeId))

    const unsubscribe = onSnapshot(q, snap => {
      const rows: ProductRow[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any

        const price = typeof data.price === 'number' ? data.price : null
        const stockCount =
          typeof data.stockCount === 'number' && Number.isFinite(data.stockCount)
            ? data.stockCount
            : null

        return {
          id: docSnap.id,
          name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Unnamed item',
          sku: typeof data.sku === 'string' && data.sku.trim() ? data.sku : null,
          price,
          stockCount,
          itemType: data.itemType === 'service' ? 'service' : 'product',
          updatedAt:
            data.updatedAt && typeof data.updatedAt.toDate === 'function'
              ? (data.updatedAt.toDate() as Date)
              : null,
        }
      })

      setProducts(rows)
    })

    return unsubscribe
  }, [storeId])

  // --- Date range filtering ---
  const now = useMemo(() => new Date(), [])

  function isInRange(d: Date | null, key: RangeKey): boolean {
    if (!d) return false
    if (key === 'all') return true

    const msInDay = 1000 * 60 * 60 * 24
    const diffDays = (now.getTime() - d.getTime()) / msInDay

    if (key === '7d') return diffDays <= 7 && diffDays >= 0
    if (key === '30d') return diffDays <= 30 && diffDays >= 0

    // 'month' – same year + month as now
    const sameYear = d.getFullYear() === now.getFullYear()
    const sameMonth = d.getMonth() === now.getMonth()
    return sameYear && sameMonth
  }

  const filteredSales = useMemo(
    () => sales.filter(row => isInRange(row.createdAt, range)),
    [sales, range],
  )

  const filteredExpenses = useMemo(
    () =>
      expenses.filter(row =>
        isInRange(
          // convert yyyy-mm-dd to Date
          row.date ? new Date(`${row.date}T00:00:00`) : row.createdAt,
          range,
        ),
      ),
    [expenses, range],
  )

  const grossSales = filteredSales.reduce((sum, row) => sum + row.total, 0)
  const totalVat = filteredSales.reduce((sum, row) => sum + row.taxTotal, 0)
  const totalExpenses = filteredExpenses.reduce(
    (sum, row) => sum + row.amount,
    0,
  )
  const totalMonthlyExpenses = useMemo(() => {
    if (!expenses.length) return 0
    const currentMonth = currentMonthKey(new Date())
    return expenses
      .filter(exp => exp.date?.startsWith(currentMonth))
      .reduce((sum, exp) => sum + exp.amount, 0)
  }, [expenses])
  const totalAllExpenses = useMemo(
    () => expenses.reduce((sum, exp) => sum + exp.amount, 0),
    [expenses],
  )
  const netProfit = grossSales - totalExpenses

  const hasDebtData =
    (debtSummary?.debtorCount ?? 0) > 0 ||
    (debtSummary?.totalOutstandingCents ?? 0) > 0

  const hasAnyData = sales.length > 0 || expenses.length > 0 || hasDebtData

  function rangeLabel(key: RangeKey): string {
    switch (key) {
      case 'month':
        return 'This month'
      case '30d':
        return 'Last 30 days'
      case '7d':
        return 'Last 7 days'
      case 'all':
        return 'All time'
    }
  }

  function escapeCsvValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return ''
    const raw = typeof value === 'number' ? String(value) : value
    const escaped = raw.replace(/"/g, '""')
    return `"${escaped}"`
  }

  function toIsoString(date: Date | null): string {
    return date ? date.toISOString() : ''
  }

  function currentMonthKey(dateValue: Date): string {
    const year = dateValue.getFullYear()
    const month = String(dateValue.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }

  function downloadCsv(
    filename: string,
    headers: string[],
    rows: Array<Array<string | number | null>>,
  ) {
    const csv = [
      headers.map(escapeCsvValue).join(','),
      ...rows.map(row => row.map(escapeCsvValue).join(',')),
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function handleDownload(tab: DownloadTab) {
    const today = new Date().toISOString().slice(0, 10)

    if (tab === 'sales') {
      downloadCsv(
        `sales-${today}.csv`,
        ['Sale ID', 'Created at', 'Gross total', 'VAT portion'],
        sales.map(row => [row.id, toIsoString(row.createdAt), row.total, row.taxTotal]),
      )
      return
    }

    if (tab === 'products') {
      downloadCsv(
        `products-${today}.csv`,
        ['Product ID', 'Name', 'SKU', 'Item type', 'Price', 'Stock count', 'Last updated'],
        products.map(row => [
          row.id,
          row.name,
          row.sku,
          row.itemType,
          row.price,
          row.stockCount,
          toIsoString(row.updatedAt),
        ]),
      )
      return
    }

    downloadCsv(
      `expenses-${today}.csv`,
      ['Expense ID', 'Expense date', 'Amount', 'Created at'],
      expenses.map(row => [row.id, row.date, row.amount, toIsoString(row.createdAt)]),
    )
  }

  const downloadTabs: Array<{ key: DownloadTab; label: string; description: string; emptyCopy: string; total: number }> = [
    {
      key: 'sales',
      label: 'Sales',
      description: 'CSV export of your recorded sales, including VAT.',
      emptyCopy: 'Record some sales to generate a CSV export.',
      total: sales.length,
    },
    {
      key: 'products',
      label: 'Products',
      description: 'All inventory items and services tracked in this workspace.',
      emptyCopy: 'Add products or services to download a CSV.',
      total: products.length,
    },
    {
      key: 'expenses',
      label: 'Expenses',
      description: 'Expenses and payouts pulled from the Expenses page.',
      emptyCopy: 'Track an expense to export your finance costs.',
      total: expenses.length,
    },
  ]

  const activeTabMeta = downloadTabs.find(tab => tab.key === activeDownloadTab)!
  const canDownload = storeId && activeTabMeta.total > 0

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Finance</h2>
          <p className="page__subtitle">
            Track cash and expenses for your Sedifex workspace.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Link className="button button--primary button--small" to="/close-day">
            Close day
          </Link>
          <Link className="button button--ghost button--small" to="/finance/documents">
            Invoice & receipt generator
          </Link>
          <Link className="button button--ghost button--small" to="/expenses">
            Open expenses
          </Link>
        </div>
      </header>

      {/* Overview card */}
      <section className="card" aria-label="Finance summary">
        <div className="page__header" style={{ padding: 0, marginBottom: 12 }}>
          <div>
            <h3 className="card__title">Overview</h3>
            <p className="card__subtitle">
              See gross sales, VAT, expenses, and net profit for this workspace.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {(['month', '30d', '7d', 'all'] as RangeKey[]).map(key => (
              <button
                key={key}
                type="button"
                className={
                  range === key
                    ? 'button button--primary button--small'
                    : 'button button--ghost button--small'
                }
                onClick={() => setRange(key)}
              >
                {rangeLabel(key)}
              </button>
            ))}
          </div>
        </div>

        {storeId ? null : (
          <p className="status status--error" role="alert">
            Select or create a workspace first. Finance is calculated per
            workspace.
          </p>
        )}

        {hasAnyData ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
              marginTop: 8,
            }}
          >
            <div className="info-card">
              <h4>Gross sales</h4>
              <p style={{ fontSize: 24, fontWeight: 600 }}>
                GHS {grossSales.toFixed(2)}
              </p>
              <p className="card__subtitle">
                Sum of recorded sales (including VAT) in the selected range.
              </p>
            </div>

            <div className="info-card">
              <h4>VAT collected</h4>
              <p style={{ fontSize: 24, fontWeight: 600 }}>
                GHS {totalVat.toFixed(2)}
              </p>
              <p className="card__subtitle">
                Total VAT portion from all recorded sales in this period.
              </p>
            </div>

            <div className="info-card">
              <h4>Outstanding customer debt</h4>

              {debtError ? (
                <p className="status status--error" role="alert" style={{ marginTop: 8 }}>
                  {debtError}
                </p>
              ) : isLoadingDebt ? (
                <p className="card__subtitle" style={{ marginTop: 8 }}>
                  Loading customer balances…
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 24, fontWeight: 600 }}>
                    {formatGhsFromCents(debtSummary?.totalOutstandingCents ?? 0)}
                  </p>
                  <p className="card__subtitle">
                    {debtSummary?.debtorCount
                      ? `${debtSummary.debtorCount} customer${
                          debtSummary.debtorCount === 1 ? '' : 's'
                        } owe you`
                      : 'No unpaid balances recorded right now.'}
                  </p>
                  <p className="card__subtitle" style={{ marginTop: 4 }}>
                    {debtSummary?.overdueCount
                      ? `Overdue: ${formatGhsFromCents(debtSummary.overdueCents)} (${
                          debtSummary.overdueCount
                        } customer${debtSummary.overdueCount === 1 ? '' : 's'})`
                      : 'No overdue debt at the moment.'}
                  </p>
                </>
              )}
            </div>

            <div className="info-card">
              <h4>Expenses</h4>
              <p style={{ fontSize: 24, fontWeight: 600 }}>
                GHS {totalExpenses.toFixed(2)}
              </p>
              <p className="card__subtitle">
                This month: <strong>GHS {totalMonthlyExpenses.toFixed(2)}</strong> · All time:{' '}
                <strong>GHS {totalAllExpenses.toFixed(2)}</strong>
              </p>
            </div>

            <div className="info-card">
              <h4>Net profit</h4>
              <p
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: netProfit >= 0 ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)',
                }}
              >
                GHS {netProfit.toFixed(2)}
              </p>
              <p className="card__subtitle">
                Gross sales minus expenses. (VAT is shown separately above.)
              </p>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 8 }}>
            <h4 className="empty-state__title">No finance data yet</h4>
            <p>
              Record sales from the <Link to="/sell">Sell</Link> page and track
              store costs on the <Link to="/expenses">Expenses</Link> page to see
              profit here.
            </p>
          </div>
        )}
      </section>

      <Expenses embedded />

      {/* Downloads */}
      <section className="card" style={{ marginTop: 24 }} aria-label="Download finance data">
        <div className="page__header" style={{ padding: 0 }}>
          <div>
            <h3 className="card__title">Downloads</h3>
            <p className="card__subtitle">
              Export key finance data as CSV to share with accountants or other stakeholders.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {downloadTabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                className={
                  activeDownloadTab === tab.key
                    ? 'button button--primary button--small'
                    : 'button button--ghost button--small'
                }
                onClick={() => setActiveDownloadTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {!storeId ? (
          <p className="status status--error" role="alert">
            Select or create a workspace to fetch finance records for download.
          </p>
        ) : activeTabMeta.total === 0 ? (
          <div className="empty-state" style={{ marginTop: 8 }}>
            <h4 className="empty-state__title">No {activeTabMeta.label.toLowerCase()} to download</h4>
            <p>{activeTabMeta.emptyCopy}</p>
          </div>
        ) : (
          <div className="info-card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 style={{ marginBottom: 4 }}>{activeTabMeta.label} CSV</h4>
                <p className="card__subtitle" style={{ marginBottom: 8 }}>
                  {activeTabMeta.description} ({activeTabMeta.total} records)
                </p>
              </div>

              <button
                type="button"
                className="button button--primary"
                disabled={!canDownload}
                onClick={() => handleDownload(activeDownloadTab)}
              >
                Download CSV
              </button>
            </div>

            <p style={{ margin: 0, color: 'var(--text-muted, #6b7280)', fontSize: 13 }}>
              CSV exports include identifiers, totals, and timestamps so finance partners can reconcile transactions.
            </p>
          </div>
        )}
      </section>

    </div>
  )
}
