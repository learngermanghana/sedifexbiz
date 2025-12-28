// web/src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import Sparkline from '../components/Sparkline'
import { requestAiAdvisor } from '../api/aiAdvisor'
import { useStoreMetrics } from '../hooks/useStoreMetrics'
import { useActiveStore } from '../hooks/useActiveStore'
import { db } from '../firebase'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from 'firebase/firestore'
import { CUSTOMER_CACHE_LIMIT } from '../utils/offlineCache'
import { CustomerDebt, DebtSummary, formatGhsFromCents, summarizeCustomerDebt } from '../utils/debt'

function formatPercent(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

// ---- Snapshot types & helpers ----
type DashboardSaleItem = {
  name: string
  qty: number
  price: number
  type?: 'product' | 'service' | string
  isService?: boolean
  category?: string
}

type DashboardSale = {
  id: string
  branchId?: string | null
  storeId?: string | null
  total: number
  vatTotal: number // mapped from taxTotal / vatTotal in Firestore
  createdAt: Date | null
  items: DashboardSaleItem[]
}

type DashboardExpense = {
  id: string
  amount: number
  date: string // yyyy-mm-dd
}

type ExpiringProduct = {
  id: string
  name: string
  expiryDate: Date | null
  stockCount: number | null
}

const EXPIRY_LOOKAHEAD_DAYS = 90

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

function toDate(value: unknown): Date | null {
  if (!value) return null
  try {
    if (typeof (value as any).toDate === 'function') {
      return (value as any).toDate()
    }
    if (value instanceof Date) return value
    if (typeof value === 'string') {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  } catch {
    return null
  }
  return null
}

function describeExpiry(date: Date) {
  const msPerDay = 1000 * 60 * 60 * 24
  const diffDays = Math.ceil((date.getTime() - Date.now()) / msPerDay)

  if (diffDays < 0) {
    const absDiff = Math.abs(diffDays)
    return {
      label: `${absDiff} day${absDiff === 1 ? '' : 's'} overdue`,
      tone: '#DC2626',
    }
  }

  if (diffDays === 0) return { label: 'Expires today', tone: '#F97316' }
  if (diffDays === 1) return { label: 'In 1 day', tone: '#F59E0B' }
  if (diffDays <= 30) return { label: `In ${diffDays} days`, tone: '#F59E0B' }
  return { label: `In ${diffDays} days`, tone: '#2563EB' }
}

type MiniBarChartProps = {
  data: number[]
  color?: string
  fallback?: string
}

function MiniBarChart({ data, color = '#4338CA', fallback = 'No activity yet.' }: MiniBarChartProps) {
  const maxValue = Math.max(...data, 0)

  if (!data.length || maxValue <= 0) {
    return <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>{fallback}</p>
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${data.length}, minmax(6px, 1fr))`,
        gap: 6,
        alignItems: 'end',
        height: 100,
      }}
      aria-hidden="true"
    >
      {data.map((value, index) => {
        const heightPercent = Math.max((value / maxValue) * 100, 4)
        return (
          <div
            key={index}
            style={{
              background: color,
              borderRadius: 6,
              height: `${heightPercent}%`,
              transition: 'height 0.2s ease',
              opacity: value === maxValue ? 1 : 0.78,
            }}
            title={`Day ${index + 1}: ${value}`}
          />
        )
      })}
    </div>
  )
}

type SegmentedBarProps = {
  segments: { label: string; value: number; color: string }[]
}

function SegmentedBar({ segments }: SegmentedBarProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  if (total <= 0) {
    return <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>No sales recorded today.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          width: '100%',
          height: 20,
          borderRadius: 999,
          overflow: 'hidden',
          border: '1px solid #E2E8F0',
          background: '#F8FAFC',
        }}
      >
        {segments.map(segment => {
          const widthPercent = Math.max((segment.value / total) * 100, 1)
          return (
            <div
              key={segment.label}
              style={{
                width: `${widthPercent}%`,
                background: segment.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: 12,
                fontWeight: 700,
              }}
              title={`${segment.label}: ${Math.round(widthPercent)}%`}
            />
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {segments.map(segment => {
          const widthPercent = Math.round((segment.value / total) * 100)
          return (
            <div
              key={segment.label}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 4,
                  background: segment.color,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontWeight: 700, color: '#0F172A' }}>{segment.label}</span>
              <span>{widthPercent}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
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
  const { storeId } = useActiveStore()

  const [expiringProducts, setExpiringProducts] = useState<ExpiringProduct[]>([])
  const [isLoadingExpiries, setIsLoadingExpiries] = useState(false)
  const [expiryError, setExpiryError] = useState<string | null>(null)

  // ---- New snapshot state ----
  const [sales, setSales] = useState<DashboardSale[]>([])
  const [expenses, setExpenses] = useState<DashboardExpense[]>([])
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(true)
  const [debtSummary, setDebtSummary] = useState<DebtSummary | null>(null)
  const [isLoadingDebt, setIsLoadingDebt] = useState(false)
  const [debtError, setDebtError] = useState<string | null>(null)

  const [aiSummary, setAiSummary] = useState<{
    message: string | null
    lastGeneratedAt: Date | null
    error: string | null
    loading: boolean
    lastContextKey: string | null
  }>({
    message: null,
    lastGeneratedAt: null,
    error: null,
    loading: false,
    lastContextKey: null,
  })
  const [metricFilter, setMetricFilter] = useState<'all' | 'sales' | 'inventory'>('all')

  const now = new Date()
  const todayKey = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [now.toDateString()],
  )
  const yesterday = useMemo(() => {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return d
  }, [now])

  useEffect(() => {
    if (!storeId) {
      setExpiringProducts([])
      setExpiryError(null)
      setDebtSummary(null)
      return
    }

    setIsLoadingExpiries(true)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + EXPIRY_LOOKAHEAD_DAYS)

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', storeId),
      orderBy('expiryDate', 'asc'),
      limit(50),
    )

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const rows: ExpiringProduct[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data() as any
          return {
            id: docSnap.id,
            name: typeof data.name === 'string' ? data.name : 'Unnamed item',
            expiryDate: toDate(data.expiryDate),
            stockCount:
              typeof data.stockCount === 'number' && Number.isFinite(data.stockCount)
                ? data.stockCount
                : null,
          }
        })

        const filtered = rows.filter(
          item => item.expiryDate && item.expiryDate <= cutoff,
        )

        setExpiringProducts(filtered)
        setExpiryError(null)
        setIsLoadingExpiries(false)
      },
      error => {
        console.error('[dashboard] Failed to load expiring products', error)
        setExpiryError('Could not load expiry dates right now.')
        setExpiringProducts([])
        setIsLoadingExpiries(false)
      },
    )

    return () => unsubscribe()
  }, [storeId])

  const filteredMetrics = useMemo(() => {
    if (metricFilter === 'sales') {
      return metrics.filter(metric => ['revenue', 'ticket', 'transactions'].includes(metric.id))
    }

    if (metricFilter === 'inventory') {
      return metrics.filter(metric => metric.id === 'inventory')
    }

    return metrics
  }, [metricFilter, metrics])

  useEffect(() => {
    if (!storeId) {
      setDebtSummary(null)
      setDebtError(null)
      return () => {}
    }

    setIsLoadingDebt(true)
    setDebtError(null)

    const debtQuery = query(
      collection(db, 'customers'),
      where('storeId', '==', storeId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(
      debtQuery,
      snapshot => {
        const rows: CustomerDebt[] = snapshot.docs.map(docSnap => ({
          ...(docSnap.data() as CustomerDebt),
        }))

        setDebtSummary(summarizeCustomerDebt(rows))
        setIsLoadingDebt(false)
      },
      error => {
        console.error('[dashboard] Failed to load customer debt', error)
        setDebtError('Unable to load customer debt balances right now.')
        setIsLoadingDebt(false)
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

          // VAT / tax total: map from taxTotal / totals.taxTotal / vatTotal
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

          const items: DashboardSaleItem[] = itemsRaw.map((item: any, index: number) => {
            const itemTypeRaw =
              typeof item.type === 'string'
                ? item.type
                : typeof item.kind === 'string'
                  ? item.kind
                  : undefined
            const category =
              typeof item.category === 'string' ? item.category : undefined
            const isServiceFlag =
              item.isService === true ||
              (typeof itemTypeRaw === 'string' &&
                itemTypeRaw.toLowerCase() === 'service') ||
              (typeof category === 'string' &&
                category.toLowerCase().includes('service'))

            return {
              name: String(item.name ?? `Item ${index + 1}`),
              qty: Number(item.qty) || 0,
              price: Number(item.price) || 0,
              type: itemTypeRaw,
              isService: isServiceFlag,
              category,
            }
          })

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
    let todayProducts = 0
    let todayServices = 0

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

        // 🔹 Breakdown products vs services
        for (const item of sale.items) {
          const lineTotal = (item.qty || 0) * (item.price || 0)
          const isService =
            item.isService === true ||
            (typeof item.type === 'string' &&
              item.type.toLowerCase() === 'service') ||
            (typeof item.category === 'string' &&
              item.category.toLowerCase().includes('service'))

          if (isService) {
            todayServices += lineTotal
          } else {
            todayProducts += lineTotal
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
      todayProductSalesTotal: todayProducts,
      todayServiceSalesTotal: todayServices,
    }
  }, [now, sales, yesterday])

  const monthExpensesTotal = useMemo(() => {
    if (!expenses.length) return 0
    const currentMonth = now.toISOString().slice(0, 7) // yyyy-mm
    return expenses
      .filter(exp => exp.date?.startsWith(currentMonth))
      .reduce((sum, exp) => sum + exp.amount, 0)
  }, [expenses, now])

  const aiContext = useMemo(
    () => ({
      date: todayKey,
      storeId,
      sales: {
        todayTotal: todaySalesTotal,
        todayCount: todaySalesCount,
        yesterdayTotal: yesterdaySalesTotal,
        monthTotal: monthSalesTotal,
      },
      expenses: {
        monthTotal: monthExpensesTotal,
      },
    }),
    [monthExpensesTotal, monthSalesTotal, storeId, todayKey, todaySalesCount, todaySalesTotal, yesterdaySalesTotal],
  )

  const aiContextKey = useMemo(
    () => `${storeId ?? 'no-store'}-${todayKey}`,
    [storeId, todayKey],
  )

  useEffect(() => {
    setAiSummary(prev => ({
      ...prev,
      message: null,
      lastGeneratedAt: null,
      error: null,
      loading: false,
      lastContextKey: null,
    }))
  }, [aiContextKey])

  const aiLastGeneratedLabel =
    aiSummary.lastGeneratedAt && aiSummary.lastContextKey === aiContextKey
      ? aiSummary.lastGeneratedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'Not generated yet'

  const todaySalesMixTotal = todayProductSalesTotal + todayServiceSalesTotal
  const todayProductMixPercent =
    todaySalesMixTotal > 0
      ? Math.round((todayProductSalesTotal / todaySalesMixTotal) * 100)
      : 0
  const todayServiceMixPercent =
    todaySalesMixTotal > 0 ? 100 - todayProductMixPercent : 0
  const debtNextDueLabel = debtSummary?.nextDueDate
    ? debtSummary.nextDueDate.toLocaleDateString()
    : 'No due dates set'

  const revenueMetric = metrics.find(metric => metric.id === 'revenue')
  const ticketMetric = metrics.find(metric => metric.id === 'ticket')
  const transactionsMetric = metrics.find(metric => metric.id === 'transactions')

  const revenueSeries = revenueMetric?.sparkline ?? []
  const revenueComparisonSeries = revenueMetric?.comparisonSparkline ?? []
  const ticketSeries = ticketMetric?.sparkline ?? []
  const transactionSeries = transactionsMetric?.sparkline ?? []
  const maxTransactions = transactionSeries.length
    ? Math.max(...transactionSeries)
    : 0
  const revenueChangeLabel =
    revenueMetric && revenueMetric.changePercent !== null && revenueMetric.changePercent !== undefined
      ? formatPercent(revenueMetric.changePercent)
      : '—'

  async function handleGenerateAiSummary() {
    if (aiSummary.loading) return

    setAiSummary(prev => ({ ...prev, loading: true, error: null }))

    try {
      const response = await requestAiAdvisor({
        question: 'Provide today’s top 3 actions.',
        storeId: storeId ?? undefined,
        jsonContext: aiContext,
      })

      setAiSummary({
        message: response.advice,
        lastGeneratedAt: new Date(),
        error: null,
        loading: false,
        lastContextKey: aiContextKey,
      })
    } catch (error: unknown) {
      console.error('[Dashboard] AI summary failed', error)
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to generate advice right now.'
      setAiSummary(prev => ({ ...prev, error: message, loading: false }))
    }
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

      {/* 🔹 "Today at a glance" snapshot card */}
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
            {/* Sales today */}
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
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748B' }}>
                Products:{' '}
                <strong>GHS {todayProductSalesTotal.toFixed(2)}</strong> · Services:{' '}
                <strong>GHS {todayServiceSalesTotal.toFixed(2)}</strong>
              </p>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: '#0F172A',
                    fontWeight: 600,
                  }}
                >
                  <span>Products vs services</span>
                  <span>{todaySalesMixTotal > 0 ? 'Share of today\'s cash' : 'No sales yet'}</span>
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: 10,
                    borderRadius: 9999,
                    background: '#E2E8F0',
                    overflow: 'hidden',
                  }}
                  aria-label="Product and service contribution today"
                >
                  {todayProductMixPercent > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${todayProductMixPercent}%`,
                        background: '#0EA5E9',
                      }}
                    />
                  )}
                  {todayServiceMixPercent > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: `${todayServiceMixPercent}%`,
                        background: '#8B5CF6',
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    color: '#475569',
                  }}
                >
                  <span>
                    <span style={{ color: '#0EA5E9', fontWeight: 700 }}>
                      Products ({todayProductMixPercent}%)
                    </span>
                    : GHS {todayProductSalesTotal.toFixed(2)}
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span style={{ color: '#8B5CF6', fontWeight: 700 }}>
                      Services ({todayServiceMixPercent}%)
                    </span>
                    : GHS {todayServiceSalesTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </article>

            {/* Yesterday */}
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

            {/* This month */}
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

            {/* VAT this month */}
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

            {/* AI daily advisor */}
            <article
              style={{
                background: '#F8FAFC',
                borderRadius: 14,
                padding: '14px 16px',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
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
                AI advisor summary
              </p>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleGenerateAiSummary}
                  disabled={!storeId || aiSummary.loading}
                  style={{
                    background: '#4338CA',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 10,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: aiSummary.loading || !storeId ? 'not-allowed' : 'pointer',
                    opacity: aiSummary.loading || !storeId ? 0.7 : 1,
                  }}
                >
                  {aiSummary.loading ? 'Generating…' : 'Generate AI summary'}
                </button>

                {aiSummary.error ? (
                  <span
                    style={{
                      background: '#FEF2F2',
                      color: '#B91C1C',
                      border: '1px solid #FECACA',
                      borderRadius: 999,
                      padding: '4px 8px',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {aiSummary.error}
                  </span>
                ) : null}
              </div>

              <p style={{ margin: 0, fontSize: 13, color: '#1E293B' }}>
                {aiSummary.message
                  ? aiSummary.message
                  : 'Use AI to get today’s top 3 actions based on sales, expenses, and low stock.'}
              </p>

              <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
                Last generated: {aiLastGeneratedLabel}
              </p>
            </article>

            {/* Customer debt snapshot */}
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
                Outstanding customer debt
              </p>

              {debtError ? (
                <p style={{ margin: '10px 0 0', color: '#DC2626', fontSize: 13 }}>
                  {debtError}
                </p>
              ) : isLoadingDebt ? (
                <p style={{ margin: '10px 0 0', color: '#475569', fontSize: 13 }}>
                  Loading customer balances…
                </p>
              ) : (
                <>
                  <p
                    style={{
                      margin: '6px 0 2px',
                      fontSize: 24,
                      fontWeight: 700,
                      color: '#0F172A',
                    }}
                  >
                    {formatGhsFromCents(debtSummary?.totalOutstandingCents ?? 0)}
                  </p>

                  <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                    {debtSummary?.debtorCount
                      ? `${debtSummary.debtorCount} customer${
                          debtSummary.debtorCount === 1 ? '' : 's'
                        } owe you right now.`
                      : 'No unpaid balances at the moment.'}
                  </p>

                  <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                    {debtSummary?.overdueCount
                      ? `Overdue: ${formatGhsFromCents(debtSummary.overdueCents)} (${
                          debtSummary.overdueCount
                        } customer${debtSummary.overdueCount === 1 ? '' : 's'})`
                      : 'No overdue balances yet.'}
                  </p>

                  <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
                    {debtSummary?.nextDueDate
                      ? `Next due ${debtNextDueLabel}`
                      : 'No due dates set for customers.'}
                  </p>
                </>
              )}
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ color: '#475569', fontSize: 13 }}>
            Choose which metrics to show to keep this view tidy.
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: '#0F172A', fontWeight: 600 }}>Metrics shown</span>
            <select
              value={metricFilter}
              onChange={event => setMetricFilter(event.target.value as typeof metricFilter)}
              style={{
                borderRadius: 8,
                border: '1px solid #CBD5F5',
                padding: '6px 10px',
                fontSize: 13,
                background: '#FFFFFF',
              }}
            >
              <option value="all">All metrics</option>
              <option value="sales">Sales performance</option>
              <option value="inventory">Inventory snapshot</option>
            </select>
          </label>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {filteredMetrics.map(metric => {
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 700,
              color: '#0F172A',
            }}
          >
            Visual charts
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
            Explore the trends behind the KPIs — the visuals compare your selected window to
            previous performance and break down today’s mix.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            <article
              style={{
                background: '#FFFFFF',
                borderRadius: 14,
                padding: '16px 18px',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                Revenue trend
              </div>
              <div style={{ height: 110 }}>
                {revenueSeries.length ? (
                  <Sparkline
                    data={revenueSeries}
                    comparisonData={revenueComparisonSeries.length ? revenueComparisonSeries : undefined}
                    color="#4338CA"
                    comparisonColor="#A5B4FC"
                  />
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>
                    No revenue data for this range yet.
                  </p>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                Showing {rangeSummary}. Change {revenueChangeLabel} compared with the previous
                {resolvedRangeId === 'today' ? ' day' : ' period'}.
              </p>
            </article>

            <article
              style={{
                background: '#FFFFFF',
                borderRadius: 14,
                padding: '16px 18px',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                Daily transactions
              </div>
              <MiniBarChart
                data={transactionSeries}
                fallback="No transactions recorded for this range."
              />
              <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                {transactionSeries.length
                  ? `Highest day: ${maxTransactions} transaction${maxTransactions === 1 ? '' : 's'}.`
                  : 'Awaiting activity in this window.'}{' '}
                Covers {rangeDaysLabel.toLowerCase()} for your current selection.
              </p>
            </article>

            <article
              style={{
                background: '#FFFFFF',
                borderRadius: 14,
                padding: '16px 18px',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                Today’s sales mix
              </div>
              <SegmentedBar
                segments={[
                  { label: 'Products', value: todayProductSalesTotal, color: '#4338CA' },
                  { label: 'Services', value: todayServiceSalesTotal, color: '#F97316' },
                ]}
              />
              <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                Products {todayProductMixPercent}% vs services {todayServiceMixPercent}% of
                today’s GHS {todaySalesTotal.toFixed(2)} cash received.
              </p>
            </article>

            <article
              style={{
                background: '#FFFFFF',
                borderRadius: 14,
                padding: '16px 18px',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                Average basket trend
              </div>
              <div style={{ height: 110 }}>
                {ticketSeries.length ? (
                  <Sparkline
                    data={ticketSeries}
                    comparisonData={
                      ticketMetric?.comparisonSparkline && ticketMetric.comparisonSparkline.length
                        ? ticketMetric.comparisonSparkline
                        : undefined
                    }
                    color="#0EA5E9"
                    comparisonColor="#BAE6FD"
                  />
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>
                    No basket size data for this range yet.
                  </p>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>
                Track how spend per sale is evolving across {rangeSummary.toLowerCase()} to spot
                upsell opportunities.
              </p>
            </article>
          </div>
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
        {/* Expiring stock */}
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
                Expiring soon
              </h3>
              <p style={{ fontSize: 13, color: '#64748B' }}>
                Keep an eye on batches that will expire in the next {EXPIRY_LOOKAHEAD_DAYS}{' '}
                days.
              </p>
            </div>
            <Link to="/products" style={{ fontSize: 13, fontWeight: 600 }}>
              Manage in Items
            </Link>
          </div>

          {isLoadingExpiries ? (
            <p style={{ fontSize: 13, color: '#475569' }}>Loading expiry dates…</p>
          ) : expiryError ? (
            <p style={{ fontSize: 13, color: '#DC2626' }}>{expiryError}</p>
          ) : expiringProducts.length ? (
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
              {expiringProducts.slice(0, 8).map(item => {
                const status = item.expiryDate
                  ? describeExpiry(item.expiryDate)
                  : { label: 'No date', tone: '#475569' }

                return (
                  <li
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      border: '1px solid #E2E8F0',
                      padding: '12px 14px',
                      borderRadius: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: '#0F172A' }}>{item.name}</div>
                      <p style={{ margin: 0, color: '#475569', fontSize: 13 }}>
                        {item.expiryDate
                          ? `Expires on ${item.expiryDate.toLocaleDateString()}`
                          : 'No expiry date captured yet'}
                      </p>
                      {typeof item.stockCount === 'number' && (
                        <p style={{ margin: '2px 0 0', color: '#64748B', fontSize: 12 }}>
                          On hand: {item.stockCount}
                        </p>
                      )}
                    </div>
                    <span
                      style={{
                        padding: '6px 10px',
                        borderRadius: 999,
                        background: '#F8FAFC',
                        color: status.tone,
                        fontWeight: 700,
                        fontSize: 12,
                        minWidth: 110,
                        textAlign: 'center',
                      }}
                    >
                      {status.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
                No expiring stock in the next {EXPIRY_LOOKAHEAD_DAYS} days.
              </p>
              <p style={{ fontSize: 12, color: '#64748B' }}>
                Add expiry dates to products in your inventory to keep pharmacy items fresh.
              </p>
            </div>
          )}
        </article>

        {/* Inventory alerts */}
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

        {/* Team callouts */}
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
