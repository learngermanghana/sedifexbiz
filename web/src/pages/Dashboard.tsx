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
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
type DashboardSaleItem = {
  name: string
  qty: number
  price: number
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
  const [isLoadingExportSchedule, setIsLoadingExportSchedule] = useState(false)

  // ---- New snapshot state ----
  const [sales, setSales] = useState<DashboardSale[]>([])
  const [expenses, setExpenses] = useState<DashboardExpense[]>([])
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true)

  const now = new Date()
  const yesterday = useMemo(() => {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return d
  }, [now])

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
  } = useMemo(() => {
    let todayTotal = 0
    let todayCount = 0
    let yesterdayTotal = 0
    let monthTotal = 0
    let todayVat = 0
    let monthVat = 0

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
    }
  }, [now, sales, yesterday])

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
    if (!storeId) {
      setScheduledExport(null)
      return
    }

    setIsLoadingExportSchedule(true)

    const scheduleRef = doc(
      collection(db, 'stores', storeId, 'automations'),
      'lowStockWeeklyExport',
    )

    const unsubscribe = onSnapshot(
      scheduleRef,
      snapshot => {
        setIsLoadingExportSchedule(false)

        if (!snapshot.exists()) {
          setScheduledExport(null)
          return
        }

        const data = snapshot.data() as Record<string, unknown>
        const recipients = Array.isArray(data.recipients)
          ? (data.recipients.filter(value => typeof value === 'string') as string[])
          : []

        if (typeof data.nextRun !== 'string' || data.cadence !== 'weekly') {
          setScheduledExport(null)
          return
        }

        setScheduledExport({
          cadence: 'weekly',
          recipients,
          nextRun: data.nextRun,
          skuCount: typeof data.skuCount === 'number' ? data.skuCount : 0,
        })
      },
      error => {
        console.error('[dashboard] Failed to load export schedule', error)
        setAutomationStatus('Unable to load automation status right now.')
        setIsLoadingExportSchedule(false)
      },
    )

    return () => {
      setIsLoadingExportSchedule(false)
      unsubscribe()
    }
  }, [storeId])

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
      }))

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

  async function scheduleWeeklyLowStockExport() {
    if (isSchedulingExport || isLoadingExportSchedule) return

    if (!storeId) {
      setAutomationStatus('Select a store before scheduling exports.')
      return
    }

    if (!lowStock.length) {
      setLowStockExportMessage('No low-stock SKUs to export right now.')
      return
    }

    setIsSchedulingExport(true)

    const nextRunDate = new Date()
    nextRunDate.setDate(nextRunDate.getDate() + 7)

    const recipients = managerEmails

    const scheduleRef = doc(
      collection(db, 'stores', storeId, 'automations'),
      'lowStockWeeklyExport',
    )

    const schedulePayload = {
      cadence: 'weekly' as const,
      recipients,
      nextRun: nextRunDate.toISOString(),
      skuCount: lowStock.length,
      storeId,
      type: 'lowStockCsv',
    }

    try {
      await setDoc(
        scheduleRef,
        {
          ...schedulePayload,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      )

      setScheduledExport(schedulePayload)

      setAutomationStatus(
        `Weekly export scheduled. ${recipients.join(', ')} will receive ${
          lowStock.length
        } SKUs every week starting ${nextRunDate.toLocaleDateString()}.`,
      )
    } catch (error) {
      console.error('[dashboard] Failed to schedule low-stock export', error)
      setAutomationStatus('Unable to schedule the weekly export right now.')
    } finally {
      setIsSchedulingExport(false)
    }
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
          border: '1px solid #E2E8F0',
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          marginBottom: 24,
        }}
        aria-label="Time range controls"
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'space-between',
            alignItems: 'center',
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
              Time range
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
              Pick the window you want to analyse. All charts and KPIs update instantly.
            </p>
          </div>
          <div
            role="group"
            aria-label="Quick ranges"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            {rangePresets.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => handleRangePresetChange(option.id)}
                aria-pressed={resolvedRangeId === option.id}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  border:
                    resolvedRangeId === option.id
                      ? '1px solid #4338CA'
                      : '1px solid #E2E8F0',
                  background:
                    resolvedRangeId === option.id ? '#4338CA' : '#F8FAFC',
                  color:
                    resolvedRangeId === option.id ? '#FFFFFF' : '#1E293B',
                  fontSize: 13,
                  fontWeight: 600,
                  boxShadow:
                    resolvedRangeId === option.id
                      ? '0 4px 12px rgba(67, 56, 202, 0.25)'
                      : 'none',
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: '#475569',
            }}
          >
            <span>From</span>
            <input
              type="date"
              value={customRange.start}
              onChange={event =>
                handleCustomDateChange('start', event.target.value)
              }
              style={{
                borderRadius: 8,
                border: '1px solid #CBD5F5',
                padding: '6px 10px',
                fontSize: 13,
              }}
            />
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: '#475569',
            }}
          >
            <span>To</span>
            <input
              type="date"
              value={customRange.end}
              onChange={event =>
                handleCustomDateChange('end', event.target.value)
              }
              style={{
                borderRadius: 8,
                border: '1px solid #CBD5F5',
                padding: '6px 10px',
                fontSize: 13,
              }}
            />
          </label>
          <span
            style={{
              fontSize: 13,
              color: '#1E293B',
              fontWeight: 600,
            }}
          >
            Showing {rangeSummary} ({rangeDaysLabel})
          </span>
        </div>

        {showCustomHint && (
          <p style={{ margin: 0, fontSize: 12, color: '#DC2626' }}>
            Select both start and end dates to apply your custom range. We’re showing
            today’s data until then.
          </p>
        )}
      </section>

      {/* Business metrics overview */}
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          marginBottom: 32,
        }}
        aria-label="Business metrics overview"
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {metrics.map(metric => {
            const change = metric.changePercent
            const color =
              change === null ? '#475569' : change < 0 ? '#DC2626' : '#16A34A'
            const icon = change === null ? '▬' : change < 0 ? '▼' : '▲'
            const changeText = change !== null ? formatPercent(change) : '—'

            const explainedTitle =
              metric.title === 'Revenue'
                ? 'Revenue (total cash received)'
                : metric.title === 'Net profit'
                  ? 'Net profit (money left after expenses)'
                  : metric.title === 'Average basket size'
                    ? 'Average basket size (avg spend per sale)'
                    : metric.title === 'Units sold'
                      ? 'Units sold (items sold in this range)'
                      : metric.title

            return (
              <article
                key={metric.title}
                style={{
                  background: '#FFFFFF',
                  borderRadius: 16,
                  padding: '18px 20px',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                  }}
                >
                  {explainedTitle}
                </div>
                <div
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    color: '#0F172A',
                    lineHeight: 1,
                  }}
                >
                  {metric.value}
                </div>
                <div style={{ fontSize: 13, color: '#64748B' }}>
                  {metric.subtitle}
                </div>
                <div style={{ height: 56 }} aria-hidden="true">
                  {metric.sparkline && metric.sparkline.length ? (
                    <Sparkline
                      data={metric.sparkline}
                      comparisonData={metric.comparisonSparkline ?? undefined}
                    />
                  ) : (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#94A3B8',
                        display: 'flex',
                        alignItems: 'center',
                        height: '100%',
                      }}
                    >
                      Snapshot metric
                    </div>
                  )}
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 26,
                      height: 26,
                      borderRadius: '999px',
                      background: '#EEF2FF',
                      color,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                    aria-hidden="true"
                  >
                    {icon}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color,
                    }}
                  >
                    {changeText}
                  </span>
                  <span style={{ fontSize: 13, color: '#64748B' }}>
                    {metric.changeDescription}
                  </span>
                </div>
              </article>
            )
          })}
        </div>

        <div
          style={{
            background: '#F1F5F9',
            borderRadius: 18,
            border: '1px solid #E2E8F0',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              justifyContent: 'space-between',
              alignItems: 'center',
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
                Monthly goals
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                Set targets per branch and keep teams aligned on what success looks like.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  fontSize: 12,
                  color: '#475569',
                  minWidth: 140,
                }}
              >
                <span style={{ fontWeight: 600 }}>Month</span>
                <input
                  type="month"
                  value={selectedGoalMonth}
                  onChange={event => handleGoalMonthChange(event.target.value)}
                  style={{
                    borderRadius: 8,
                    border: '1px solid #CBD5F5',
                    padding: '6px 10px',
                    fontSize: 13,
                    background: '#FFFFFF',
                  }}
                />
              </label>
              <button
                type="button"
                onClick={shareProgressReport}
                style={{
                  background: '#4338CA',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 14px',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: '0 8px 16px rgba(67, 56, 202, 0.28)',
                }}
              >
                Share progress
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {goals.map(goal => (
              <article
                key={goal.title}
                style={{
                  background: '#FFFFFF',
                  borderRadius: 14,
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  border: '1px solid #E2E8F0',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                  }}
                >
                  {goal.title}
                </div>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: '#0F172A',
                    lineHeight: 1,
                  }}
                >
                  {goal.value}
                </div>
                <div style={{ fontSize: 13, color: '#475569' }}>
                  {goal.target}
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(goal.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  style={{
                    position: 'relative',
                    height: 8,
                    borderRadius: 999,
                    background: '#E2E8F0',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${Math.round(goal.progress * 100)}%`,
                      background: '#4338CA',
                    }}
                  />
                </div>
              </article>
            ))}
          </div>

          <form onSubmit={handleGoalSubmit} style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              <label
                style={{
                  display: 'grid',
                  gap: 6,
                  fontSize: 13,
                  color: '#475569',
                }}
                htmlFor="goal-revenue"
              >
                <span style={{ fontWeight: 600 }}>Revenue goal (GHS)</span>
                <input
                  id="goal-revenue"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={goalFormValues.revenueTarget}
                  onChange={event =>
                    handleGoalInputChange('revenueTarget', event.target.value)
                  }
                  style={{
                    borderRadius: 8,
                    border: '1px solid #CBD5F5',
                    padding: '8px 10px',
                    fontSize: 14,
                    background: '#FFFFFF',
                  }}
                />
              </label>
              <label
                style={{
                  display: 'grid',
                  gap: 6,
                  fontSize: 13,
                  color: '#475569',
                }}
                htmlFor="goal-customers"
              >
                <span style={{ fontWeight: 600 }}>New customers goal</span>
                <input
                  id="goal-customers"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={goalFormValues.customerTarget}
                  onChange={event =>
                    handleGoalInputChange('customerTarget', event.target.value)
                  }
                  style={{
                    borderRadius: 8,
                    border: '1px solid #CBD5F5',
                    padding: '8px 10px',
                    fontSize: 14,
                    background: '#FFFFFF',
                  }}
                />
              </label>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <button
                type="submit"
                className="primary-button"
                disabled={isSavingGoals}
                style={{
                  background: '#4338CA',
                  border: 'none',
                  borderRadius: 999,
                  color: '#FFFFFF',
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isSavingGoals ? 'Saving…' : 'Save goals'}
              </button>
              <span style={{ fontSize: 12, color: '#475569' }}>
                Targets are saved for {goalMonthLabel}. Adjust them anytime to keep your
                team focused.
              </span>
            </div>
          </form>
        </div>
      </section>

      {/* Right-hand side sections */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
          marginBottom: 32,
        }}
      >
        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#0F172A',
                  marginBottom: 4,
                }}
              >
                Quick links
              </h3>
              <p style={{ fontSize: 13, color: '#64748B' }}>
                Hop straight into the workspace you need.
              </p>
            </div>
          </div>
          <ul
            style={{
              display: 'grid',
              gap: 12,
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
          >
            {QUICK_LINKS.map(link => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#F8FAFC',
                    borderRadius: 12,
                    padding: '14px 16px',
                    textDecoration: 'none',
                    color: '#1E3A8A',
                    border: '1px solid transparent',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{link.title}</div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: '#475569',
                      }}
                    >
                      {link.description}
                    </p>
                  </div>
                  <span
                    aria-hidden="true"
                    style={{ fontWeight: 700, color: '#4338CA' }}
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </article>

        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#0F172A',
                marginBottom: 4,
              }}
            >
              Restock soon
            </h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>
              Products at or below their reorder point, ranked by urgency.
            </p>
          </div>

          {isLoadingLowStock ? (
            <p style={{ fontSize: 13, color: '#475569' }}>
              Loading low-stock products…
            </p>
          ) : lowStockError ? (
            <p style={{ fontSize: 13, color: '#DC2626' }}>{lowStockError}</p>
          ) : lowStock.length ? (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, color: '#475569' }}>
                  Top {topLowStock.length} low-stock SKUs. Jump to Products to reorder.
                </span>
                <button
                  type="button"
                  onClick={handleLowStockExport}
                  disabled={isExportingLowStock}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: '1px solid #4338CA',
                    background: '#4338CA',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    cursor: isExportingLowStock ? 'wait' : 'pointer',
                  }}
                >
                  {isExportingLowStock ? 'Preparing CSV…' : 'Export CSV'}
                </button>
              </div>

              {lowStockExportMessage ? (
                <p style={{ fontSize: 12, color: '#0F172A', margin: 0 }}>
                  {lowStockExportMessage}
                </p>
              ) : null}

              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 12,
                  padding: '12px 14px',
                  background: '#F8FAFC',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 240px' }}>
                    <p style={{ margin: 0, fontWeight: 700, color: '#0F172A' }}>
                      Automation
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>
                      Use the live low-stock list to notify managers and prep supplier orders.
                    </p>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <button
                      type="button"
                      onClick={scheduleWeeklyLowStockExport}
                      disabled={isSchedulingExport || !lowStock.length}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: '1px solid #0EA5E9',
                        background: '#0EA5E9',
                        color: '#FFFFFF',
                        fontWeight: 600,
                        cursor: isSchedulingExport ? 'wait' : 'pointer',
                        minWidth: 180,
                      }}
                    >
                      {isSchedulingExport
                        ? 'Scheduling…'
                        : `Schedule weekly email${scheduledExport ? ' ✔' : ''}`}
                    </button>

                    <button
                      type="button"
                      onClick={createSupplierReorderDraft}
                      disabled={isBuildingSupplierDraft || !topLowStock.length}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: '1px solid #4338CA',
                        background: '#FFFFFF',
                        color: '#4338CA',
                        fontWeight: 700,
                        cursor: isBuildingSupplierDraft ? 'wait' : 'pointer',
                        minWidth: 200,
                      }}
                    >
                      {isBuildingSupplierDraft
                        ? 'Building draft…'
                        : `Create supplier reorder${supplierDraft ? ' ✔' : ''}`}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div
                    style={{
                      background: '#FFFFFF',
                      border: '1px dashed #CBD5E1',
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#0F172A' }}>
                      Weekly CSV export
                    </p>
                    {scheduledExport && nextScheduledRun ? (
                      <p style={{ margin: 0, fontSize: 13, color: '#0F172A' }}>
                        Sends every week to {scheduledExport.recipients.join(', ')}. Next run{' '}
                        {nextScheduledRun.toLocaleDateString()} with {scheduledExport.skuCount} SKUs.
                      </p>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                        We’ll email managers a CSV of {lowStock.length || 'all'} low-stock SKUs
                        every week once scheduled.
                      </p>
                    )}
                  </div>

                  <div
                    style={{
                      background: '#FFFFFF',
                      border: '1px dashed #CBD5E1',
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#0F172A' }}>
                      Supplier reorder draft
                    </p>
                    {supplierDraft ? (
                      <div style={{ margin: 0, fontSize: 13, color: '#0F172A' }}>
                        <p style={{ margin: 0 }}>
                          Drafted {supplierDraft.items.length} lines at{' '}
                          {new Date(supplierDraft.createdAt).toLocaleString()}.
                        </p>
                        <ul
                          style={{
                            margin: '6px 0 0',
                            paddingLeft: 16,
                            color: '#475569',
                            fontSize: 12,
                          }}
                        >
                          {supplierDraft.items.slice(0, 3).map(item => (
                            <li key={item.id}>
                              {item.name} · order {item.suggestedQuantity} (on hand {item.stockCount})
                            </li>
                          ))}
                          {supplierDraft.items.length > 3 ? (
                            <li>+{supplierDraft.items.length - 3} more lines</li>
                          ) : null}
                        </ul>
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                        We’ll draft a purchase order from the top {topLowStock.length || 5} SKUs to
                        fast-track supplier outreach.
                      </p>
                    )}
                  </div>
                </div>

                {automationStatus ? (
                  <p style={{ margin: 0, fontSize: 12, color: '#0F172A' }}>{automationStatus}</p>
                ) : null}
              </div>

              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {topLowStock.map(item => (
                  <li
                    key={item.id}
                    style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: 12,
                      padding: '12px 14px',
                      display: 'flex',
                      gap: 12,
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: '#F8FAFC',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <Link
                        to={`/products?lowStock=1#product-${item.id}`}
                        style={{
                          color: '#4338CA',
                          fontWeight: 700,
                          textDecoration: 'none',
                        }}
                      >
                        {item.name}
                      </Link>
                      <span
                        style={{
                          fontSize: 12,
                          color: '#64748B',
                        }}
                      >
                        SKU: {item.sku ?? '—'}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: '#0F172A',
                          fontSize: 14,
                        }}
                      >
                        {item.stockCount} on hand
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#475569',
                        }}
                      >
                        Reorder at {item.reorderLevel}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {lowStock.length > topLowStock.length ? (
                <Link
                  to="/products?lowStock=1"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#4338CA',
                  }}
                >
                  View all {lowStock.length} low-stock products
                </Link>
              ) : null}
            </>
          ) : (
            <p style={{ fontSize: 13, color: '#475569' }}>
              All tracked products are above their reorder points.
            </p>
          )}
        </article>

        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#0F172A',
                marginBottom: 4,
              }}
            >
              Inventory alerts
            </h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>
              Watch products that are running low so the floor team can replenish
              quickly.
            </p>
          </div>

          {inventoryAlerts.length ? (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {inventoryAlerts.map(item => (
                <li
                  key={item.sku}
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    background: '#F8FAFC',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        color: '#0F172A',
                      }}
                    >
                      {item.name}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color:
                          item.severity === 'critical'
                            ? '#DC2626'
                            : item.severity === 'warning'
                              ? '#C2410C'
                              : '#2563EB',
                      }}
                    >
                      {item.status}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: '#64748B',
                    }}
                  >
                    SKU: {item.sku}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: '#475569' }}>
              All inventory levels are healthy.
            </p>
          )}
        </article>

        <article
          style={{
            background: '#FFFFFF',
            borderRadius: 20,
            border: '1px solid #E2E8F0',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#0F172A',
                marginBottom: 4,
              }}
            >
              Team callouts
            </h3>
            <p style={{ fontSize: 13, color: '#64748B' }}>
              Share insights with staff so everyone knows what needs attention in this
              range.
            </p>
          </div>

          <dl
            style={{
              margin: 0,
              display: 'grid',
              gap: 12,
            }}
          >
            {teamCallouts.map(item => (
              <div
                key={item.label}
                style={{
                  display: 'grid',
                  gap: 4,
                  background: '#F8FAFC',
                  borderRadius: 12,
                  border: '1px solid #E2E8F0',
                  padding: '12px 14px',
                }}
              >
                <dt
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#64748B',
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                  }}
                >
                  {item.label}
                </dt>
                <dd
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    color: '#0F172A',
                  }}
                >
                  {item.value}
                </dd>
                <dd
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: '#475569',
                  }}
                >
                  {item.description}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      </section>
    </div>
  )
}
