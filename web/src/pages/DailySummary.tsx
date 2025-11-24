import React, { useEffect, useMemo, useState } from 'react'
import { Timestamp, collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import PageSection from '../layout/PageSection'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './DailySummary.css'

type ProductAggregate = {
  id: string
  name: string
  qty: number
  revenue: number
}

function getTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
  }
}

function formatCurrency(value: number) {
  return `GHS ${value.toFixed(2)}`
}

export default function DailySummary() {
  const { storeId } = useActiveStore()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalSales, setTotalSales] = useState(0)
  const [totalTax, setTotalTax] = useState(0)
  const [receiptCount, setReceiptCount] = useState(0)
  const [totalDiscount, setTotalDiscount] = useState(0)
  const [topProducts, setTopProducts] = useState<ProductAggregate[]>([])

  useEffect(() => {
    if (!storeId) {
      setIsLoading(false)
      setError('Select a workspace to see your daily summary.')
      setTotalSales(0)
      setTotalTax(0)
      setReceiptCount(0)
      setTotalDiscount(0)
      setTopProducts([])
      return () => {
        /* noop */
      }
    }

    const { start, end } = getTodayRange()

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', storeId),
      where('createdAt', '>=', start),
      where('createdAt', '<', end),
      orderBy('createdAt', 'desc'),
    )

    setIsLoading(true)
    setError(null)

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        let salesTotal = 0
        let taxTotal = 0
        let receipts = 0
        let discountTotal = 0
        const aggregate = new Map<string, ProductAggregate>()

        snapshot.forEach(docSnap => {
          const data = docSnap.data()
          const saleTotal = Number(data.total ?? 0) || 0
          const saleTax = Number(data.taxTotal ?? 0) || 0
          const saleDiscount = Number((data as any)?.discountTotal ?? (data as any)?.discountAmount ?? 0) || 0
          salesTotal += saleTotal
          taxTotal += saleTax
          receipts += 1
          discountTotal += saleDiscount

          const items = Array.isArray(data.items) ? data.items : []
          items.forEach(item => {
            const qty = Number((item as any)?.qty ?? 0) || 0
            const price = Number((item as any)?.price ?? 0) || 0
            const nameCandidate = typeof (item as any)?.name === 'string' ? (item as any).name.trim() : ''
            const name = nameCandidate || 'Unknown product'
            const idCandidate = typeof (item as any)?.productId === 'string' ? (item as any).productId : name
            const key = idCandidate || name
            const current = aggregate.get(key) ?? { id: key, name, qty: 0, revenue: 0 }
            current.qty += qty
            current.revenue += qty * price
            aggregate.set(key, current)
          })
        })

        const top = Array.from(aggregate.values())
          .sort((a, b) => {
            if (b.qty !== a.qty) return b.qty - a.qty
            return b.revenue - a.revenue
          })
          .slice(0, 5)

        setTotalSales(salesTotal)
        setTotalTax(taxTotal)
        setReceiptCount(receipts)
        setTotalDiscount(discountTotal)
        setTopProducts(top)
        setIsLoading(false)
      },
      error => {
        console.error('[daily-summary] Failed to load sales snapshot', error)
        setError('We could not load today\'s summary. Please try again.')
        setIsLoading(false)
      },
    )

    return () => unsubscribe()
  }, [storeId])

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    [],
  )

  return (
    <PageSection
      title="Daily summary"
      subtitle="See how today is performing at a glance."
      cardClassName="daily-summary"
    >
      <header className="daily-summary__header">
        <div>
          <p className="daily-summary__date">Today • {todayLabel}</p>
          <p className="daily-summary__hint">Numbers update live as sales are recorded.</p>
        </div>
        {isLoading && <span className="daily-summary__status">Loading…</span>}
        {error && !isLoading && <span className="daily-summary__status daily-summary__status--error">{error}</span>}
      </header>

      {!storeId ? (
        <div className="empty-state" role="status" aria-live="polite">
          <h3 className="empty-state__title">Choose a workspace</h3>
          <p>You\'ll see today\'s totals once a workspace is selected.</p>
        </div>
      ) : (
        <>
          <div className="daily-summary__metrics" aria-live="polite">
            <div className="daily-summary__metric">
              <span className="daily-summary__metric-label">Total sales</span>
              <strong className="daily-summary__metric-value">{formatCurrency(totalSales)}</strong>
            </div>
            <div className="daily-summary__metric">
              <span className="daily-summary__metric-label">Total tax</span>
              <strong className="daily-summary__metric-value">{formatCurrency(totalTax)}</strong>
            </div>
            <div className="daily-summary__metric">
              <span className="daily-summary__metric-label">Discounts given</span>
              <strong className="daily-summary__metric-value">{formatCurrency(totalDiscount)}</strong>
            </div>
            <div className="daily-summary__metric">
              <span className="daily-summary__metric-label">Number of receipts</span>
              <strong className="daily-summary__metric-value">{receiptCount}</strong>
            </div>
          </div>

          <section className="daily-summary__top-products">
            <header className="daily-summary__section-header">
              <h3>Top-selling products</h3>
              <p>Based on quantity sold today.</p>
            </header>
            {topProducts.length === 0 ? (
              <p className="daily-summary__empty">No products sold yet today.</p>
            ) : (
              <div className="daily-summary__table-wrapper">
                <table className="daily-summary__table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col" className="is-numeric">Quantity</th>
                      <th scope="col" className="is-numeric">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map(product => (
                      <tr key={product.id}>
                        <td>{product.name}</td>
                        <td className="is-numeric">{product.qty}</td>
                        <td className="is-numeric">{formatCurrency(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </PageSection>
  )
}
