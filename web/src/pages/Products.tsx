import React, { useEffect, useMemo, useState, FormEvent } from 'react'
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './Products.css'

type ItemType = 'product' | 'service'

type Product = {
  id: string
  storeId: string
  name: string
  price: number | null
  sku?: string | null
  itemType?: ItemType // <<< NEW – defaults to "product" when missing
  stockCount?: number | null
  reorderPoint?: number | null
  createdAt?: unknown
  updatedAt?: unknown
}

function sanitizeNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export default function Products() {
  const { storeId: activeStoreId } = useActiveStore()

  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [onlyLowStock, setOnlyLowStock] = useState(false)

  // add-item form
  const [name, setName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('product')
  const [sku, setSku] = useState('')
  const [price, setPrice] = useState('')
  const [reorderPoint, setReorderPoint] = useState('')
  const [openingStock, setOpeningStock] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // --------------------------------------------------------------
  // Load products for active store
  // --------------------------------------------------------------
  useEffect(() => {
    if (!activeStoreId) {
      setProducts([])
      return
    }

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('name', 'asc'),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: Product[] = snap.docs.map(d => {
        const data = d.data() as any
        const itemType: ItemType = (data.itemType === 'service' ? 'service' : 'product')
        return {
          id: d.id,
          storeId: data.storeId,
          name: data.name ?? '',
          price: typeof data.price === 'number' ? data.price : null,
          sku: data.sku ?? null,
          itemType,
          stockCount:
            typeof data.stockCount === 'number'
              ? data.stockCount
              : null,
          reorderPoint:
            typeof data.reorderPoint === 'number'
              ? data.reorderPoint
              : null,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        }
      })
      setProducts(rows)
    })

    return unsubscribe
  }, [activeStoreId])

  // --------------------------------------------------------------
  // Derived values
  // --------------------------------------------------------------
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    let list = products

    if (term) {
      list = list.filter(p => {
        const sku = (p.sku ?? '').toLowerCase()
        return (
          p.name.toLowerCase().includes(term) ||
          sku.includes(term)
        )
      })
    }

    if (onlyLowStock) {
      list = list.filter(p => {
        const type = p.itemType ?? 'product'
        if (type === 'service') return false
        if (p.stockCount == null || p.reorderPoint == null) return false
        return p.stockCount <= p.reorderPoint
      })
    }

    return list
  }, [products, search, onlyLowStock])

  const lowStockCount = useMemo(
    () =>
      products.filter(p => {
        const type = p.itemType ?? 'product'
        if (type === 'service') return false
        if (p.stockCount == null || p.reorderPoint == null) return false
        return p.stockCount <= p.reorderPoint
      }).length,
    [products],
  )

  // --------------------------------------------------------------
  // Add item
  // --------------------------------------------------------------
  async function handleAddItem(event: FormEvent) {
    event.preventDefault()
    if (!activeStoreId) {
      setFormError('Select a workspace before adding items.')
      return
    }

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormError('Enter a name for this item.')
      return
    }

    const numericPrice = sanitizeNumber(price)
    if (numericPrice == null) {
      setFormError('Enter a valid price (0 or higher).')
      return
    }

    const numericReorder = sanitizeNumber(reorderPoint)
    const numericOpening = sanitizeNumber(openingStock)

    const isService = itemType === 'service'

    const payload: Omit<Product, 'id'> & {
      storeId: string
    } = {
      storeId: activeStoreId,
      name: trimmedName,
      price: numericPrice,
      sku: sku.trim() || null,
      itemType,
      stockCount: isService ? null : numericOpening ?? 0,
      reorderPoint: isService ? null : numericReorder ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }

    setIsSaving(true)
    setFormError(null)
    try {
      await addDoc(collection(db, 'products'), payload as any)

      // clear form (keep type – you usually add same type in a row)
      setName('')
      setSku('')
      setPrice('')
      if (itemType === 'product') {
        setReorderPoint('')
        setOpeningStock('')
      }
    } catch (err) {
      console.error('[products] Failed to add item', err)
      const msg =
        err instanceof Error
          ? err.message
          : 'We could not save this item. Please try again.'
      setFormError(msg)
    } finally {
      setIsSaving(false)
    }
  }

  const totalServices = products.filter(
    p => (p.itemType ?? 'product') === 'service',
  ).length
  const totalProducts = products.filter(
    p => (p.itemType ?? 'product') === 'product',
  ).length

  // --------------------------------------------------------------
  // Render
  // --------------------------------------------------------------
  return (
    <div className="page products-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Products &amp; services</h2>
          <p className="page__subtitle">
            Review inventory, monitor low stock alerts, and keep your catalogue
            of items and services tidy.
          </p>
        </div>
        <div className="products-page__summary">
          <span className="products-page__summary-pill">
            {totalProducts} products
          </span>
          <span className="products-page__summary-pill">
            {totalServices} services
          </span>
          <span className="products-page__summary-pill products-page__summary-pill--alert">
            {lowStockCount} low stock
          </span>
        </div>
      </header>

      <div className="products-page__layout">
        {/* ---------- Left: add item ---------- */}
        <section className="card products-page__card products-page__card--form">
          <h3 className="card__title">Add item</h3>
          <p className="card__subtitle">
            Capture both physical products and services so sales stay accurate.
          </p>

          <form onSubmit={handleAddItem} className="products-page__form">
            <div className="field">
              <label className="field__label" htmlFor="product-name">
                Name
              </label>
              <input
                id="product-name"
                placeholder="e.g. House Blend Coffee or Acrylic Nails"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="product-type">
                Item type
              </label>
              <select
                id="product-type"
                value={itemType}
                onChange={e => setItemType(e.target.value as ItemType)}
              >
                <option value="product">Physical product</option>
                <option value="service">Service (no stock tracking)</option>
              </select>
              <p className="field__hint">
                Choose <strong>Service</strong> for things like haircuts, makeup,
                repair work, etc. We won’t track stock for services.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="product-sku">
                SKU
              </label>
              <input
                id="product-sku"
                placeholder="Barcode or internal code"
                value={sku}
                onChange={e => setSku(e.target.value)}
              />
              <p className="field__hint">
                If you scan barcodes, this should match the code. For services,
                you can enter any reference code you like.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="product-price">
                Price
              </label>
              <input
                id="product-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="How much you sell it for"
                value={price}
                onChange={e => setPrice(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="product-reorder">
                Reorder point
              </label>
              <input
                id="product-reorder"
                type="number"
                min="0"
                step="1"
                placeholder="Alert when stock drops to…"
                value={reorderPoint}
                disabled={itemType === 'service'}
                onChange={e => setReorderPoint(e.target.value)}
              />
              <p className="field__hint">
                We only use this for physical products. Services ignore this
                field.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="product-opening-stock">
                Opening stock
              </label>
              <input
                id="product-opening-stock"
                type="number"
                min="0"
                step="1"
                placeholder="Quantity currently on hand"
                value={openingStock}
                disabled={itemType === 'service'}
                onChange={e => setOpeningStock(e.target.value)}
              />
            </div>

            {formError && (
              <p className="products-page__form-error">{formError}</p>
            )}

            <button
              type="submit"
              className="button button--primary button--block"
              disabled={isSaving}
            >
              {isSaving ? 'Adding…' : 'Add item'}
            </button>
          </form>
        </section>

        {/* ---------- Right: list ---------- */}
        <section className="card products-page__card products-page__card--list">
          <div className="products-page__list-header">
            <div className="field field--inline">
              <label
                className="field__label"
                htmlFor="products-search"
              >
                Search
              </label>
              <input
                id="products-search"
                placeholder="Search by name or SKU"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <label className="products-page__low-stock-toggle">
              <input
                type="checkbox"
                checked={onlyLowStock}
                onChange={e => setOnlyLowStock(e.target.checked)}
              />
              <span>Show low stock only</span>
            </label>
          </div>

          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>SKU</th>
                  <th className="products-page__numeric">Price</th>
                  <th className="products-page__numeric">On hand</th>
                  <th className="products-page__numeric">Reorder point</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length ? (
                  filteredProducts.map(p => {
                    const type = p.itemType ?? 'product'
                    const isService = type === 'service'
                    const onHand = isService ? '—' : p.stockCount ?? 0
                    const reorder = isService ? '—' : p.reorderPoint ?? '—'

                    return (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{isService ? 'Service' : 'Product'}</td>
                        <td>{p.sku || '—'}</td>
                        <td className="products-page__numeric">
                          {typeof p.price === 'number'
                            ? `GHS ${p.price.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="products-page__numeric">{onHand}</td>
                        <td className="products-page__numeric">{reorder}</td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">
                        <h3 className="empty-state__title">
                          No items found
                        </h3>
                        <p>
                          Try a different search term or add a new product or
                          service on the left.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
