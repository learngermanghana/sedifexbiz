import React, { useEffect, useMemo, useState } from 'react'
import { loadCachedProducts, loadCachedSales } from '../utils/offlineCache'
import { useActiveStore } from '../hooks/useActiveStore'
import './Metrics.css'

type TimestampLike = { toDate?: () => Date; seconds?: number; nanoseconds?: number }

type SaleItem = {
  productId?: string | null
  name?: string | null
  price?: number | null
  qty?: number | null
}

type SaleRecord = {
  id: string
  total?: number | null
  createdAt?: Date | TimestampLike | null
  items?: SaleItem[] | null
}

type ProductRecord = {
  id: string
  name?: string | null
  price?: number | null
  stockCount?: number | null
}

type TrendPoint = {
  label: string
  value: number
  date: Date
}

type MetricsState = 'idle' | 'loading' | 'ready' | 'error'

function asDate(value?: Date | TimestampLike | null): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate()
      } catch (error) {
        console.warn('[metrics] Failed to convert timestamp via toDate', error)
      }
    }
    if (typeof value.seconds === 'number') {
      const millis = value.seconds * 1000 + Math.round((value.nanoseconds ?? 0) / 1_000_000)
      if (Number.isFinite(millis)) {
        return new Date(millis)
      }
    }
  }
  return null
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

function isWithinRange(value: Date | null, start: Date, end: Date) {
  if (!value) return false
  const time = value.getTime()
  return time >= start.getTime() && time <= end.getTime()
}

function calculateSaleTotal(sale: SaleRecord): number {
  if (typeof sale.total === 'number' && Number.isFinite(sale.total)) {
    return sale.total
  }

  if (Array.isArray(sale.items)) {
    return sale.items.reduce((acc, item) => {
      const qty = typeof item.qty === 'number' ? item.qty : 0
      const price = typeof item.price === 'number' ? item.price : 0
      return acc + qty * price
    }, 0)
  }

  return 0
}

function calculateSaleUnits(sale: SaleRecord): number {
  if (!Array.isArray(sale.items)) return 0
  return sale.items.reduce((acc, item) => {
    const qty = typeof item.qty === 'number' ? item.qty : 0
    return acc + Math.max(0, qty)
  }, 0)
}

function formatCurrency(value: number) {
  return `GHS ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatPercent(value: number, { showSign = true }: { showSign?: boolean } = {}) {
  const sign = showSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function formatTurns(value: number) {
  return value.toFixed(2)
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

const TREND_DAYS = 7
const WINDOW_DAYS = 30

export default function Metrics() {
  const { storeId, isLoading: isStoreLoading } = useActiveStore()
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [status, setStatus] = useState<MetricsState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false

    async function load() {
      if (isStoreLoading) {
        return
      }

      setStatus('loading')
      setError(null)

      try {
        const [salesData, productData] = await Promise.all([
          loadCachedSales<SaleRecord>({ storeId }),
          loadCachedProducts<ProductRecord>({ storeId }),
        ])

        if (!isCancelled) {
          setSales(salesData)
          setProducts(productData)
          setStatus('ready')
        }
      } catch (loadError) {
        if (isCancelled) return
        console.error('[metrics] Failed to load cached data', loadError)
        setSales([])
        setProducts([])
        setStatus('error')
        setError('We could not load your latest metrics. Try refreshing the page.')
      }
    }

    void load()

    return () => {
      isCancelled = true
    }
  }, [storeId, isStoreLoading])

  const summary = useMemo(() => {
    if (status !== 'ready') {
      return {
        totalRevenue: 0,
        averageOrderValue: 0,
        salesGrowth: 0,
        inventoryTurns: 0,
        sellThroughRate: 0,
        trend: [] as TrendPoint[],
        topProducts: [] as Array<{ id: string; name: string; qty: number; revenue: number }>,
        ordersCount: 0,
      }
    }

    const today = new Date()
    const windowStart = startOfDay(addDays(today, -(WINDOW_DAYS - 1)))
    const windowEnd = endOfDay(today)
    const currentRangeStart = startOfDay(addDays(today, -(TREND_DAYS - 1)))
    const previousRangeStart = startOfDay(addDays(currentRangeStart, -TREND_DAYS))
    const previousRangeEnd = endOfDay(addDays(currentRangeStart, -1))

    let totalRevenue = 0
    let ordersCount = 0
    let totalUnits = 0
    let currentRangeRevenue = 0
    let previousRangeRevenue = 0

    const productIndex = new Map<string, ProductRecord>()
    products.forEach(product => {
      productIndex.set(product.id, product)
    })

    const productPerformance = new Map<string, { id: string; name: string; qty: number; revenue: number }>()

    sales.forEach(sale => {
      const createdAt = asDate(sale.createdAt)
      const saleTotal = calculateSaleTotal(sale)
      const saleUnits = calculateSaleUnits(sale)
      const isInWindow = !createdAt || isWithinRange(createdAt, windowStart, windowEnd)

      if (isInWindow) {
        totalRevenue += saleTotal
        totalUnits += saleUnits
        ordersCount += 1
      }

      if (isWithinRange(createdAt, currentRangeStart, windowEnd)) {
        currentRangeRevenue += saleTotal
      } else if (isWithinRange(createdAt, previousRangeStart, previousRangeEnd)) {
        previousRangeRevenue += saleTotal
      }

      if (!isInWindow || !Array.isArray(sale.items)) {
        return
      }

      sale.items.forEach(item => {
        const productId = item.productId ?? undefined
        const key = productId ?? item.name ?? 'unknown'
        if (!key) return
        const existing = productPerformance.get(key) ?? {
          id: productId ?? key,
          name: productIndex.get(productId ?? '')?.name ?? item.name ?? 'Unnamed item',
          qty: 0,
          revenue: 0,
        }
        const qty = typeof item.qty === 'number' ? Math.max(0, item.qty) : 0
        const price = typeof item.price === 'number' ? item.price : 0
        existing.qty += qty
        existing.revenue += qty * price
        productPerformance.set(key, existing)
      })
    })

    const totalStockOnHand = products.reduce((acc, product) => {
      const stock = typeof product.stockCount === 'number' ? Math.max(0, product.stockCount) : 0
      return acc + stock
    }, 0)

    const averageInventory = totalStockOnHand > 0 ? (totalStockOnHand + Math.max(totalStockOnHand - totalUnits, 0)) / 2 : totalUnits
    const inventoryTurns = averageInventory > 0 ? totalUnits / averageInventory : 0
    const sellThroughRate = totalUnits + totalStockOnHand > 0 ? (totalUnits / (totalUnits + totalStockOnHand)) * 100 : 0

    const salesGrowth = previousRangeRevenue > 0
      ? ((currentRangeRevenue - previousRangeRevenue) / previousRangeRevenue) * 100
      : currentRangeRevenue > 0
        ? 100
        : 0

    const trend: TrendPoint[] = Array.from({ length: TREND_DAYS }).map((_, index) => {
      const day = startOfDay(addDays(today, index - (TREND_DAYS - 1)))
      const end = endOfDay(day)
      const value = sales.reduce((acc, sale) => {
        const createdAt = asDate(sale.createdAt)
        if (!createdAt) return acc
        return isWithinRange(createdAt, day, end) ? acc + calculateSaleTotal(sale) : acc
      }, 0)

      return {
        label: WEEKDAY_FORMATTER.format(day),
        value,
        date: day,
      }
    })

    const topProducts = Array.from(productPerformance.values())
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
      .slice(0, 5)

    const averageOrderValue = ordersCount > 0 ? totalRevenue / ordersCount : 0

    return {
      totalRevenue,
      averageOrderValue,
      salesGrowth,
      inventoryTurns,
      sellThroughRate,
      trend,
      topProducts,
      ordersCount,
    }
  }, [products, sales, status])

  const hasData = status === 'ready' && (summary.ordersCount > 0 || products.length > 0)

  return (
    <div className="metrics-page" data-status={status}>
      <header className="metrics-page__header">
        <h1 className="metrics-page__title">Metrics overview</h1>
        <p className="metrics-page__subtitle">
          Keep an eye on key performance indicators across sales velocity and inventory health.
        </p>
      </header>

      {status === 'loading' && (
        <div role="status" className="metrics-page__loading">
          Loading metrics…
        </div>
      )}

      {status === 'error' && error && (
        <div role="alert" className="metrics-page__error">
          {error}
        </div>
      )}

      {status === 'ready' && !hasData && (
        <section className="metrics-page__empty">
          <h2>No metrics yet</h2>
          <p>
            We’ll populate this dashboard as you record sales and update your product catalogue. Check back
            after syncing recent activity.
          </p>
        </section>
      )}

      {hasData && (
        <>
          <section className="metrics-page__kpi-grid" aria-label="Key performance indicators">
            <article className="metrics-page__kpi-card">
              <h2>Total revenue</h2>
              <p className="metrics-page__kpi-value">{formatCurrency(summary.totalRevenue)}</p>
              <p className="metrics-page__kpi-meta">Last {WINDOW_DAYS} days</p>
            </article>
            <article className="metrics-page__kpi-card">
              <h2>Average order value</h2>
              <p className="metrics-page__kpi-value">{formatCurrency(summary.averageOrderValue)}</p>
              <p className="metrics-page__kpi-meta">Across {summary.ordersCount} orders</p>
            </article>
            <article className="metrics-page__kpi-card">
              <h2>Sales growth</h2>
              <p className={`metrics-page__kpi-value${summary.salesGrowth < 0 ? ' is-negative' : ''}`}>
                {formatPercent(summary.salesGrowth)}
              </p>
              <p className="metrics-page__kpi-meta">vs. prior {TREND_DAYS} days</p>
            </article>
            <article className="metrics-page__kpi-card">
              <h2>Inventory turns</h2>
              <p className="metrics-page__kpi-value">{formatTurns(summary.inventoryTurns)}</p>
              <p className="metrics-page__kpi-meta">Approximate turns in the last {WINDOW_DAYS} days</p>
            </article>
            <article className="metrics-page__kpi-card">
              <h2>Sell-through</h2>
              <p className="metrics-page__kpi-value">{formatPercent(summary.sellThroughRate, { showSign: false })}</p>
              <p className="metrics-page__kpi-meta">Units sold vs. current stock</p>
            </article>
          </section>

          <section className="metrics-page__panel">
            <div className="metrics-page__panel-header">
              <h2>7-day sales trend</h2>
              <p>Spot acceleration or slowdowns in revenue at a glance.</p>
            </div>
            <ul className="metrics-page__trend" role="list">
              {summary.trend.map(point => {
                const max = summary.trend.reduce((acc, value) => Math.max(acc, value.value), 0)
                const percent = max > 0 ? Math.round((point.value / max) * 100) : 0
                return (
                  <li key={point.label} className="metrics-page__trend-point">
                    <span className="metrics-page__trend-bar" style={{ '--trend-height': `${percent}%` } as React.CSSProperties}>
                      <span className="metrics-page__trend-bar-fill" />
                    </span>
                    <span className="metrics-page__trend-label">{point.label}</span>
                    <span className="metrics-page__trend-value">{formatCurrency(point.value)}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="metrics-page__panel">
            <div className="metrics-page__panel-header">
              <h2>Top performers</h2>
              <p>Products driving the most movement in the last {WINDOW_DAYS} days.</p>
            </div>
            <ul className="metrics-page__top-products" role="list">
              {summary.topProducts.map(product => (
                <li key={product.id} className="metrics-page__top-product" data-testid={`top-product-${product.id}`}>
                  <div>
                    <span className="metrics-page__top-product-name">{product.name}</span>
                    <span className="metrics-page__top-product-meta">{product.qty} units sold</span>
                  </div>
                  <span className="metrics-page__top-product-value">{formatCurrency(product.revenue)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
