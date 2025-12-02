import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'
import { normalizeBarcode } from '../utils/barcode'
import './Sell.css'

type ItemType = 'product' | 'service'

type Product = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  price: number | null
  taxRate?: number | null
  itemType: ItemType
}

type CartLine = {
  productId: string
  name: string
  qty: number
  price: number
  taxRate: number
}

type PaymentMethod = 'cash' | 'card' | 'mobile_money' | 'transfer'

type ScanStatus = {
  type: 'success' | 'error'
  message: string
}

function mapFirestoreProduct(id: string, data: any): Product {
  const nameRaw = typeof data.name === 'string' ? data.name : ''
  const skuRaw = typeof data.sku === 'string' ? data.sku : ''

  const barcodeSource =
    typeof data.barcode === 'string'
      ? data.barcode
      : typeof data.sku === 'string'
        ? data.sku
        : ''

  return {
    id,
    name: nameRaw.trim() || 'Untitled item',
    sku: skuRaw.trim() || null,
    barcode: normalizeBarcode(barcodeSource) || null,
    price:
      typeof data.price === 'number' && Number.isFinite(data.price)
        ? data.price
        : null,
    taxRate:
      typeof data.taxRate === 'number' && Number.isFinite(data.taxRate)
        ? data.taxRate
        : null,
    itemType: data.itemType === 'service' ? 'service' : 'product',
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'GHS 0.00'
  return `GHS ${amount.toFixed(2)}`
}

export default function Sell() {
  const { storeId: activeStoreId } = useActiveStore()
  const user = useAuthUser()

  const [products, setProducts] = useState<Product[]>([])
  const [searchText, setSearchText] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [amountPaidInput, setAmountPaidInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // 🔹 Scan-specific state
  const [scanInput, setScanInput] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)

  // Load products for this store
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

    const unsub = onSnapshot(q, snap => {
      const rows: Product[] = snap.docs.map(d =>
        mapFirestoreProduct(d.id, d.data()),
      )
      setProducts(rows)
    })

    return () => unsub()
  }, [activeStoreId])

  // Filtered list for manual search
  const filteredProducts = useMemo(() => {
    if (!searchText.trim()) return products
    const term = searchText.trim().toLowerCase()
    return products.filter(p => {
      const inName = p.name.toLowerCase().includes(term)
      const inSku = (p.sku ?? '').toLowerCase().includes(term)
      const inBarcode = (p.barcode ?? '').toLowerCase().includes(term)
      return inName || inSku || inBarcode
    })
  }, [products, searchText])

  // Totals
  const { subTotal, taxTotal, grandTotal } = useMemo(() => {
    let sub = 0
    let tax = 0
    for (const line of cart) {
      const lineSub = line.price * line.qty
      const rate = Number(line.taxRate || 0)
      const lineTax = rate > 0 ? lineSub * rate : 0
      sub += lineSub
      tax += lineTax
    }
    return { subTotal: sub, taxTotal: tax, grandTotal: sub + tax }
  }, [cart])

  const amountPaid = useMemo(() => {
    const raw = Number(amountPaidInput)
    if (!Number.isFinite(raw) || raw < 0) return 0
    return raw
  }, [amountPaidInput])

  const changeDue = useMemo(() => {
    const diff = amountPaid - grandTotal
    if (!Number.isFinite(diff)) return 0
    return diff > 0 ? diff : 0
  }, [amountPaid, grandTotal])

  function addProductToCart(product: Product, qty: number = 1) {
    if (!product.price || product.price < 0) {
      setScanStatus({
        type: 'error',
        message: `This item has no price. Set a price on the Products page first.`,
      })
      return
    }

    setCart(prev => {
      const existingIndex = prev.findIndex(
        line => line.productId === product.id,
      )
      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = {
          ...next[existingIndex],
          qty: next[existingIndex].qty + qty,
        }
        return next
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          qty,
          price: product.price,
          taxRate: product.taxRate || 0,
        },
      ]
    })
  }

  function updateCartQty(productId: string, qty: number) {
    setCart(prev =>
      prev
        .map(line =>
          line.productId === productId ? { ...line, qty } : line,
        )
        .filter(line => line.qty > 0),
    )
  }

  function removeCartLine(productId: string) {
    setCart(prev => prev.filter(line => line.productId !== productId))
  }

  // 🔹 Scan handler (works with camera scanners that paste digits into input)
  function handleScanSubmit(event: React.FormEvent) {
    event.preventDefault()
    setScanStatus(null)

    const normalized = normalizeBarcode(scanInput)
    if (!normalized) {
      setScanStatus({
        type: 'error',
        message: 'No barcode detected. Try scanning again.',
      })
      return
    }

    const found = products.find(p => {
      const productBarcode = p.barcode || normalizeBarcode(p.sku ?? '')
      return productBarcode === normalized
    })

    if (!found) {
      setScanStatus({
        type: 'error',
        message: `No product found for code ${normalized}. Check the SKU/barcode on the Products page.`,
      })
      setScanInput('')
      return
    }

    addProductToCart(found, 1)
    setScanStatus({
      type: 'success',
      message: `Added "${found.name}" to the cart.`,
    })
    setScanInput('')
  }

  async function handleCommitSale() {
    setErrorMessage(null)
    setSuccessMessage(null)
    setScanStatus(null)

    if (!activeStoreId) {
      setErrorMessage('Select a workspace before recording a sale.')
      return
    }
    if (!cart.length) {
      setErrorMessage('Add at least one item to the cart.')
      return
    }

    setIsSaving(true)
    try {
      const items = cart.map(line => ({
        productId: line.productId,
        name: line.name,
        qty: line.qty,
        price: line.price,
        taxRate: line.taxRate,
      }))

      const totals = {
        total: grandTotal,
        taxTotal,
      }

      const payment = {
        method: paymentMethod,
        tenders: [
          {
            method: paymentMethod,
            amount: grandTotal,
          },
        ],
      }

      const commitSaleFn = httpsCallable(functions, 'commitSale')
      await commitSaleFn({
        branchId: activeStoreId,
        items,
        totals,
        cashierId: user?.uid ?? null,
        saleId: `sale_${activeStoreId}_${Date.now()}`,
        payment,
        customer: null,
      })

      setCart([])
      setAmountPaidInput('')
      setSuccessMessage('Sale recorded successfully.')
    } catch (error: any) {
      console.error('[sell] Failed to commit sale', error)
      setErrorMessage(
        typeof error?.message === 'string'
          ? error.message
          : 'We could not save this sale. Please try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="page sell-page">
      <header className="page__header sell-page__header">
        <div>
          <h2 className="page__title">Sell</h2>
          <p className="page__subtitle">
            Scan barcodes or search for products, build a cart, and record the sale.
          </p>
        </div>
      </header>

      <div className="sell-page__grid">
        {/* LEFT: Scanner + product search */}
        <section className="card sell-page__left">
          <div className="sell-page__section-header">
            <h3>Scan barcode</h3>
            <p>
              Use your phone camera or barcode scanner. We match the code to the product
              SKU/barcode you saved.
            </p>
          </div>

          <form
            className="sell-page__scan-form"
            onSubmit={handleScanSubmit}
          >
            <label className="field">
              <span className="field__label">Barcode / SKU</span>
              <input
                type="text"
                inputMode="numeric"
                autoCorrect="off"
                autoCapitalize="off"
                placeholder="Tap here, then scan the product barcode"
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
              />
            </label>
            <button type="submit" className="button button--primary">
              Add from barcode
            </button>
          </form>

          {scanStatus && (
            <p
              className={
                scanStatus.type === 'success'
                  ? 'sell-page__scan-status sell-page__scan-status--success'
                  : 'sell-page__scan-status sell-page__scan-status--error'
              }
            >
              {scanStatus.message}
            </p>
          )}

          <hr className="sell-page__divider" />

          <div className="sell-page__section-header">
            <h3>Find product</h3>
            <p>Search by name, SKU, or barcode to add items manually.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="sell-search">
              Search products
            </label>
            <input
              id="sell-search"
              placeholder="Type to search..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>

          <div className="sell-page__product-list">
            {filteredProducts.length ? (
              filteredProducts.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="sell-page__product-row"
                  onClick={() => addProductToCart(p, 1)}
                >
                  <div className="sell-page__product-main">
                    <div className="sell-page__product-name">{p.name}</div>
                    <div className="sell-page__product-meta">
                      {p.sku && <span>SKU: {p.sku}</span>}
                      {p.barcode && <span>Code: {p.barcode}</span>}
                    </div>
                  </div>
                  <div className="sell-page__product-price">
                    {formatCurrency(p.price)}
                  </div>
                </button>
              ))
            ) : (
              <p className="sell-page__empty-products">
                No products match this search.
              </p>
            )}
          </div>
        </section>

        {/* RIGHT: Cart + payment */}
        <section className="card sell-page__right">
          <div className="sell-page__section-header">
            <h3>Cart</h3>
            <p>Review items before recording the sale.</p>
          </div>

          <div className="sell-page__cart">
            {cart.length ? (
              <table className="sell-page__cart-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.map(line => {
                    const lineTotal = line.price * line.qty
                    return (
                      <tr key={line.productId}>
                        <td>{line.name}</td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={line.qty}
                            onChange={e =>
                              updateCartQty(
                                line.productId,
                                Math.max(1, Number(e.target.value) || 1),
                              )
                            }
                            className="sell-page__qty-input"
                          />
                        </td>
                        <td>{formatCurrency(line.price)}</td>
                        <td>{formatCurrency(lineTotal)}</td>
                        <td>
                          <button
                            type="button"
                            className="button button--ghost button--small button--danger"
                            onClick={() => removeCartLine(line.productId)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <p className="sell-page__empty-cart">
                Cart is empty. Scan or select a product to begin.
              </p>
            )}
          </div>

          <div className="sell-page__totals">
            <div className="sell-page__totals-row">
              <span>Subtotal</span>
              <strong>{formatCurrency(subTotal)}</strong>
            </div>
            <div className="sell-page__totals-row">
              <span>Tax</span>
              <strong>{formatCurrency(taxTotal)}</strong>
            </div>
            <div className="sell-page__totals-row sell-page__totals-row--grand">
              <span>Total</span>
              <strong>{formatCurrency(grandTotal)}</strong>
            </div>
          </div>

          <div className="sell-page__payment">
            <div className="field">
              <label className="field__label">Payment method</label>
              <select
                value={paymentMethod}
                onChange={e =>
                  setPaymentMethod(e.target.value as PaymentMethod)
                }
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile_money">Mobile money</option>
                <option value="transfer">Bank transfer</option>
              </select>
            </div>

            <div className="field">
              <label className="field__label">Amount paid (optional)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="If customer pays cash"
                value={amountPaidInput}
                onChange={e => setAmountPaidInput(e.target.value)}
              />
              {amountPaid > 0 && (
                <p className="sell-page__change">
                  Change due: <strong>{formatCurrency(changeDue)}</strong>
                </p>
              )}
            </div>
          </div>

          {errorMessage && (
            <p className="sell-page__message sell-page__message--error">
              {errorMessage}
            </p>
          )}
          {successMessage && (
            <p className="sell-page__message sell-page__message--success">
              {successMessage}
            </p>
          )}

          <div className="sell-page__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setCart([])
                setAmountPaidInput('')
                setScanStatus(null)
                setErrorMessage(null)
                setSuccessMessage(null)
              }}
              disabled={isSaving}
            >
              Clear cart
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={handleCommitSale}
              disabled={isSaving || !cart.length}
            >
              {isSaving ? 'Saving…' : 'Save sale'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
