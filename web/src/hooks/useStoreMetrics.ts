import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc, where, type Timestamp } from 'firebase/firestore'

import { db } from '../firebase'
import { useAuthUser } from './useAuthUser'
import { useActiveStore } from './useActiveStore'
import { useToast } from '../components/ToastProvider'
import {
  CUSTOMER_CACHE_LIMIT,
  PRODUCT_CACHE_LIMIT,
  SALES_CACHE_LIMIT,
  loadCachedCustomers,
  loadCachedProducts,
  loadCachedSales,
  saveCachedCustomers,
  saveCachedProducts,
  saveCachedSales,
} from '../utils/offlineCache'

type InventorySeverity = 'warning' | 'info' | 'critical'

type SaleRecord = {
  id: string
  total?: number
  createdAt?: Timestamp | Date | null
  items?: Array<{ productId: string; name?: string; price?: number; qty?: number }>
  payment?: {
    method?: string
    amountPaid?: number
    changeDue?: number
  }
  storeId?: string | null
}

type ProductRecord = {
  id: string
  name: string
  price?: number
  stockCount?: number
  reorderThreshold?: number | null
  /**
   * Legacy alias supported for older product documents.
   * Prefer {@link reorderThreshold} going forward.
   */
  minStock?: number | null
  createdAt?: unknown
  updatedAt?: unknown
  storeId?: string | null
}

type ReceiptRecord = {
  id: string
  productId?: string | null
  qty?: number
  supplier?: string | null
  reference?: string | null
  unitCost?: number | null
  totalCost?: number | null
  createdAt?: Timestamp | Date | null
  storeId?: string | null
}

type LedgerRecord = {
  id: string
  productId?: string | null
  qtyChange?: number
  type?: string | null
  refId?: string | null
  storeId?: string | null
  createdAt?: Timestamp | Date | null
}

type CustomerRecord = {
  id: string
  name: string
  displayName?: string
  createdAt?: Timestamp | Date | null
  storeId?: string | null
}

type GoalTargets = {
  revenueTarget: number
  customerTarget: number
}

type MonthlyGoalDocument = {
  monthly?: Record<string, Partial<GoalTargets>>
}

type PresetRangeId = 'today' | '7d' | '30d' | 'month' | 'custom'

type RangePreset = {
  id: PresetRangeId
  label: string
  getRange?: (today: Date) => { start: Date; end: Date }
}

type MetricCard = {
  id: string
  title: string
  subtitle: string
  value: string
  changePercent: number | null
  changeDescription: string
  sparkline: number[] | null
  comparisonSparkline: number[] | null
}

type GoalProgress = {
  title: string
  value: string
  target: string
  progress: number
}

type InventoryAlert = {
  sku: string
  name: string
  status: string
  severity: InventorySeverity
  threshold: number
  usesDefaultThreshold: boolean
}

type TeamCallout = {
  label: string
  value: string
  description: string
}

type GoalFormValues = {
  revenueTarget: string
  customerTarget: string
}

type CustomRange = { start: string; end: string }

type CostSummary = {
  receivedQty: number
  unitsSold: number
  averageReceivedCost: number | null
  grossMarginPercent: number | null
}

type SupplierInsight = {
  supplier: string
  totalCost: number
  totalQty: number
  receiptCount: number
  averageUnitCost: number | null
  lastReceivedAt: Date | null
}

type UseStoreMetricsResult = {
  rangePresets: RangePreset[]
  selectedRangeId: PresetRangeId
  resolvedRangeId: PresetRangeId
  customRange: CustomRange
  handleRangePresetChange: (id: PresetRangeId) => void
  handleCustomDateChange: (field: 'start' | 'end', value: string) => void
  rangeSummary: string
  rangeDaysLabel: string
  showCustomHint: boolean
  metrics: MetricCard[]
  goals: GoalProgress[]
  goalMonthLabel: string
  selectedGoalMonth: string
  handleGoalMonthChange: (value: string) => void
  goalFormValues: GoalFormValues
  handleGoalInputChange: (field: keyof GoalFormValues, value: string) => void
  handleGoalSubmit: (event: React.FormEvent) => Promise<void>
  isSavingGoals: boolean
  inventoryAlerts: InventoryAlert[]
  teamCallouts: TeamCallout[]
  costMetrics: MetricCard[]
  costSummary: CostSummary
  supplierInsights: SupplierInsight[]
}

const MS_PER_DAY = 1000 * 60 * 60 * 24
const DEFAULT_REVENUE_TARGET = 5000
const DEFAULT_CUSTOMER_TARGET = 50
const DEFAULT_REORDER_THRESHOLD = 5
const RECEIPT_CACHE_LIMIT = 500
const LEDGER_CACHE_LIMIT = 750

const RANGE_PRESETS: RangePreset[] = [
  {
    id: 'today',
    label: 'Today',
    getRange: today => ({ start: startOfDay(today), end: endOfDay(today) }),
  },
  {
    id: '7d',
    label: 'Last 7 days',
    getRange: today => ({ start: startOfDay(addDays(today, -6)), end: endOfDay(today) }),
  },
  {
    id: '30d',
    label: 'Last 30 days',
    getRange: today => ({ start: startOfDay(addDays(today, -29)), end: endOfDay(today) }),
  },
  {
    id: 'month',
    label: 'This month',
    getRange: today => ({ start: startOfMonth(today), end: endOfDay(today) }),
  },
  {
    id: 'custom',
    label: 'Custom range',
  },
]

function asDate(value?: Timestamp | Date | null) {
  if (!value) return null
  if (value instanceof Date) return value
  try {
    return value.toDate()
  } catch (error) {
    return null
  }
}

function addDays(base: Date, days: number) {
  const copy = new Date(base)
  copy.setDate(copy.getDate() + days)
  return copy
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

function formatAmount(value: number) {
  return `GHS ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatHourRange(hour: number) {
  const formatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  const start = new Date()
  start.setHours(hour, 0, 0, 0)
  const end = new Date(start)
  end.setHours(hour + 1)
  return `${formatter.format(start)} – ${formatter.format(end)}`
}

function differenceInCalendarDays(start: Date, end: Date) {
  const startAtMidnight = startOfDay(start).getTime()
  const endAtMidnight = startOfDay(end).getTime()
  return Math.round((endAtMidnight - startAtMidnight) / MS_PER_DAY)
}

function enumerateDaysBetween(start: Date, end: Date) {
  const days: Date[] = []
  let cursor = startOfDay(start)
  const final = startOfDay(end)
  while (cursor.getTime() <= final.getTime()) {
    days.push(new Date(cursor))
    cursor = addDays(cursor, 1)
  }
  return days
}

function resolveReorderThreshold(product: ProductRecord) {
  if (typeof product.reorderThreshold === 'number' && Number.isFinite(product.reorderThreshold)) {
    return { threshold: Math.max(0, product.reorderThreshold), usesDefault: false }
  }
  if (typeof product.minStock === 'number' && Number.isFinite(product.minStock)) {
    return { threshold: Math.max(0, product.minStock), usesDefault: false }
  }
  return { threshold: DEFAULT_REORDER_THRESHOLD, usesDefault: true }
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDateRange(start: Date, end: Date) {
  const sameYear = start.getFullYear() === end.getFullYear()
  const startFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  })
  const endFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${startFormatter.format(start)} – ${endFormatter.format(end)}`
}

function formatMonthInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function parseMonthInput(value: string) {
  if (!value) return null
  const [year, month] = value.split('-').map(Number)
  if (!year || !month) return null
  return new Date(year, month - 1, 1)
}

function parseDateInput(value: string) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function resolveReceiptCost(receipt: ReceiptRecord): number | null {
  const total = typeof receipt.totalCost === 'number' ? receipt.totalCost : null
  if (total !== null && Number.isFinite(total)) {
    return total
  }
  const unitCost = typeof receipt.unitCost === 'number' ? receipt.unitCost : null
  const qty = Number(receipt.qty ?? 0)
  if (unitCost !== null && Number.isFinite(unitCost) && Number.isFinite(qty)) {
    return unitCost * qty
  }
  return null
}

function buildDailyReceiptSeries(
  receipts: ReceiptRecord[],
  start: Date,
  end: Date,
  metric: 'cost' | 'qty',
) {
  const buckets = new Map<string, { cost: number; qty: number }>()
  receipts.forEach(receipt => {
    const created = asDate(receipt.createdAt)
    if (!created) return
    const key = formatDateKey(created)
    const current = buckets.get(key) ?? { cost: 0, qty: 0 }
    const qty = Number(receipt.qty ?? 0) || 0
    current.qty += qty
    const cost = resolveReceiptCost(receipt)
    if (cost !== null) {
      current.cost += cost
    }
    buckets.set(key, current)
  })

  return enumerateDaysBetween(start, end).map(day => {
    const bucket = buckets.get(formatDateKey(day))
    if (!bucket) return 0
    return metric === 'cost' ? bucket.cost : bucket.qty
  })
}

type UnitCostResolver = (
  productId: string | null | undefined,
  createdAt: Date | null,
) => number

type ProductCostSnapshot = {
  createdAt: Date
  totalQty: number
  totalCost: number
  lastUnitCost: number | null
}

function buildDailyLedgerCostSeries(
  entries: LedgerRecord[],
  start: Date,
  end: Date,
  resolveUnitCost: UnitCostResolver,
) {
  const buckets = new Map<string, number>()
  entries.forEach(entry => {
    const created = asDate(entry.createdAt)
    if (!created) return
    const key = formatDateKey(created)
    const qty = Math.abs(Number(entry.qtyChange ?? 0) || 0)
    if (!qty) return
    const unitCost = resolveUnitCost(entry.productId, created)
    const cost = qty * unitCost
    const current = buckets.get(key) ?? 0
    buckets.set(key, current + cost)
  })

  return enumerateDaysBetween(start, end).map(day => buckets.get(formatDateKey(day)) ?? 0)
}

function calculateLedgerCogs(entries: LedgerRecord[], resolveUnitCost: UnitCostResolver) {
  return entries.reduce((sum, entry) => {
    const qty = Math.abs(Number(entry.qtyChange ?? 0) || 0)
    if (!qty) return sum
    const created = asDate(entry.createdAt)
    const unitCost = resolveUnitCost(entry.productId, created)
    return sum + qty * unitCost
  }, 0)
}

function buildDailyMetricSeries(
  sales: SaleRecord[],
  start: Date,
  end: Date,
  metric: 'revenue' | 'count' | 'ticket',
) {
  const buckets = new Map<string, { revenue: number; count: number }>()
  sales.forEach(sale => {
    const created = asDate(sale.createdAt)
    if (!created) return
    const key = formatDateKey(created)
    const bucket = buckets.get(key) ?? { revenue: 0, count: 0 }
    bucket.revenue += sale.total ?? 0
    bucket.count += 1
    buckets.set(key, bucket)
  })

  return enumerateDaysBetween(start, end).map(day => {
    const bucket = buckets.get(formatDateKey(day))
    if (!bucket) {
      return 0
    }
    if (metric === 'revenue') return bucket.revenue
    if (metric === 'count') return bucket.count
    return bucket.count > 0 ? bucket.revenue / bucket.count : 0
  })
}

export function useStoreMetrics(): UseStoreMetricsResult {
  const authUser = useAuthUser()
  const { storeId: activeStoreId } = useActiveStore()
  const { publish } = useToast()

  const [sales, setSales] = useState<SaleRecord[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([])
  const [ledgerEntries, setLedgerEntries] = useState<LedgerRecord[]>([])
  const [monthlyGoals, setMonthlyGoals] = useState<Record<string, GoalTargets>>({})
  const [selectedGoalMonth, setSelectedGoalMonth] = useState(() => formatMonthInput(new Date()))
  const [goalFormValues, setGoalFormValues] = useState<GoalFormValues>({
    revenueTarget: String(DEFAULT_REVENUE_TARGET),
    customerTarget: String(DEFAULT_CUSTOMER_TARGET),
  })
  const [goalFormTouched, setGoalFormTouched] = useState(false)
  const [isSavingGoals, setIsSavingGoals] = useState(false)
  const [selectedRangeId, setSelectedRangeId] = useState<PresetRangeId>('today')
  const [customRange, setCustomRange] = useState<CustomRange>({ start: '', end: '' })

  const goalDocumentId = useMemo(
    () => activeStoreId ?? `user-${authUser?.uid ?? 'default'}`,
    [activeStoreId, authUser?.uid],
  )

  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setSales([])
      return () => {
        cancelled = true
      }
    }

    loadCachedSales<SaleRecord>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          setSales(cached)
        }
      })
      .catch(error => {
        console.warn('[metrics] Failed to load cached sales', error)
      })

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', activeStoreId),
      orderBy('createdAt', 'desc'),
      limit(SALES_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snapshot => {
      const rows: SaleRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<SaleRecord, 'id'>),
      }))
      setSales(rows)
      saveCachedSales(rows, { storeId: activeStoreId }).catch(error => {
        console.warn('[metrics] Failed to cache sales', error)
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setProducts([])
      return () => {
        cancelled = true
      }
    }

    loadCachedProducts<ProductRecord>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          setProducts(cached)
        }
      })
      .catch(error => {
        console.warn('[metrics] Failed to load cached products', error)
      })

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snapshot => {
      const rows: ProductRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ProductRecord, 'id'>),
      }))
      setProducts(rows)
      saveCachedProducts(rows, { storeId: activeStoreId }).catch(error => {
        console.warn('[metrics] Failed to cache products', error)
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setCustomers([])
      return () => {
        cancelled = true
      }
    }

    loadCachedCustomers<CustomerRecord>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          setCustomers(cached)
        }
      })
      .catch(error => {
        console.warn('[metrics] Failed to load cached customers', error)
      })

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snapshot => {
      const rows: CustomerRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<CustomerRecord, 'id'>),
      }))
      setCustomers(rows)
      saveCachedCustomers(rows, { storeId: activeStoreId }).catch(error => {
        console.warn('[metrics] Failed to cache customers', error)
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  useEffect(() => {
    if (!activeStoreId) {
      setReceipts([])
      return () => {}
    }

    const q = query(
      collection(db, 'receipts'),
      where('storeId', '==', activeStoreId),
      orderBy('createdAt', 'desc'),
      limit(RECEIPT_CACHE_LIMIT),
    )

    return onSnapshot(q, snapshot => {
      const rows: ReceiptRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ReceiptRecord, 'id'>),
      }))
      setReceipts(rows)
    })
  }, [activeStoreId])

  useEffect(() => {
    if (!activeStoreId) {
      setLedgerEntries([])
      return () => {}
    }

    const q = query(
      collection(db, 'ledger'),
      where('storeId', '==', activeStoreId),
      orderBy('createdAt', 'desc'),
      limit(LEDGER_CACHE_LIMIT),
    )

    return onSnapshot(q, snapshot => {
      const rows: LedgerRecord[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<LedgerRecord, 'id'>),
      }))
      setLedgerEntries(rows)
    })
  }, [activeStoreId])

  useEffect(() => {
    if (!activeStoreId) {
      setMonthlyGoals({})
      return () => {}
    }

    const ref = doc(db, 'storeGoals', goalDocumentId)
    return onSnapshot(ref, snapshot => {
      const data = snapshot.data() as MonthlyGoalDocument | undefined
      if (!data?.monthly) {
        setMonthlyGoals({})
        return
      }
      const parsed: Record<string, GoalTargets> = {}
      Object.entries(data.monthly).forEach(([month, entry]) => {
        parsed[month] = {
          revenueTarget:
            typeof entry?.revenueTarget === 'number' ? entry.revenueTarget : DEFAULT_REVENUE_TARGET,
          customerTarget:
            typeof entry?.customerTarget === 'number' ? entry.customerTarget : DEFAULT_CUSTOMER_TARGET,
        }
      })
      setMonthlyGoals(parsed)
    })
  }, [activeStoreId, goalDocumentId])

  useEffect(() => {
    setGoalFormTouched(false)
  }, [selectedGoalMonth])

  useEffect(() => {
    if (goalFormTouched) return
    const active = monthlyGoals[selectedGoalMonth]
    setGoalFormValues({
      revenueTarget: String(active?.revenueTarget ?? DEFAULT_REVENUE_TARGET),
      customerTarget: String(active?.customerTarget ?? DEFAULT_CUSTOMER_TARGET),
    })
  }, [monthlyGoals, selectedGoalMonth, goalFormTouched])

  const today = useMemo(() => new Date(), [sales])
  const defaultMonthKey = useMemo(() => formatMonthInput(today), [today])
  const rangeInfo = useMemo(() => {
    const fallbackPreset = RANGE_PRESETS.find(option => option.id === 'today')
    const resolvedFallback = fallbackPreset?.getRange?.(today) ?? {
      start: startOfDay(today),
      end: endOfDay(today),
    }

    if (selectedRangeId === 'custom') {
      const startDate = parseDateInput(customRange.start)
      const endDate = parseDateInput(customRange.end)
      if (startDate && endDate && startDate <= endDate) {
        return {
          rangeStart: startOfDay(startDate),
          rangeEnd: endOfDay(endDate),
          resolvedRangeId: 'custom' as PresetRangeId,
        }
      }
      return {
        rangeStart: resolvedFallback.start,
        rangeEnd: resolvedFallback.end,
        resolvedRangeId: 'today' as PresetRangeId,
      }
    }

    const preset = RANGE_PRESETS.find(option => option.id === selectedRangeId)
    if (preset?.getRange) {
      const range = preset.getRange(today)
      return {
        rangeStart: range.start,
        rangeEnd: range.end,
        resolvedRangeId: preset.id,
      }
    }

    return {
      rangeStart: resolvedFallback.start,
      rangeEnd: resolvedFallback.end,
      resolvedRangeId: 'today' as PresetRangeId,
    }
  }, [today, selectedRangeId, customRange.start, customRange.end])

  const { rangeStart, rangeEnd, resolvedRangeId } = rangeInfo
  const rangeDays = differenceInCalendarDays(rangeStart, rangeEnd) + 1
  const previousRangeStart = addDays(rangeStart, -rangeDays)
  const previousRangeEnd = addDays(rangeStart, -1)

  const currentSales = useMemo(
    () =>
      sales.filter(record => {
        const created = asDate(record.createdAt)
        return created ? created >= rangeStart && created <= rangeEnd : false
      }),
    [sales, rangeStart, rangeEnd],
  )

  const previousSales = useMemo(
    () =>
      sales.filter(record => {
        const created = asDate(record.createdAt)
        return created ? created >= previousRangeStart && created <= previousRangeEnd : false
      }),
    [sales, previousRangeStart, previousRangeEnd],
  )

  const currentRevenue = useMemo(
    () => currentSales.reduce((sum, sale) => sum + (sale.total ?? 0), 0),
    [currentSales],
  )
  const previousRevenue = useMemo(
    () => previousSales.reduce((sum, sale) => sum + (sale.total ?? 0), 0),
    [previousSales],
  )

  const currentTicket = currentSales.length ? currentRevenue / currentSales.length : 0
  const previousTicket = previousSales.length ? previousRevenue / previousSales.length : 0

  const salesChange = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : null
  const ticketChange = previousTicket > 0 ? ((currentTicket - previousTicket) / previousTicket) * 100 : null
  const salesCountChange = previousSales.length > 0
    ? ((currentSales.length - previousSales.length) / previousSales.length) * 100
    : null

  const inventoryValue = products.reduce((sum, product) => {
    const stock = product.stockCount ?? 0
    const price = product.price ?? 0
    return sum + stock * price
  }, 0)

  const lowStock = products
    .map(product => {
      const stock = product.stockCount ?? 0
      const { threshold, usesDefault } = resolveReorderThreshold(product)
      if (stock > threshold) return null
      const severity: InventorySeverity = stock <= 0 ? 'critical' : stock <= threshold ? 'warning' : 'info'
      const status = stock <= 0 ? 'Out of stock' : `Low (${stock} remaining)`
      return {
        sku: product.id,
        name: product.name,
        status,
        severity,
        threshold,
        usesDefaultThreshold: usesDefault,
      }
    })
    .filter(Boolean) as InventoryAlert[]

  const outOfStockCount = products.filter(product => (product.stockCount ?? 0) <= 0).length

  const hourBuckets = currentSales.reduce((acc, sale) => {
    const created = asDate(sale.createdAt)
    if (!created) return acc
    const hour = created.getHours()
    const current = acc.get(hour) ?? 0
    acc.set(hour, current + (sale.total ?? 0))
    return acc
  }, new Map<number, number>())

  let peakHour: { hour: number; total: number } | null = null
  hourBuckets.forEach((total, hour) => {
    if (!peakHour || total > peakHour.total) {
      peakHour = { hour, total }
    }
  })

  const itemTotals = currentSales.reduce((acc, sale) => {
    const items = sale.items ?? []
    items.forEach(item => {
      const qty = item.qty ?? 0
      if (!qty) return
      const key = item.productId
      if (!key) return
      const existing = acc.get(key) ?? { name: item.name ?? 'Unnamed product', qty: 0 }
      existing.qty += qty
      if (item.name && !existing.name) {
        existing.name = item.name
      }
      acc.set(key, existing)
    })
    return acc
  }, new Map<string, { name: string; qty: number }>())

  let topItem: { name: string; qty: number } | null = null
  itemTotals.forEach(value => {
    if (!topItem || value.qty > topItem.qty) {
      topItem = value
    }
  })

  const comparisonLabel = previousSales.length
    ? `vs previous ${rangeDays === 1 ? 'day' : `${rangeDays} days`}`
    : 'No prior data'

  const rangeLabel = useMemo(() => {
    if (resolvedRangeId === 'custom') {
      return formatDateRange(rangeStart, rangeEnd)
    }
    return RANGE_PRESETS.find(option => option.id === resolvedRangeId)?.label ?? 'Selected range'
  }, [resolvedRangeId, rangeStart, rangeEnd])

  const revenueSeries = useMemo(
    () => buildDailyMetricSeries(currentSales, rangeStart, rangeEnd, 'revenue'),
    [currentSales, rangeStart, rangeEnd],
  )
  const previousRevenueSeries = useMemo(
    () => buildDailyMetricSeries(previousSales, previousRangeStart, previousRangeEnd, 'revenue'),
    [previousSales, previousRangeStart, previousRangeEnd],
  )
  const ticketSeries = useMemo(
    () => buildDailyMetricSeries(currentSales, rangeStart, rangeEnd, 'ticket'),
    [currentSales, rangeStart, rangeEnd],
  )
  const previousTicketSeries = useMemo(
    () => buildDailyMetricSeries(previousSales, previousRangeStart, previousRangeEnd, 'ticket'),
    [previousSales, previousRangeStart, previousRangeEnd],
  )
  const salesCountSeries = useMemo(
    () => buildDailyMetricSeries(currentSales, rangeStart, rangeEnd, 'count'),
    [currentSales, rangeStart, rangeEnd],
  )
  const previousSalesCountSeries = useMemo(
    () => buildDailyMetricSeries(previousSales, previousRangeStart, previousRangeEnd, 'count'),
    [previousSales, previousRangeStart, previousRangeEnd],
  )

  const receiptsInRange = useMemo(
    () =>
      receipts.filter(record => {
        const created = asDate(record.createdAt)
        return created ? created >= rangeStart && created <= rangeEnd : false
      }),
    [receipts, rangeStart, rangeEnd],
  )

  const previousReceipts = useMemo(
    () =>
      receipts.filter(record => {
        const created = asDate(record.createdAt)
        return created ? created >= previousRangeStart && created <= previousRangeEnd : false
      }),
    [receipts, previousRangeStart, previousRangeEnd],
  )

  const saleLedgerEntries = useMemo(
    () => ledgerEntries.filter(entry => entry.type === 'sale'),
    [ledgerEntries],
  )

  const currentSaleLedgerEntries = useMemo(
    () =>
      saleLedgerEntries.filter(entry => {
        const created = asDate(entry.createdAt)
        return created ? created >= rangeStart && created <= rangeEnd : false
      }),
    [saleLedgerEntries, rangeStart, rangeEnd],
  )

  const previousSaleLedgerEntries = useMemo(
    () =>
      saleLedgerEntries.filter(entry => {
        const created = asDate(entry.createdAt)
        return created ? created >= previousRangeStart && created <= previousRangeEnd : false
      }),
    [saleLedgerEntries, previousRangeStart, previousRangeEnd],
  )

  const productCostSnapshots = useMemo(() => {
    const groupedReceipts = new Map<string, ReceiptRecord[]>()

    receipts.forEach(receipt => {
      const productId = typeof receipt.productId === 'string' ? receipt.productId : null
      if (!productId) return
      const group = groupedReceipts.get(productId) ?? []
      group.push(receipt)
      groupedReceipts.set(productId, group)
    })

    const snapshotMap = new Map<string, ProductCostSnapshot[]>()

    groupedReceipts.forEach((productReceipts, productId) => {
      const sortedReceipts = productReceipts
        .map(receipt => ({ receipt, created: asDate(receipt.createdAt) ?? new Date(0) }))
        .sort((a, b) => a.created.getTime() - b.created.getTime())

      let totalQty = 0
      let totalCost = 0
      let lastUnitCost: number | null = null
      const snapshots: ProductCostSnapshot[] = []

      sortedReceipts.forEach(({ receipt, created }) => {
        const qty = Number(receipt.qty ?? 0) || 0
        const cost = resolveReceiptCost(receipt)
        if (cost !== null) {
          totalQty += qty
          totalCost += cost
        }

        const unitCost =
          typeof receipt.unitCost === 'number' && Number.isFinite(receipt.unitCost)
            ? receipt.unitCost
            : null
        if (unitCost !== null) {
          lastUnitCost = unitCost
        }

        snapshots.push({
          createdAt: created,
          totalQty,
          totalCost,
          lastUnitCost,
        })
      })

      if (snapshots.length) {
        snapshotMap.set(productId, snapshots)
      }
    })

    return snapshotMap
  }, [receipts])

  const resolveUnitCost = useCallback<UnitCostResolver>(
    (productId, createdAt) => {
      if (!productId) return 0
      const snapshots = productCostSnapshots.get(productId)
      if (!snapshots || snapshots.length === 0) return 0

      const targetTime = createdAt ? createdAt.getTime() : null
      let snapshot: ProductCostSnapshot | undefined

      if (targetTime === null) {
        snapshot = snapshots[snapshots.length - 1]
      } else {
        for (let index = snapshots.length - 1; index >= 0; index -= 1) {
          const candidate = snapshots[index]
          if (candidate.createdAt.getTime() <= targetTime) {
            snapshot = candidate
            break
          }
        }
      }

      if (!snapshot) {
        return 0
      }

      if (snapshot.totalQty > 0 && snapshot.totalCost > 0) {
        return snapshot.totalCost / snapshot.totalQty
      }
      return snapshot.lastUnitCost ?? 0
    },
    [productCostSnapshots],
  )

  const currentCogs = useMemo(
    () => calculateLedgerCogs(currentSaleLedgerEntries, resolveUnitCost),
    [currentSaleLedgerEntries, resolveUnitCost],
  )

  const previousCogs = useMemo(
    () => calculateLedgerCogs(previousSaleLedgerEntries, resolveUnitCost),
    [previousSaleLedgerEntries, resolveUnitCost],
  )

  const cogsSeries = useMemo(
    () => buildDailyLedgerCostSeries(currentSaleLedgerEntries, rangeStart, rangeEnd, resolveUnitCost),
    [currentSaleLedgerEntries, rangeStart, rangeEnd, resolveUnitCost],
  )

  const previousCogsSeries = useMemo(
    () =>
      buildDailyLedgerCostSeries(previousSaleLedgerEntries, previousRangeStart, previousRangeEnd, resolveUnitCost),
    [previousSaleLedgerEntries, previousRangeStart, previousRangeEnd, resolveUnitCost],
  )

  const currentUnitsSold = useMemo(
    () =>
      currentSaleLedgerEntries.reduce(
        (sum, entry) => sum + Math.abs(Number(entry.qtyChange ?? 0) || 0),
        0,
      ),
    [currentSaleLedgerEntries],
  )

  const currentReceivedCost = useMemo(
    () =>
      receiptsInRange.reduce((sum, receipt) => {
        const cost = resolveReceiptCost(receipt)
        return sum + (cost ?? 0)
      }, 0),
    [receiptsInRange],
  )

  const previousReceivedCost = useMemo(
    () =>
      previousReceipts.reduce((sum, receipt) => {
        const cost = resolveReceiptCost(receipt)
        return sum + (cost ?? 0)
      }, 0),
    [previousReceipts],
  )

  const currentReceivedQty = useMemo(
    () => receiptsInRange.reduce((sum, receipt) => sum + (Number(receipt.qty ?? 0) || 0), 0),
    [receiptsInRange],
  )

  const receiptCostSeries = useMemo(
    () => buildDailyReceiptSeries(receiptsInRange, rangeStart, rangeEnd, 'cost'),
    [receiptsInRange, rangeStart, rangeEnd],
  )

  const previousReceiptCostSeries = useMemo(
    () =>
      buildDailyReceiptSeries(previousReceipts, previousRangeStart, previousRangeEnd, 'cost'),
    [previousReceipts, previousRangeStart, previousRangeEnd],
  )

  const receivedCostChange = useMemo(() => {
    if (previousReceivedCost > 0) {
      return ((currentReceivedCost - previousReceivedCost) / previousReceivedCost) * 100
    }
    return null
  }, [currentReceivedCost, previousReceivedCost])

  const cogsChange = useMemo(() => {
    if (previousCogs > 0) {
      return ((currentCogs - previousCogs) / previousCogs) * 100
    }
    return null
  }, [currentCogs, previousCogs])

  const currentMargin = useMemo(() => currentRevenue - currentCogs, [currentRevenue, currentCogs])
  const previousMargin = useMemo(() => previousRevenue - previousCogs, [previousRevenue, previousCogs])

  const marginChange = useMemo(() => {
    if (Math.abs(previousMargin) > 0.01) {
      return ((currentMargin - previousMargin) / Math.abs(previousMargin)) * 100
    }
    return null
  }, [currentMargin, previousMargin])

  const grossMarginPercent = useMemo(() => {
    if (currentRevenue > 0) {
      return ((currentRevenue - currentCogs) / currentRevenue) * 100
    }
    return null
  }, [currentRevenue, currentCogs])

  const marginSeries = useMemo(
    () => revenueSeries.map((value, index) => value - (cogsSeries[index] ?? 0)),
    [revenueSeries, cogsSeries],
  )

  const previousMarginSeries = useMemo(
    () => previousRevenueSeries.map((value, index) => value - (previousCogsSeries[index] ?? 0)),
    [previousRevenueSeries, previousCogsSeries],
  )

  const hasPreviousCostData = previousReceipts.length > 0 || previousSaleLedgerEntries.length > 0
  const costComparisonLabel = hasPreviousCostData
    ? `vs previous ${rangeDays === 1 ? 'day' : `${rangeDays} days`}`
    : 'No prior data'

  const metrics: MetricCard[] = [
    {
      id: 'revenue',
      title: 'Revenue',
      subtitle: rangeLabel,
      value: formatAmount(currentRevenue),
      changePercent: salesChange,
      changeDescription: comparisonLabel,
      sparkline: revenueSeries,
      comparisonSparkline: previousRevenueSeries,
    },
    {
      id: 'ticket',
      title: 'Average basket',
      subtitle: rangeLabel,
      value: formatAmount(currentTicket),
      changePercent: ticketChange,
      changeDescription: comparisonLabel,
      sparkline: ticketSeries,
      comparisonSparkline: previousTicketSeries,
    },
    {
      id: 'transactions',
      title: 'Transactions recorded',
      subtitle: rangeLabel,
      value: `${currentSales.length}`,
      changePercent: salesCountChange,
      changeDescription: comparisonLabel,
      sparkline: salesCountSeries,
      comparisonSparkline: previousSalesCountSeries,
    },
    {
      id: 'inventory',
      title: 'Inventory value',
      subtitle: 'Current snapshot',
      value: formatAmount(inventoryValue),
      changePercent: null,
      changeDescription: `${outOfStockCount} out-of-stock`,
      sparkline: null,
      comparisonSparkline: null,
    },
  ]

  const costMetrics: MetricCard[] = [
    {
      id: 'cogs',
      title: 'Cost of goods sold',
      subtitle: rangeLabel,
      value: formatAmount(currentCogs),
      changePercent: cogsChange,
      changeDescription: costComparisonLabel,
      sparkline: cogsSeries,
      comparisonSparkline: previousCogsSeries,
    },
    {
      id: 'received-cost',
      title: 'Stock received cost',
      subtitle: rangeLabel,
      value: formatAmount(currentReceivedCost),
      changePercent: receivedCostChange,
      changeDescription: costComparisonLabel,
      sparkline: receiptCostSeries,
      comparisonSparkline: previousReceiptCostSeries,
    },
    {
      id: 'gross-margin',
      title: 'Gross margin',
      subtitle: rangeLabel,
      value: formatAmount(currentMargin),
      changePercent: marginChange,
      changeDescription: costComparisonLabel,
      sparkline: marginSeries,
      comparisonSparkline: previousMarginSeries,
    },
  ]

  const costSummary = useMemo<CostSummary>(() => {
    const averageCost =
      currentReceivedQty > 0
        ? currentReceivedCost / currentReceivedQty
        : receiptsInRange.length > 0
        ? 0
        : null

    return {
      receivedQty: currentReceivedQty,
      unitsSold: currentUnitsSold,
      averageReceivedCost: averageCost,
      grossMarginPercent,
    }
  }, [
    currentReceivedQty,
    currentUnitsSold,
    currentReceivedCost,
    receiptsInRange.length,
    grossMarginPercent,
  ])

  const supplierInsights = useMemo<SupplierInsight[]>(() => {
    const stats = new Map<
      string,
      { totalCost: number; totalQty: number; receiptCount: number; lastReceivedAt: Date | null }
    >()
    receiptsInRange.forEach(receipt => {
      const supplier =
        typeof receipt.supplier === 'string' && receipt.supplier.trim()
          ? receipt.supplier.trim()
          : 'Unknown supplier'
      const current =
        stats.get(supplier) ?? { totalCost: 0, totalQty: 0, receiptCount: 0, lastReceivedAt: null }
      const cost = resolveReceiptCost(receipt)
      if (cost !== null) {
        current.totalCost += cost
      }
      current.totalQty += Number(receipt.qty ?? 0) || 0
      current.receiptCount += 1
      const created = asDate(receipt.createdAt)
      if (created && (!current.lastReceivedAt || created > current.lastReceivedAt)) {
        current.lastReceivedAt = created
      }
      stats.set(supplier, current)
    })

    return Array.from(stats.entries())
      .map(([supplier, info]) => ({
        supplier,
        totalCost: info.totalCost,
        totalQty: info.totalQty,
        receiptCount: info.receiptCount,
        averageUnitCost: info.totalQty > 0 ? info.totalCost / info.totalQty : null,
        lastReceivedAt: info.lastReceivedAt,
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 5)
  }, [receiptsInRange])

  const goalMonthDate = useMemo(() => parseMonthInput(selectedGoalMonth) ?? startOfMonth(today), [selectedGoalMonth, today])
  const goalMonthStart = useMemo(() => startOfMonth(goalMonthDate), [goalMonthDate])
  const goalMonthEnd = useMemo(() => endOfMonth(goalMonthDate), [goalMonthDate])
  const goalMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(goalMonthDate),
    [goalMonthDate],
  )

  const goalMonthRevenue = useMemo(
    () =>
      sales.reduce((sum, sale) => {
        const created = asDate(sale.createdAt)
        if (!created || created < goalMonthStart || created > goalMonthEnd) return sum
        return sum + (sale.total ?? 0)
      }, 0),
    [sales, goalMonthStart, goalMonthEnd],
  )

  const goalMonthCustomers = useMemo(
    () =>
      customers.reduce((count, customer) => {
        const created = asDate(customer.createdAt)
        if (!created || created < goalMonthStart || created > goalMonthEnd) return count
        return count + 1
      }, 0),
    [customers, goalMonthStart, goalMonthEnd],
  )

  const activeTargets = useMemo(() => {
    const entry = monthlyGoals[selectedGoalMonth]
    return {
      revenueTarget: entry?.revenueTarget ?? DEFAULT_REVENUE_TARGET,
      customerTarget: entry?.customerTarget ?? DEFAULT_CUSTOMER_TARGET,
    }
  }, [monthlyGoals, selectedGoalMonth])

  const goals: GoalProgress[] = [
    {
      title: `${goalMonthLabel} revenue`,
      value: formatAmount(goalMonthRevenue),
      target: `Goal ${formatAmount(activeTargets.revenueTarget)}`,
      progress: Math.min(
        1,
        activeTargets.revenueTarget ? goalMonthRevenue / activeTargets.revenueTarget : 0,
      ),
    },
    {
      title: `${goalMonthLabel} new customers`,
      value: `${goalMonthCustomers}`,
      target: `Goal ${activeTargets.customerTarget}`,
      progress: Math.min(
        1,
        activeTargets.customerTarget ? goalMonthCustomers / activeTargets.customerTarget : 0,
      ),
    },
  ]

  const rangeSummary = useMemo(() => formatDateRange(rangeStart, rangeEnd), [rangeStart, rangeEnd])
  const rangeDaysLabel = rangeDays === 1 ? '1 day' : `${rangeDays} days`
  const showCustomHint = selectedRangeId === 'custom' && resolvedRangeId !== 'custom'

  function handleRangePresetChange(id: PresetRangeId) {
    setSelectedRangeId(id)
  }

  function handleCustomDateChange(field: 'start' | 'end', value: string) {
    setSelectedRangeId('custom')
    setCustomRange(current => ({ ...current, [field]: value }))
  }

  function handleGoalMonthChange(value: string) {
    setSelectedGoalMonth(value || defaultMonthKey)
  }

  function handleGoalInputChange(field: keyof GoalFormValues, value: string) {
    setGoalFormTouched(true)
    setGoalFormValues(current => ({ ...current, [field]: value }))
  }

  async function handleGoalSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!activeStoreId) {
      publish({ tone: 'error', message: 'Select a store to save goals.' })
      return
    }

    setIsSavingGoals(true)
    try {
      const revenueValue = Number(goalFormValues.revenueTarget)
      const customerValue = Number(goalFormValues.customerTarget)
      const revenueTarget = Number.isFinite(revenueValue) ? Math.max(0, revenueValue) : 0
      const customerTarget = Number.isFinite(customerValue) ? Math.max(0, customerValue) : 0
      const monthKey = selectedGoalMonth || defaultMonthKey

      await setDoc(
        doc(db, 'storeGoals', goalDocumentId),
        {
          monthly: {
            [monthKey]: {
              revenueTarget,
              customerTarget,
            },
          },
        },
        { merge: true },
      )

      setGoalFormTouched(false)
      setGoalFormValues({
        revenueTarget: String(revenueTarget),
        customerTarget: String(customerTarget),
      })
      publish({ tone: 'success', message: `Goals updated for ${goalMonthLabel}.` })
    } catch (error) {
      console.error('[metrics] Unable to save goals', error)
      publish({ tone: 'error', message: 'Unable to save goals right now.' })
    } finally {
      setIsSavingGoals(false)
    }
  }

  const inventoryAlerts = lowStock.slice(0, 5)

  const teamCallouts: TeamCallout[] = [
    {
      label: 'Peak sales hour',
      value: peakHour ? formatHourRange(peakHour.hour) : '—',
      description: peakHour
        ? `${formatAmount(peakHour.total)} sold during this hour across the selected range.`
        : 'No sales recorded for this range yet.',
    },
    {
      label: 'Top product',
      value: topItem ? topItem.name : '—',
      description: topItem
        ? `${topItem.qty} sold across the selected range.`
        : 'Record sales to surface bestsellers.',
    },
    {
      label: 'Inventory alerts',
      value: `${lowStock.length} low / ${outOfStockCount} out`,
      description: lowStock.length || outOfStockCount
        ? 'Review products that need restocking.'
        : 'All products are above reorder thresholds.',
    },
  ]

  return {
    rangePresets: RANGE_PRESETS,
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
    costMetrics,
    costSummary,
    supplierInsights,
  }
}

export type {
  MetricCard,
  GoalProgress,
  InventoryAlert,
  TeamCallout,
  PresetRangeId,
  CustomRange,
  RangePreset,
  CostSummary,
  SupplierInsight,
}
