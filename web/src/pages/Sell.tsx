import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser'

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

type CustomerMode = 'walk_in' | 'named'

type Receipt = {
  saleId: string
  createdAt: string
  items: CartLine[]
  subTotal: number
  taxTotal: number
  discountAmount: number
  grandTotal: number
  paymentMethod: PaymentMethod
  amountPaid: number
  changeDue: number
  customerDescription: string
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
  const [discountInput, setDiscountInput] = useState('') // e.g. "5" or "5%"
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // 🔹 Scan-specific state (text box)
  const [scanInput, setScanInput] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)

  // 🔹 Camera scanner state
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraScanning, setIsCameraScanning] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  // 🔹 Customer state
  const [customerMode, setCustomerMode] = useState<CustomerMode>('walk_in')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')

  // 🔹 Receipt state
  const [lastReceipt, setLastReceipt] = useState<Receipt | null>(null)
  const [isReceiptPrintReady, setIsReceiptPrintReady] = useState(false)

  // ---- Load products for this store ----
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

  // ---- Clean up camera on unmount ----
  useEffect(() => {
    return () => {
      void stopCameraScanner()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Filtered list for manual search ----
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

  // ---- Totals (including discount) ----
  const {
    subTotal,
    taxTotal,
    discountAmount,
    grandTotal,
  } = useMemo(() => {
    let sub = 0
    let tax = 0

    for (const line of cart) {
      const lineSub = line.price * line.qty
      const rate = Number(line.taxRate || 0)
      const lineTax = rate > 0 ? lineSub * rate : 0
      sub += lineSub
      tax += lineTax
    }

    const rawTotal = sub + tax

    let discount = 0
    const trimmed = discountInput.trim()
    if (trimmed) {
      if (trimmed.endsWith('%')) {
        const percent = Number(trimmed.slice(0, -1).trim())
        if (Number.isFinite(percent) && percent > 0) {
          discount = (rawTotal * percent) / 100
        }
      } else {
        const abs = Number(trimmed)
        if (Number.isFinite(abs) && abs > 0) {
          discount = abs
        }
      }
    }

    if (discount > rawTotal) discount = rawTotal
    const totalAfterDiscount = rawTotal - discount

    return {
      subTotal: sub,
      taxTotal: tax,
      discountAmount: discount,
      grandTotal: totalAfterDiscount,
    }
  }, [cart, discountInput])

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

  // ---- Cart helpers ----
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

  // ---- Shared helper: add product from barcode/SKU text ----
  function addProductFromCode(rawCode: string) {
    const normalized = normalizeBarcode(rawCode)
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
      return
    }

    addProductToCart(found, 1)
    setScanStatus({
      type: 'success',
      message: `Added "${found.name}" to the cart.`,
    })
  }

  // ---- Scan handler (works with USB/cable scanners that type into input) ----
  function handleScanSubmit(event: React.FormEvent) {
    event.preventDefault()
    setScanStatus(null)

    if (!scanInput.trim()) {
      setScanStatus({
        type: 'error',
        message: 'Type or scan a barcode first.',
      })
      return
    }

    addProductFromCode(scanInput)
    setScanInput('')
  }

  // ---- Camera scanner handlers (ZXing) ----
  async function startCameraScanner() {
    if (isCameraScanning) return
    if (!videoRef.current) {
      setCameraError('Camera preview not ready yet.')
      return
    }

    const reader = new BrowserMultiFormatReader()
    scannerRef.current = reader
    setCameraError(null)
    setIsCameraOpen(true)

    try {
      const controls = await reader.decodeFromVideoDevice(
        undefined, // use default camera
        videoRef.current,
        result => {
          if (result) {
            addProductFromCode(result.getText())
          }
        },
      )
      controlsRef.current = controls
      setIsCameraScanning(true)
    } catch (err: any) {
      console.error('[sell] Camera scan error', err)
      setCameraError(
        'Could not access camera. Check permissions and that no other app is using it.',
      )
      setIsCameraOpen(false)
      setIsCameraScanning(false)
    }
  }

  async function stopCameraScanner() {
    try {
      await controlsRef.current?.stop()
    } catch {
      // ignore
    }
    controlsRef.current = null
    scannerRef.current?.reset()
    scannerRef.current = null
    setIsCameraScanning(false)
    setIsCameraOpen(false)
  }

  // ---- Commit sale ----
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

    if (customerMode === 'named' && !customerName.trim()) {
      setErrorMessage('Enter a customer name or switch to Walk-in.')
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
        subTotal,
        taxTotal,
        discountTotal: discountAmount,
        totalBeforeDiscount: subTotal + taxTotal,
        total: grandTotal,
      }

      const payment = {
        method: paymentMethod,
        tenders: [
          {
            method: paymentMethod,
            amount: grandTotal,
          },
        ],
        amountPaid: amountPaid > 0 ? amountPaid : grandTotal,
        changeDue,
      }

      const customer =
        customerMode === 'walk_in'
          ? {
              type: 'walk_in',
              label: 'Walk-in customer',
            }
          : {
              type: 'named',
              name: customerName.trim(),
              phone: customerPhone.trim() || null,
            }

      const saleId = `sale_${activeStoreId}_${Date.now()}`
      const commitSaleFn = httpsCallable(functions, 'commitSale')
      await commitSaleFn({
        branchId: activeStoreId,
        items,
        totals,
        cashierId: user?.uid ?? null,
        saleId,
        payment,
        customer,
      })

      // Build receipt before clearing cart
      const receipt: Receipt = {
        saleId,
        createdAt: new Date().toISOString(),
        items: cart,
        subTotal,
        taxTotal,
        discountAmount,
        grandTotal,
        paymentMethod,
        amountPaid: payment.amountPaid,
        changeDue,
        customerDescription:
          customerMode === 'walk_in'
            ? 'Walk-in customer'
            : `${customerName.trim()}${customerPhone.trim() ? ` (${customerPhone.trim()})` : ''}`,
      }
      setLastReceipt(receipt)

      // Clear UI
      setCart([])
      setAmountPaidInput('')
      setDiscountInput('')
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

  function handleClearCart() {
    setCart([])
    setAmountPaidInput('')
    setDiscountInput('')
    setScanStatus(null)
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  function handlePrintReceipt() {
    if (!lastReceipt) return
    setIsReceiptPrintReady(true)
    setTimeout(() => {
      window.print()
      setIsReceiptPrintReady(false)
    }, 100)
  }

  return (
    <div className="page sell-page">
      <header className="page__header sell-page__header">
        <div>
          <h2 className="page__title">Sell</h2>
          <p className="page__subtitle">
            Scan barcodes with your camera or a scanner, build a cart, apply discounts, and record the sale.
          </p>
        </div>
      </header>

      <div className="sell-page__grid">
        {/* LEFT: Scanner + product search */}
        <section className="card sell-page__left">
          <div className="sell-page__section-header">
            <h3>Scan barcode</h3>
            <p>
              Use your phone camera or a USB barcode scanner. We match the code to the product SKU/barcode you saved.
            </p>
          </div>

          {/* Text-based scan (works with external scanners) */}
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

          {/* Camera scanner (ZXing) */}
          <div className="sell-page__camera-block">
            <div className="sell-page__camera-header">
              <div>
                <div className="sell-page__camera-title">Camera scanner (beta)</div>
                <p className="sell-page__camera-subtitle">
                  Opens your device camera and automatically adds items as you scan.
                </p>
              </div>
              <button
                type="button"
                className="button button--ghost"
                onClick={isCameraScanning ? stopCameraScanner : startCameraScanner}
              >
                {isCameraScanning ? 'Stop camera' : 'Open camera scanner'}
              </button>
            </div>

            {isCameraOpen && (
              <div className="sell-page__camera-preview">
                <video
                  ref={videoRef}
                  className="sell-page__camera-video"
                  muted
                  playsInline
                />
              </div>
            )}

            {cameraError && (
              <p className="sell-page__message sell-page__message--error">
                {cameraError}
              </p>
            )}
          </div>

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
            <p>Review items, apply discount, pick customer, then save the sale.</p>
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

          {/* Totals: Subtotal / VAT / Discount / Total */}
          <div className="sell-page__totals">
            <div className="sell-page__totals-row">
              <span>Subtotal</span>
              <strong>{formatCurrency(subTotal)}</strong>
            </div>
            <div className="sell-page__totals-row">
              <span>VAT / Tax</span>
              <strong>{formatCurrency(taxTotal)}</strong>
            </div>
            <div className="sell-page__totals-row">
              <span>Discount</span>
              <div>
                <input
                  type="text"
                  className="sell-page__discount-input"
                  placeholder="e.g. 5 or 5%"
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                />
              </div>
            </div>
            <div className="sell-page__totals-row sell-page__totals-row--grand">
              <span>Total</span>
              <strong>{formatCurrency(grandTotal)}</strong>
            </div>
          </div>

          {/* Customer + payment block */}
          <div className="sell-page__payment">
            <div className="field">
              <label className="field__label">Customer</label>
              <div className="sell-page__customer-options">
                <label className="radio">
                  <input
                    type="radio"
                    name="customer-mode"
                    value="walk_in"
                    checked={customerMode === 'walk_in'}
                    onChange={() => setCustomerMode('walk_in')}
                  />
                  <span>Walk-in</span>
                </label>
                <label className="radio">
                  <input
                    type="radio"
                    name="customer-mode"
                    value="named"
                    checked={customerMode === 'named'}
                    onChange={() => setCustomerMode('named')}
                  />
                  <span>Existing / named customer</span>
                </label>
              </div>
              {customerMode === 'named' && (
                <div className="sell-page__customer-fields">
                  <input
                    type="text"
                    placeholder="Customer name"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                  />
                  <input
                    type="tel"
                    placeholder="Phone (optional)"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                  />
                </div>
              )}
            </div>

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
              onClick={handleClearCart}
              disabled={isSaving}
            >
              Clear cart
            </button>
            <div className="sell-page__actions-right">
              {lastReceipt && (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handlePrintReceipt}
                >
                  Print last receipt
                </button>
              )}
              <button
                type="button"
                className="button button--primary"
                onClick={handleCommitSale}
                disabled={isSaving || !cart.length}
              >
                {isSaving ? 'Saving…' : 'Save sale'}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Printable receipt layout (uses Sell.css .receipt-print styles) */}
      {lastReceipt && (
        <div
          className={
            'receipt-print' +
            (isReceiptPrintReady ? ' is-ready' : '')
          }
        >
          <div className="receipt-print__inner">
            <h3 className="receipt-print__title">Sedifex POS Receipt</h3>
            <p className="receipt-print__meta">
              Sale ID: {lastReceipt.saleId}
              <br />
              Date:{' '}
              {new Date(lastReceipt.createdAt).toLocaleString()}
              <br />
              Customer: {lastReceipt.customerDescription}
            </p>

            <div className="receipt-print__section">
              <table className="receipt-print__table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {lastReceipt.items.map(line => (
                    <tr key={line.productId}>
                      <td>{line.name}</td>
                      <td>{line.qty}</td>
                      <td>
                        {formatCurrency(line.price * line.qty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="receipt-print__summary">
              <div>
                <span>Subtotal</span>
                <span>{formatCurrency(lastReceipt.subTotal)}</span>
              </div>
              <div>
                <span>VAT / Tax</span>
                <span>{formatCurrency(lastReceipt.taxTotal)}</span>
              </div>
              <div>
                <span>Discount</span>
                <span>
                  -{formatCurrency(lastReceipt.discountAmount)}
                </span>
              </div>
              <div>
                <strong>Total</strong>
                <strong>{formatCurrency(lastReceipt.grandTotal)}</strong>
              </div>
              <div>
                <span>Paid</span>
                <span>{formatCurrency(lastReceipt.amountPaid)}</span>
              </div>
              <div>
                <span>Change</span>
                <span>{formatCurrency(lastReceipt.changeDue)}</span>
              </div>
            </div>

            <p className="receipt-print__footer">
              Thank you for shopping with us.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
