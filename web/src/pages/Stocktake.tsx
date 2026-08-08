import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './Stocktake.css'

type StockItem = {
  id: string
  name: string
  sku: string
  stockCount: number
}

type CountMap = Record<string, string>

function numberOrZero(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export default function Stocktake() {
  const { storeId, isLoading: storeLoading } = useActiveStore()
  const [items, setItems] = useState<StockItem[]>([])
  const [counts, setCounts] = useState<CountMap>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showDifferencesOnly, setShowDifferencesOnly] = useState(false)

  useEffect(() => {
    if (!storeId) {
      setItems([])
      setLoading(false)
      return
    }

    setLoading(true)
    const productsQuery = query(collection(db, 'products'), where('storeId', '==', storeId))
    return onSnapshot(
      productsQuery,
      snapshot => {
        const rows = snapshot.docs
          .map(productDoc => {
            const data = productDoc.data() as Record<string, unknown>
            const itemType = typeof data.itemType === 'string' ? data.itemType : 'product'
            if (itemType !== 'product') return null
            return {
              id: productDoc.id,
              name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Unnamed product',
              sku: typeof data.sku === 'string' && data.sku.trim() ? data.sku.trim() : typeof data.barcode === 'string' ? data.barcode : '',
              stockCount: numberOrZero(data.stockCount),
            } satisfies StockItem
          })
          .filter((item): item is StockItem => Boolean(item))
          .sort((a, b) => a.name.localeCompare(b.name))
        setItems(rows)
        setLoading(false)
      },
      () => {
        setItems([])
        setLoading(false)
        setMessage('We could not load the inventory list. Please try again.')
      },
    )
  }, [storeId])

  const reviewedCount = useMemo(
    () => items.filter(item => counts[item.id]?.trim() !== '').length,
    [counts, items],
  )

  const differenceCount = useMemo(
    () => items.filter(item => {
      const input = counts[item.id]
      if (input == null || input.trim() === '') return false
      const counted = Number(input)
      return Number.isFinite(counted) && counted !== item.stockCount
    }).length,
    [counts, items],
  )

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter(item => {
      const input = counts[item.id]
      const counted = input == null || input.trim() === '' ? null : Number(input)
      const hasDifference = counted !== null && Number.isFinite(counted) && counted !== item.stockCount
      if (showDifferencesOnly && !hasDifference) return false
      if (!term) return true
      return `${item.name} ${item.sku}`.toLowerCase().includes(term)
    })
  }, [counts, items, search, showDifferencesOnly])

  const saveReviewedCounts = async () => {
    if (!storeId || saving) return
    const reviewed = items.filter(item => counts[item.id]?.trim() !== '')
    if (!reviewed.length) {
      setMessage('Enter at least one counted quantity first.')
      return
    }

    const invalid = reviewed.find(item => {
      const value = Number(counts[item.id])
      return !Number.isFinite(value) || value < 0 || !Number.isInteger(value)
    })
    if (invalid) {
      setMessage(`Enter a whole number of 0 or more for ${invalid.name}.`)
      return
    }

    if (!window.confirm(`Update the stock for ${reviewed.length} reviewed product${reviewed.length === 1 ? '' : 's'}?`)) return

    setSaving(true)
    setMessage('')
    try {
      const batch = writeBatch(db)
      reviewed.forEach(item => {
        batch.update(doc(db, 'products', item.id), {
          stockCount: Number(counts[item.id]),
          stocktakeUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      })
      await batch.commit()
      setCounts({})
      setShowDifferencesOnly(false)
      setMessage(`Stock updated for ${reviewed.length} product${reviewed.length === 1 ? '' : 's'}.`)
    } catch (error) {
      console.error('[stocktake] Failed to update stock', error)
      setMessage('We could not update the stock. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="page stocktake-page">
      <header className="stocktake-page__header">
        <div>
          <Link to="/products" className="stocktake-page__back">← Back to items</Link>
          <h2 className="page__title">Stocktake</h2>
          <p className="page__subtitle">Count what is physically in the shop, then update only the products you reviewed.</p>
        </div>
        <button type="button" className="button button--primary" onClick={saveReviewedCounts} disabled={saving || reviewedCount === 0}>
          {saving ? 'Saving…' : `Save reviewed (${reviewedCount})`}
        </button>
      </header>

      <section className="stocktake-page__summary" aria-label="Stocktake progress">
        <div><strong>{items.length}</strong><span>Products</span></div>
        <div><strong>{reviewedCount}</strong><span>Reviewed</span></div>
        <div><strong>{differenceCount}</strong><span>Differences</span></div>
      </section>

      {message ? <p className="stocktake-page__message">{message}</p> : null}

      <section className="card stocktake-page__card">
        <div className="stocktake-page__tools">
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search product or SKU"
            aria-label="Search inventory"
          />
          <label className="stocktake-page__difference-toggle">
            <input type="checkbox" checked={showDifferencesOnly} onChange={event => setShowDifferencesOnly(event.target.checked)} />
            <span>Show differences only</span>
          </label>
        </div>

        {storeLoading || loading ? <p className="stocktake-page__empty">Loading inventory…</p> : null}
        {!loading && !storeId ? <p className="stocktake-page__empty">Select a store to start a stocktake.</p> : null}
        {!loading && storeId && items.length === 0 ? <p className="stocktake-page__empty">No physical products found.</p> : null}

        {!loading && visibleItems.length > 0 ? (
          <div className="stocktake-page__table-wrap">
            <table className="stocktake-page__table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>System</th>
                  <th>Counted</th>
                  <th>Difference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(item => {
                  const input = counts[item.id] ?? ''
                  const counted = input.trim() === '' ? null : Number(input)
                  const validCount = counted !== null && Number.isFinite(counted) && counted >= 0
                  const difference = validCount ? counted - item.stockCount : null
                  const matches = difference === 0
                  return (
                    <tr key={item.id} className={difference !== null && !matches ? 'has-difference' : ''}>
                      <td>
                        <strong>{item.name}</strong>
                        {item.sku ? <span>{item.sku}</span> : null}
                      </td>
                      <td>{item.stockCount}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={input}
                          onChange={event => setCounts(current => ({ ...current, [item.id]: event.target.value }))}
                          aria-label={`Counted stock for ${item.name}`}
                        />
                      </td>
                      <td>{difference === null ? '—' : difference > 0 ? `+${difference}` : difference}</td>
                      <td>
                        {difference === null ? <span className="stocktake-status">Not checked</span> : matches ? <span className="stocktake-status stocktake-status--ok">OK</span> : <span className="stocktake-status stocktake-status--check">Check</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  )
}
