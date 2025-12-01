// web/src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import Sparkline from '../components/Sparkline'
import { useStoreMetrics } from '../hooks/useStoreMetrics'
import { useLowStock } from '../hooks/useLowStock'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships } from '../hooks/useMemberships'
import { db } from '../firebase'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from 'firebase/firestore'

const QUICK_LINKS: Array<{
  to: string
  title: string
  description: string
}> = [
  {
    to: '/products',
    title: 'Products',
    description: 'Manage your catalogue, update prices, and keep stock levels accurate.',
  },
  {
    to: '/sell',
    title: 'Sell',
    description: 'Ring up a customer, track the cart, and record a sale in seconds.',
  },
  {
    to: '/receive',
    title: 'Receive',
    description: 'Log new inventory as it arrives so every aisle stays replenished.',
  },
  {
    to: '/close-day',
    title: 'Close Day',
    description: 'Balance the till, review totals, and lock in a clean daily report.',
  },
  {
    to: '/customers',
    title: 'Customers',
    description:
      'Look up purchase history, reward loyal shoppers, and keep profiles up to date.',
  },
]

function formatPercent(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

// ---- Snapshot types & helpers ----
type ItemType = 'product' | 'service'

type DashboardSaleItem = {
  name: string
  qty: number
  price: number
  productId?: string | null
  itemType?: ItemType
}

type DashboardSale = {
  id: string
  branchId?: string | null
  storeId?: string | null
  total: number
  vatTotal: number      // ← we keep this name but map it from taxTotal in Firestore
  createdAt: Date | null
  items: DashboardSaleItem[]
}

type DashboardExpense = {
  id: string
  amount: number
  date: string // yyyy-mm-dd
}

type ProductMetaMap = Record<string, ItemType>

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

export default function Dashboard() {
  const {
    rangePresets,
    selectedRangeId,
    resolvedRangeId,
    customRange,
    handleRangePresetChange,
    handleCustomDateChange,
    rangeSummary,
    rangeDaysLabel,
    showCustomHint,
    metrics,
    goals,
    goalMonthLabel,
    selectedGoalMonth,
    handleGoalMonthChange,
    goalFormValues,
    handleGoalInputChange,
    handleGoalSubmit,
    isSavingGoals,
    inventoryAlerts,
    teamCallouts,
    paceNudge,
    shareProgressReport,
  } = useStoreMetrics()
  const {
    lowStock,
    topLowStock,
    isLoading: isLoadingLowStock,
    error: lowStockError,
  } = useLowStock()
  const { memberships } = useMemberships()

  const { storeId } = useActiveStore()

  const [isExportingLowStock, setIsExportingLowStock] = useState(false)
  const [lowStockExportMessage, setLowStockExportMessage] = useState<string | null>(null)
  const [scheduledExport, setScheduledExport] = useState<{
    cadence: 'weekly'
    recipients: string[]
    nextRun: string
    skuCount: number
  } | null>(null)
  const [isSchedulingExport, setIsSchedulingExport] = useState(false)
  const [supplierDraft, setSupplierDraft] = useState<{
    createdAt: string
    items: Array<{
      id: string
      name: string
      sku: string | null
      stockCount: number
      reorderLevel: number
      suggestedQuantity: number
    }>
  } | null>(null)
  const [automationStatus, setAutomationStatus] = useState<string | null>(null)
  const [isBuildingSupplierDraft, setIsBuildingSupplierDraft] = useState(false)

  // ---- New snapshot state ----
  const [sales, setSales] = useState<DashboardSale[]>([])
  const [expenses, setExpenses] = useState<DashboardExpense[]>([])
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true)

  // 🔹 NEW: product meta (to know product vs service)
  const [productMeta, setProductMeta] = useState<ProductMetaMap>({})

  const now = new Date()
  const yesterday = useMemo(() => {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return d
  }, [now])

  // ---- Load product meta (itemType per product) ----
  useEffect(() => {
    if (!storeId) {
      setProductMeta({})
      return
    }

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', storeId),
      orderBy('updatedAt', 'desc'),
      limit(500),
    )

    const unsubscribe = onSnapshot(
      q,
      snap => {
        const map: ProductMetaMap = {}
        snap.forEach(docSnap => {
          const data = docSnap.data() as any
          const rawType = data.itemType
          const itemType: ItemType = rawType === 'service' ? 'service' : 'product'
          map[docSnap.id] = itemType
        })
        setProductMeta(map)
      },
      () => {
        setProductMeta({})
      },
    )

    return unsubscribe
  }, [storeId])

  // ---- Load sales for snapshot (last ~500 records for this store) ----
  useEffect(() => {
    if (!storeId) {
      setSales([])
      setIsLoadingSnapshot(false)
      return
    }

    setIsLoadingSnapshot(true)

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
      limit(500),
    )

    const unsubscribe = onSnapshot(
      q,
      snap => {
        const rows: DashboardSale[] = snap.docs.map(docSnap => {
          const data = docSnap.data() as any
          const createdAt =
            data.createdAt && typeof data.createdAt.toDate === 'function'
              ? (data.createdAt.toDate() as Date)
              : null

          // total: prefer structured totals.total, then top-level total
          const total =
            typeof data.total === 'number'
              ? data.total
              : typeof data.totals?.total === 'number'
                ? data.totals.total
                : 0

          // 🔹 VAT / tax total: map from taxTotal (same as Finance page)
          const vatTotal =
            typeof data.totals?.taxTotal === 'number'
              ? data.totals.taxTotal
              : typeof data.taxTotal === 'number'
                ? data.taxTotal
                : typeof data.totals?.vatTotal === 'number'
                  ? data.totals.vatTotal
                  : typeof data.vatTotal === 'number'
                    ? data.vatTotal
                    : 0

          const itemsRaw = Array.isArray(data.items) ? data.items : []

          const items: DashboardSaleItem[] = itemsRaw.map((item: any, index: number) => ({
            name: String(item.name ?? `Item ${index + 1}`),
            qty: Number(item.qty) || 0,
            price: Number(item.price) || 0,
            productId: typeof item.productId === 'string' ? item.productId : null,
            itemType:
              item.itemType === 'service'
                ? 'service'
                : item.itemType === 'product'
                  ? 'product'
                  : undefined,
          }))

          return {
            id: docSnap.id,
            branchId: data.branchId ?? null,
            storeId: data.storeId ?? null,
            total: Number(total) || 0,
            vatTotal: Number(vatTotal) || 0,
            createdAt,
            items,
          }
        })

        setSales(rows)
        setIsLoadingSnapshot(false)
      },
      () => {
        setSales([])
        setIsLoadingSnapshot(false)
      },
    )

    return unsubscribe
  }, [storeId])

  // ---- Load expenses for snapshot ----
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
      limit(500),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: DashboardExpense[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any
        return {
          id: docSnap.id,
          amount: Number(data.amount) || 0,
          date: String(data.date ?? ''),
        }
      })
      setExpenses(rows)
    })

    return unsubscribe
  }, [storeId])

  // ---- Aggregate snapshot metrics ----
  const {
    todaySalesTotal,
    todaySalesCount,
    yesterdaySalesTotal,
    monthSalesTotal,
    todayVatTotal,
    monthVatTotal,
    todayProductSalesTotal,
    todayServiceSalesTotal,
  } = useMemo(() => {
    let todayTotal = 0
    let todayCount = 0
    let yesterdayTotal = 0
    let monthTotal = 0
    let todayVat = 0
    let monthVat = 0

    let todayProductTotal = 0
    let todayServiceTotal = 0

    for (const sale of sales) {
      if (!sale.createdAt) continue

      if (isSameMonth(sale.createdAt, now)) {
        monthTotal += sale.total
        monthVat += sale.vatTotal ?? 0
      }

      if (isSameDay(sale.createdAt, now)) {
        todayTotal += sale.total
        todayVat += sale.vatTotal ?? 0
        todayCount += 1

        // 🔹 split today's sales into products vs services using line items
        for (const item of sale.items) {
          const lineTotal = (Number(item.price) || 0) * (Number(item.qty) || 0)

          // infer item type: prefer explicit on line, else from productMeta, default to 'product'
          let inferredType: ItemType = 'product'
          if (item.itemType === 'service' || item.itemType === 'product') {
            inferredType = item.itemType
          } else if (item.productId && productMeta[item.productId]) {
            inferredType = productMeta[item.productId]
          }

          if (inferredType === 'service') {
            todayServiceTotal += lineTotal
          } else {
            todayProductTotal += lineTotal
          }
        }
      } else if (isSameDay(sale.createdAt, yesterday)) {
        yesterdayTotal += sale.total
      }
    }

    return {
      todaySalesTotal: todayTotal,
      todaySalesCount: todayCount,
      yesterdaySalesTotal: yesterdayTotal,
      monthSalesTotal: monthTotal,
      todayVatTotal: todayVat,
      monthVatTotal: monthVat,
      todayProductSalesTotal: todayProductTotal,
      todayServiceSalesTotal: todayServiceTotal,
    }
  }, [now, sales, yesterday, productMeta])

  const monthExpensesTotal = useMemo(() => {
    if (!expenses.length) return 0
    const currentMonth = now.toISOString().slice(0, 7) // yyyy-mm
    return expenses
      .filter(exp => exp.date?.startsWith(currentMonth))
      .reduce((sum, exp) => sum + exp.amount, 0)
  }, [expenses, now])

  function buildLowStockCsv() {
    const header = ['Product', 'SKU', 'On hand', 'Reorder point']
    const rows = lowStock.map(item => [
      item.name,
      item.sku ?? '—',
      item.stockCount,
      item.reorderLevel,
    ])

    return [header, ...rows]
      .map(columns =>
        columns
          .map(value => {
            const normalized = `${value ?? ''}`
            if (normalized.includes(',') || normalized.includes('"')) {
              return `"${normalized.replace(/"/g, '""')}"`
            }
            return normalized
          })
          .join(','),
      )
      .join('\n')
  }

  function handleLowStockExport() {
    if (isExportingLowStock) return

    if (!lowStock.length) {
      setLowStockExportMessage('No low-stock SKUs to export right now.')
      return
    }

    setIsExportingLowStock(true)
    setLowStockExportMessage(null)

    try {
      const csv = buildLowStockCsv()
      const blob = new Blob([csv], { type: 'text/csv' })
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `low-stock-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(downloadUrl)

      setLowStockExportMessage(
        'Low-stock CSV downloaded. Share it with suppliers to restock sooner.',
      )
    } catch (error) {
      console.error('[dashboard] Failed to export low-stock CSV', error)
      setLowStockExportMessage('Unable to export low-stock list. Try again soon.')
    } finally {
      setIsExportingLowStock(false)
    }
  }

  const managerEmails = useMemo(() => {
    const unique = new Set<string>()
    memberships
      .filter(member => !!member.email)
      .forEach(member => unique.add((member.email as string).toLowerCase()))

    if (unique.size === 0) {
      unique.add('managers@sedifex.app')
    }

    return Array.from(unique)
  }, [memberships])

  const nextScheduledRun = useMemo(() => {
    if (!scheduledExport?.nextRun) return null
    return new Date(scheduledExport.nextRun)
  }, [scheduledExport?.nextRun])

  useEffect(() => {
    if (!scheduledExport) return
    if (scheduledExport.skuCount === lowStock.length) return

    setScheduledExport(current =>
      current
        ? {
            ...current,
            skuCount: lowStock.length,
          }
        : null,
    )
  }, [lowStock.length, scheduledExport?.skuCount])

  useEffect(() => {
    if (!supplierDraft) return

    setSupplierDraft(current => {
      if (!current) return null

      const updatedItems = topLowStock.map(item => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        stockCount: item.stockCount,
        reorderLevel: item.reorderLevel,
        suggestedQuantity: Math.max(item.reorderLevel * 2 - item.stockCount, 1),
      ))

      const hasDifference =
        current.items.length !== updatedItems.length ||
        current.items.some((item, index) => {
          const nextItem = updatedItems[index]
          return (
            item.id !== nextItem.id ||
            item.stockCount !== nextItem.stockCount ||
            item.reorderLevel !== nextItem.reorderLevel ||
            item.suggestedQuantity !== nextItem.suggestedQuantity
          )
        })

      if (!hasDifference) return current

      return {
        ...current,
        items: updatedItems,
      }
    })
  }, [supplierDraft, topLowStock])

  function scheduleWeeklyLowStockExport() {
    if (isSchedulingExport) return

    if (!lowStock.length) {
      setLowStockExportMessage('No low-stock SKUs to export right now.')
      return
    }

    setIsSchedulingExport(true)

    const nextRunDate = new Date()
    nextRunDate.setDate(nextRunDate.getDate() + 7)

    const recipients = managerEmails

    setScheduledExport({
      cadence: 'weekly',
      recipients,
      nextRun: nextRunDate.toISOString(),
      skuCount: lowStock.length,
    })

    setAutomationStatus(
      `Weekly export scheduled. ${recipients.join(', ')} will receive ${
        lowStock.length
      } SKUs every week starting ${nextRunDate.toLocaleDateString()}.`,
    )
    setIsSchedulingExport(false)
  }

  function createSupplierReorderDraft() {
    if (isBuildingSupplierDraft) return

    if (!topLowStock.length) {
      setAutomationStatus('No low-stock SKUs to build a supplier reorder yet.')
      return
    }

    setIsBuildingSupplierDraft(true)

    const draftItems = topLowStock.map(item => ({
      id: item.id,
      name: item.name,
      sku: item.sku,
      stockCount: item.stockCount,
      reorderLevel: item.reorderLevel,
      suggestedQuantity: Math.max(item.reorderLevel * 2 - item.stockCount, 1),
    }))

    setSupplierDraft({
      createdAt: new Date().toISOString(),
      items: draftItems,
    })

    setAutomationStatus(
      `Purchase order draft prepared from your top ${draftItems.length} low-stock SKUs. Edit quantities and send to suppliers.`,
    )
    setIsBuildingSupplierDraft(false)
  }

  return (
    <div>
      <h2 style={{ color: '#4338CA', marginBottom: 8 }}>Dashboard</h2>
      <p style={{ color: '#475569', marginBottom: 24 }}>
        Welcome back! Choose what you’d like to work on — the most important Sedifex pages
        are just one tap away.
      </p>

      {paceNudge && (
        <div
          role="alert"
          style={{
            background: '#FEF2F2',
            color: '#7F1D1D',
            border: '1px solid #FCA5A5',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14 }}>Sales pace alert</div>
          <div style={{ fontSize: 14 }}>{paceNudge.message}</div>
          <div style={{ fontSize: 13, color: '#991B1B' }}>{paceNudge.progress}</div>
        </div>
      )}

      {/* 🔹 New "Today at a glance" snapshot card */}
      <section
        style={{
          background: '#FFFFFF',
          borderRadius: 20,
          border: '1px solid #E2E8F0',
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          marginBottom: 24,
        }}
        aria-label="Today snapshot"
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: '#0F172A',
              }}
            >
              Today at a glance
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
              See how today’s sales compare to yesterday and this month’s costs.
            </p>
          </div>
          {!storeId && (
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: '#DC2626',
                fontWeight: 500,
              }}
            >
              Switch to a workspace to see live numbers.
            </p>
          )}
        </div>

        {isLoadingSnapshot ? (
          <p style={{ fontSize: 13, color: '#475569' }}>Loading snapshot…</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 16,
              marginTop: 8,
            }}
          >
            <article
              style={{
                background: '#F8FAFC',
                borderRadius: 14,
                padding: '14px 16px',
                border: '1px solid #E2E8F0',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  color: '#64748B',
                  fontWeight: 600,
                }}
              >
                Sales today (cash received)
              </p>
              <p
                style={{
                  margin: '6px 0 2px',
                  fontSize: 24,
                  fontWeight: 700,
                  color: '#0F172A',
                }}
              >
                GHS {todaySalesTotal.toFixed(2)}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                {todaySalesCount}{' '}
                {todaySalesCount === 1 ? 'sale recorded' : 'sales recorded'}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#0F172A' }}>
                Products:{' '}
                <strong>GHS {todayProductSalesTotal.toFixed(2)}</strong> · Services:{' '}
                <strong>GHS {todayServiceSalesTotal.toFixed(2)}</strong>
              </p>
            </article>

            <article
              style={{
                background: '#F8FAFC',
                borderRadius: 14,
                padding: '14px 16px',
                border: '1px solid #E2E8F0',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  color: '#64748B',
                  fontWeight: 600,
                }}
              >
                Yesterday (cash received)
              </p>
              <p
                style={{
                  margin: '6px 0 2px',
                  fontSize: 24,
                  fontWeight: 700,
                  color: '#0F172A',
                }}
              >
                GHS {yesterdaySalesTotal.toFixed(2)}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                {todaySalesTotal > yesterdaySalesTotal
                  ? 'Today is ahead of yesterday.'
                  : todaySalesTotal === yesterdaySalesTotal
                    ? 'Today is matching yesterday so far.'
                    : 'Yesterday is still ahead—push for more sales.'}
              </p>
            </article>

            <article
              style={{
                background: '#F8FAFC',
                borderRadius: 14,
                padding: '14px 16px',
                border: '1px solid #E2E8F0',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  color: '#64748B',
                  fontWeight: 600,
                }}
              >
                This month (cash received)
              </p>
              <p
                style={{
                  margin: '6px 0 2px',
                  fontSize: 24,
                  fontWeight: 700,
                  color: '#0F172A',
                }}
              >
                GHS {monthSalesTotal.toFixed(2)}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                Expenses:{' '}
                <strong>GHS {monthExpensesTotal.toFixed(2)}</strong>
              </p>
              <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                Approx. gross margin (before tax):{' '}
                <strong>
                  GHS {(monthSalesTotal - monthExpensesTotal).toFixed(2)}
                </strong>
              </p>
            </article>

            <article
              style={{
                background: '#F8FAFC',
                borderRadius: 14,
                padding: '14px 16px',
                border: '1px solid #E2E8F0',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  color: '#64748B',
                  fontWeight: 600,
                }}
              >
                VAT collected this month
              </p>
              <p
                style={{
                  margin: '6px 0 2px',
                  fontSize: 24,
                  fontWeight: 700,
                  color: '#0F172A',
                }}
              >
                GHS {monthVatTotal.toFixed(2)}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                Total VAT portion included in this month&apos;s sales.
              </p>
            </article>
          </div>
        )}
      </section>

      {/* Existing time range + analytics sections */}
      <section
        style={{
          background: '#FFFFFF',
          borderRadius: 20,
          border: '1px solid '#E2E8F0',
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          marginBottom: 24,
        }}
        aria-label="Time range controls"
      >
        {/* ... rest of file unchanged ... */}
        {/* I’m leaving everything below here exactly as you had it */}
        {/* ------- KEEP YOUR EXISTING CODE FROM THIS POINT DOWN ------- */}
        {/* (Time range controls, business metrics, restock, inventory alerts, team callouts) */}
        {/* Paste the remainder of your original file here (unchanged) */}
      </section>

      {/* ... the rest of your original Dashboard.tsx remains exactly the same ... */}
    </div>
  )
}
