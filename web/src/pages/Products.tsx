import React, { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { Link } from 'react-router-dom'
import './Products.css'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import {
  PRODUCT_CACHE_LIMIT,
  loadCachedProducts,
  saveCachedProducts,
} from '../utils/offlineCache'

type ItemType = 'product' | 'service'

type Product = {
  id: string
  name: string
  sku: string | null
  price: number | null
  stockCount: number | null
  reorderPoint: number | null
  itemType: ItemType
  taxRate?: number | null          // 🔹 VAT stored as decimal (e.g. 0.15)
  lastReceiptAt?: unknown
}

type CachedProduct = Omit<Product, 'id'>

/**
 * Helpers
 */
function sanitizeNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

function sanitizeTaxRate(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

// Users type VAT as "15" -> save 0.15
function parseTaxInput(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const raw = Number(trimmed)
  if (!Number.isFinite(raw) || raw < 0) return null
  // if > 1, treat as percent, else decimal
  const rate = raw > 1 ? raw / 100 : raw
  return rate
}

function formatVat(taxRate?: number | null): string {
  if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate <= 0) {
    return '—'
  }
  return `${(taxRate * 100).toFixed(0)}%`
}

// 2 -> 1.99, 5 -> 4.99, 20 -> 19.99, but 2.5 stays 2.50
function normalizePsychPrice(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return raw
  const roundedTo2 = Number(raw.toFixed(2))
  const isWhole = Math.abs(roundedTo2 - Math.round(roundedTo2)) < 1e-6

  if (isWhole && roundedTo2 >= 1) {
    const adjusted = roundedTo2 - 0.01
    return Number(adjusted.toFixed(2))
  }
  return roundedTo2
}

function mapFirestoreProduct(id: string, data: Record<string, unknown>): Product {
  const nameRaw = typeof data.name === 'string' ? data.name : ''
  const skuRaw = typeof data.sku === 'string' ? data.sku : ''
  const itemType = data.itemType === 'service' ? 'service' : 'product'

  return {
    id,
    name: nameRaw.trim() || 'Untitled item',
    sku: skuRaw.trim() || null,
    price: sanitizeNumber(data.price) ?? null,
    stockCount: sanitizeNumber(data.stockCount),
    reorderPoint: sanitizeNumber(data.reorderPoint),
    itemType,
    taxRate: sanitizeTaxRate(data.taxRate),
    lastReceiptAt: data.lastReceiptAt,
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
  return `GHS ${amount.toFixed(2)}`
}

function formatLastReceipt(lastReceiptAt: unknown): string {
  if (!lastReceiptAt) return 'No receipts recorded'
  try {
    // Firestore Timestamp
    if (typeof (lastReceiptAt as any).toDate === 'function') {
      const d: Date = (lastReceiptAt as any).toDate()
      return d.toLocaleDateString()
    }
    if (lastReceiptAt instanceof Date) {
      return lastReceiptAt.toLocaleDateString()
    }
  } catch {
    // ignore
  }
  return 'No receipts recorded'
}

export default function Products() {
  const { storeId: activeStoreId } = useActiveStore()

  const [products, setProducts] = useState<Product[]>([])
  const [searchText, setSearchText] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)

  // add-item form state
  const [name, setName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('product')
  const [sku, setSku] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [taxRateInput, setTaxRateInput] = useState('') // 🔹 VAT (percent) for new item
  const [reorderPointInput, setReorderPointInput] = useState('')
  const [openingStockInput, setOpeningStockInput] = useState('')

  const [isSaving, setIsSaving] = useState(false)
  const [formStatus, setFormStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [formError, setFormError] = useState<string | null>(null)

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editPriceInput, setEditPriceInput] = useState('')
  const [editTaxRateInput, setEditTaxRateInput] = useState('') // 🔹 VAT (percent) for edit
  const [editReorderPointInput, setEditReorderPointInput] = useState('')

  /**
   * Load products for the active store
   */
  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setProducts([])
      return () => {
        cancelled = true
      }
    }

    // 1. Try cached products first
    loadCachedProducts<CachedProduct>({ storeId: activeStoreId })
      .then(cached => {
        if (cancelled || !cached.length) return
        const mapped = cached.map((item, index) =>
          mapFirestoreProduct(
            // cached objects don't have ids, so we fake a stable-ish one
            (item as any).id ?? `cached-${index}`,
            item as any,
          ),
        )
        setProducts(
          mapped.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
          ),
        )
      })
      .catch(error => {
        console.warn('[products] Failed to load cached products', error)
      })

    // 2. Live Firestore subscription
    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snapshot => {
      const rows: Product[] = snapshot.docs.map(d =>
        mapFirestoreProduct(d.id, d.data() as Record<string, unknown>),
      )

      // save for offline
      saveCachedProducts(
        rows.map(r => ({
          ...r,
          id: undefined as any, // cache doesn't need the id
        })),
        { storeId: activeStoreId },
      ).catch(error => {
        console.warn('[products] Failed to cache products', error)
      })

      const sorted = [...rows].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
      setProducts(sorted)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  /**
   * Filtering logic
   */
  const visibleProducts = useMemo(() => {
    let result = products

    if (showLowStockOnly) {
      result = result.filter(p => {
        if (p.itemType === 'service') return false
        if (typeof p.stockCount !== 'number') return false
        if (typeof p.reorderPoint !== 'number') return false
        return p.stockCount <= p.reorderPoint
      })
    }

    if (searchText.trim()) {
      const term = searchText.trim().toLowerCase()
      result = result.filter(p => {
        const inName = p.name.toLowerCase().includes(term)
        const inSku = (p.sku ?? '').toLowerCase().includes(term)
        return inName || inSku
      })
    }

    return result
  }, [products, searchText, showLowStockOnly])

  const lowStockCount = useMemo(
    () =>
      products.filter(p => {
        if (p.itemType === 'service') return false
        if (typeof p.stockCount !== 'number') return false
        if (typeof p.reorderPoint !== 'number') return false
        return p.stockCount <= p.reorderPoint
      }).length,
    [products],
  )

  /**
   * Add item handler
   */
  async function handleAddItem(event: React.FormEvent) {
    event.preventDefault()
    if (!activeStoreId) return

    setFormStatus('idle')
    setFormError(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setFormStatus('error')
      setFormError('Please enter a name for this item.')
      return
    }

    const isService = itemType === 'service'

    const priceNumber = priceInput ? Number(priceInput) : NaN
    const reorderPointNumber = reorderPointInput ? Number(reorderPointInput) : NaN
    const openingStockNumber = openingStockInput ? Number(openingStockInput) : NaN
    const taxRateNumber = parseTaxInput(taxRateInput)

    if (!isService && (Number.isNaN(priceNumber) || priceNumber < 0)) {
      setFormStatus('error')
      setFormError('Enter a valid selling price.')
      return
    }

    if (
      !isService &&
      openingStockInput &&
      (Number.isNaN(openingStockNumber) || openingStockNumber < 0)
    ) {
      setFormStatus('error')
      setFormError('Opening stock must be zero or more.')
      return
    }

    // 🔹 Apply psychological pricing (2 -> 1.99) for valid prices
    let finalPrice: number | null = null
    if (!Number.isNaN(priceNumber) && priceNumber >= 0) {
      finalPrice = normalizePsychPrice(priceNumber)
    }

    setIsSaving(true)
    try {
      await addDoc(collection(db, 'products'), {
        storeId: activeStoreId,
        name: trimmedName,
        itemType,
        price: !isService && finalPrice !== null ? finalPrice : finalPrice,
        sku: isService ? null : sku.trim() || null,
        taxRate: taxRateNumber, // 🔹 save VAT as decimal (or null)
        reorderPoint:
          !isService && !Number.isNaN(reorderPointNumber) && reorderPointNumber >= 0
            ? reorderPointNumber
            : null,
        stockCount:
          !isService && !Number.isNaN(openingStockNumber) && openingStockNumber >= 0
            ? openingStockNumber
            : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      setFormStatus('success')
      setFormError(null)

      // reset form
      setName('')
      setItemType('product')
      setSku('')
      setPriceInput('')
      setTaxRateInput('')
      setReorderPointInput('')
      setOpeningStockInput('')
    } catch (error) {
      console.error('[products] Failed to add item', error)
      setFormStatus('error')
      setFormError(
        error instanceof Error
          ? error.message
          : 'We could not save this item. Please try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleItemTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as ItemType
    setItemType(value)
    if (value === 'service') {
      // services should not have barcodes
      setSku('')
    }
  }

  const isService = itemType === 'service'

  /**
   * Edit helpers
   */
  function startEditing(product: Product) {
    setEditingId(product.id)
    setEditName(product.name)
    setEditSku(product.sku ?? '')
    setEditPriceInput(
      typeof product.price === 'number' && Number.isFinite(product.price)
        ? String(product.price)
        : '',
    )
    setEditTaxRateInput(
      typeof product.taxRate === 'number' && Number.isFinite(product.taxRate)
        ? String((product.taxRate * 100).toFixed(0)) // show as percent (e.g. 15)
        : '',
    )
    setEditReorderPointInput(
      typeof product.reorderPoint === 'number' && Number.isFinite(product.reorderPoint)
        ? String(product.reorderPoint)
        : '',
    )
    setFormStatus('idle')
    setFormError(null)
  }

  function cancelEditing() {
    setEditingId(null)
  }

  async function handleSaveEdit(product: Product) {
    if (!editingId || editingId !== product.id) return

    const trimmedName = editName.trim()
    if (!trimmedName) {
      setFormStatus('error')
      setFormError('Please enter a name for this item.')
      return
    }

    const isSvc = product.itemType === 'service'
    const priceNumber = editPriceInput ? Number(editPriceInput) : NaN
    const reorderPointNumber = editReorderPointInput
      ? Number(editReorderPointInput)
      : NaN
    const taxRateNumber = parseTaxInput(editTaxRateInput)

    if (!isSvc && (Number.isNaN(priceNumber) || priceNumber < 0)) {
      setFormStatus('error')
      setFormError('Enter a valid selling price.')
      return
    }

    // 🔹 Apply psychological pricing also when editing
    let finalPrice: number | null = null
    if (!Number.isNaN(priceNumber) && priceNumber >= 0) {
      finalPrice = normalizePsychPrice(priceNumber)
    }

    setFormStatus('idle')
    setFormError(null)

    try {
      const ref = doc(db, 'products', product.id)
      await updateDoc(ref, {
        name: trimmedName,
        sku: isSvc ? null : editSku.trim() || null,
        price: finalPrice,
        taxRate: taxRateNumber,
        reorderPoint:
          !isSvc &&
          !Number.isNaN(reorderPointNumber) &&
          reorderPointNumber >= 0
            ? reorderPointNumber
            : null,
        updatedAt: serverTimestamp(),
      })

      setEditingId(null)
      setFormStatus('success')
      setFormError('Item updated successfully.')
    } catch (error) {
      console.error('[products] Failed to update item', error)
      setFormStatus('error')
      setFormError(
        error instanceof Error
          ? error.message
          : 'We could not update this item. Please try again.',
      )
    }
  }

  async function handleDelete(product: Product) {
    const confirmed = window.confirm(
      `Delete "${product.name}"? This cannot be undone.`,
    )
    if (!confirmed) return

    try {
      const ref = doc(db, 'products', product.id)
      await deleteDoc(ref)
      if (editingId === product.id) {
        setEditingId(null)
      }
    } catch (error) {
      console.error('[products] Failed to delete item', error)
      setFormStatus('error')
      setFormError(
        error instanceof Error
          ? error.message
          : 'We could not delete this item. Please try again.',
      )
    }
  }

  return (
    <div className="page products-page">
      <header className="page__header products-page__header">
        <div>
          <h2 className="page__title">Products &amp; services</h2>
          <p className="page__subtitle">
            Review inventory, monitor low stock alerts, and keep your catalogue of items and
            services tidy.
          </p>
        </div>
        <div className="products-page__header-actions">
          <Link to="/receive" className="button button--primary">
            Receive stock
          </Link>
        </div>
      </header>

      <div className="products-page__grid">
        {/* Add item card */}
        <section className="card products-page__add-card">
          <h3 className="card__title">Add item</h3>
          <p className="card__subtitle">
            Capture both physical products and services you offer so sales and records stay
            accurate.
          </p>

          {formStatus === 'success' && formError === null && (
            <p className="products__message products__message--success">
              Item added. You can now sell it from the Sell page.
            </p>
          )}

          {formStatus === 'success' && formError === 'Item updated successfully.' && (
            <p className="products__message products__message--success">
              {formError}
            </p>
          )}

          {formStatus === 'error' && formError && (
            <p className="products__message products__message--error">{formError}</p>
          )}

          <form className="form" onSubmit={handleAddItem}>
            <div className="field">
              <label className="field__label" htmlFor="add-name">
                Name
              </label>
              <input
                id="add-name"
                placeholder="e.g. House Blend Coffee or Acrylic Nails"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-type">
                Item type
              </label>
              <select
                id="add-type"
                value={itemType}
                onChange={handleItemTypeChange}
              >
                <option value="product">Physical product</option>
                <option value="service">Service</option>
              </select>
              {isService && (
                <p className="field__hint">
                  Services don&apos;t track stock. You can still set a selling price.
                </p>
              )}
            </div>

            {!isService && (
              <div className="field">
                <label className="field__label" htmlFor="add-sku">
                  SKU
                </label>
                <input
                  id="add-sku"
                  placeholder="Barcode or internal code"
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                />
                <p className="field__hint">
                  If you scan barcodes, this should match the code. For services, you can
                  enter any reference code you like.
                </p>
              </div>
            )}

            <div className="field">
              <label className="field__label" htmlFor="add-price">
                Price
              </label>
              <input
                id="add-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="How much you sell it for"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
              />
              <p className="field__hint">
                Whole numbers will be saved like 2 → 1.99, 5 → 4.99 automatically.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-tax">
                VAT (percent)
              </label>
              <input
                id="add-tax"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 15 for 15% VAT, or leave blank"
                value={taxRateInput}
                onChange={e => setTaxRateInput(e.target.value)}
              />
              <p className="field__hint">
                This VAT rate will be used on the Sell page for tax totals.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-reorder">
                Reorder point
              </label>
              <input
                id="add-reorder"
                type="number"
                min="0"
                step="1"
                placeholder="Alert when stock drops to..."
                value={reorderPointInput}
                onChange={e => setReorderPointInput(e.target.value)}
                disabled={isService}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-opening-stock">
                Opening stock
              </label>
              <input
                id="add-opening-stock"
                type="number"
                min="0"
                step="1"
                placeholder="Quantity currently on hand"
                value={openingStockInput}
                onChange={e => setOpeningStockInput(e.target.value)}
                disabled={isService}
              />
            </div>

            <button
              type="submit"
              className="button button--primary"
              disabled={isSaving}
            >
              {isSaving ? 'Adding…' : 'Add item'}
            </button>
          </form>
        </section>

        {/* List card */}
        <section className="card products-page__list-card">
          <div className="products-page__list-header">
            <div className="field field--inline">
              <label className="field__label" htmlFor="products-search">
                Search
              </label>
              <input
                id="products-search"
                placeholder="Search by name or SKU"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
            </div>

            <div className="products-page__list-controls">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={showLowStockOnly}
                  onChange={e => setShowLowStockOnly(e.target.checked)}
                />
                <span>Show low stock only ({lowStockCount})</span>
              </label>
              <button type="button" className="button button--ghost">
                Download reorder list
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Type</th>
                  <th scope="col">SKU</th>
                  <th scope="col">VAT</th>    {/* 🔹 new column */}
                  <th scope="col">Price</th>
                  <th scope="col">On hand</th>
                  <th scope="col">Reorder point</th>
                  <th scope="col">Last receipt</th>
                  <th scope="col" className="products-page__actions-column">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.length ? (
                  visibleProducts.map(product => {
                    const isSvc = product.itemType === 'service'
                    const isEditing = editingId === product.id

                    return (
                      <tr key={product.id}>
                        <td>
                          {isEditing ? (
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                            />
                          ) : (
                            product.name
                          )}
                        </td>
                        <td>{isSvc ? 'Service' : 'Product'}</td>
                        <td>
                          {isEditing && !isSvc ? (
                            <input
                              value={editSku}
                              onChange={e => setEditSku(e.target.value)}
                            />
                          ) : product.sku || '—'}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editTaxRateInput}
                              onChange={e => setEditTaxRateInput(e.target.value)}
                              placeholder="e.g. 15"
                            />
                          ) : (
                            formatVat(product.taxRate)
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editPriceInput}
                              onChange={e => setEditPriceInput(e.target.value)}
                            />
                          ) : (
                            formatCurrency(product.price)
                          )}
                        </td>
                        <td>{isSvc ? '—' : product.stockCount ?? 0}</td>
                        <td>
                          {isEditing && !isSvc ? (
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editReorderPointInput}
                              onChange={e =>
                                setEditReorderPointInput(e.target.value)
                              }
                            />
                          ) : isSvc ? (
                            '—'
                          ) : (
                            product.reorderPoint ?? '—'
                          )}
                        </td>
                        <td>{formatLastReceipt(product.lastReceiptAt)}</td>
                        <td className="products-page__actions-column">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                className="button button--primary button--small"
                                onClick={() => handleSaveEdit(product)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="button button--ghost button--small"
                                onClick={cancelEditing}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="button button--ghost button--small"
                                onClick={() => startEditing(product)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="button button--ghost button--small button--danger"
                                onClick={() => handleDelete(product)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <div className="empty-state">
                        <h3 className="empty-state__title">No items found</h3>
                        <p>
                          Try a different search term, or add new products and services
                          using the form on the left.
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
