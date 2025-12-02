// web/src/pages/Sell.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
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

type CustomerMode = 'walk_in' | 'existing'

type Customer = {
  id: string
  name: string
  phone: string | null
  email: string | null
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

function mapFirestoreCustomer(id: string, data: any): Customer {
  const name =
    typeof data.name === 'string' && data.name.trim()
      ? data.name.trim()
      : 'Unnamed customer'
  const phone =
    typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim() : null
  const email =
    typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null

  return {
    id,
    name,
    phone,
    email,
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'GHS 0.00'
  return `GHS ${amount.toFixed(2)}`
}

/**
 * Parse a VAT / discount input.
 * Supports:
 *  - "5" or "5%" => 5% of base
 *  - "0.05"      => 5% of base
 *  - "12.5"      => 12.5% of base
 *  - "20 cedis"  => 20 (flat amount, any non-numeric suffix ignored)
 */
function parseAmountOrPercent(input: string, base: number): number {
  const raw = input.trim()
  if (!raw) return 0

  const hasPercent = raw.includes('%')
  const numericPart = raw.replace('%', '').trim()
  let value = Number(numericPart)

  if (!Number.isFinite(value)) return 0

  // Handle "0.05" style (5%)
  if (!hasPercent && value > 0 && value < 1) {
    return base * value
  }

  if (hasPercent) {
    return (base * value) / 100
  }

  // If it's a "normal" number (>= 1) with no %, treat as flat amount
  return value
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

  // 🔹 Camera scanner state
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerControlsRef = useRef<IScannerControls | null>(null)
  const lastScanRef = useRef<{ code: string; ts: number } | null>(null)

  // 🔹 VAT & discount
  const [vatInput, setVatInput] = useState('')
  const [discountInput, setDiscountInput] = useState('')

  // 🔹 Customer
  const [customerMode, setCustomerMode] = useState<CustomerMode>('walk_in')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerNameInput, setCustomerNameInput] = useState('')
  const [customerPhoneInput, setCustomerPhoneInput] = useState('')

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
      const rows: Product[] = snap.docs.map(d => mapFirestoreProduct(d.id, d.data()))
      setProducts(rows)
    })

    return () => unsub()
  }, [activeStoreId])

  // Load customers for this store (for type-ahead)
  useEffect(() => {
    if (!activeStoreId) {
      setCustomers([])
      return
    }

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', activeStoreId),
      orderBy('name', 'asc'),
    )

    const unsub = onSnapshot(q, snap => {
      const rows: Customer[] = snap.docs.map(d =>
        mapFirestoreCustomer(d.id, d.data()),
      )
      setCustomers(rows)
    })

    return () => unsub()
  }, [activeStoreId])

  // Filtered list for manual product search
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

  // Filtered customers when mode is "existing"
  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers.slice(0, 10)
    const term = customerSearch.trim().toLowerCase()
    return customers
      .filter(c => {
        const inName = c.name.toLowerCase().includes(term)
        const inPhone = (c.phone ?? '').toLowerCase().includes(term)
        const inEmail = (c.email ?? '').toLowerCase().includes(term)
        return inName || inPhone || inEmail
      })
      .slice(0, 10)
  }, [customers, customerSearch])

  // Totals (cart subtotal, then VAT & discount input)
  const subTotal = useMemo(() => {
    let sub = 0
    for (const line of cart) {
      const lineSub = line.price * line.qty
      sub += lineSub
    }
    return sub
  }, [cart])

  const vatAmount = useMemo(
    () => parseAmountOrPercent(vatInput, subTotal),
    [vatInput, subTotal],
  )

  const discountAmount = useMemo(
    () => parseAmountOrPercent(discountInput, subTotal + vatAmount),
    [discountInput, subTotal, vatAmount],
  )

  const grandTotal = useMemo(() => {
    const total = subTotal + vatAmount - discountAmount
    return total > 0 ? total : 0
  }, [subTotal, vatAmount, discountAmount])

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

  // Helper: add to cart
  function addProductToCart(product: Product, qty: number = 1) {
    if (!product.price || product.price < 0) {
      setScanStatus({
        type: 'error',
        message: `This item has no price. Set a price on the Products page first.`,
      })
      return
    }

    setCart(prev => {
      const existingIndex = prev.findIndex(line => line.productId === product.id)
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

  // 🔹 Shared barcode lookup (used by text box + camera)
  function handleBarcodeLookup(rawCode: string) {
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

  // 🔹 Manual scan handler (USB scanner or typed code)
  function handleScanSubmit(event: React.FormEvent) {
    event.preventDefault()
    setScanStatus(null)

    if (!scanInput.trim()) {
      setScanStatus({
        type: 'error',
        message: 'Enter or scan a barcode first.',
      })
      return
    }

    handleBarcodeLookup(scanInput)
    setScanInput('')
  }

  // 🔹 Camera scanner (ZXing) hook
  useEffect(() => {
    if (!isCameraOpen) {
      // Tear down
      scannerControlsRef.current?.stop()
      scannerControlsRef.current = null
      setIsCameraReady(false)
      setCameraError(null)
      return
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'This browser does not allow camera access. Try Chrome on Android or Safari on iOS.',
      )
      return
    }

    let isCancelled = false
    const codeReader = new BrowserMultiFormatReader()

    async function startScanner() {
      try {
        const videoElement = videoRef.current
        if (!videoElement) return

        const devices = await BrowserMultiFormatReader.listVideoInputDevices()
        const preferredDeviceId = devices[0]?.deviceId ?? undefined

        const controls = await codeReader.decodeFromVideoDevice(
          preferredDeviceId,
          videoElement,
          (result, err) => {
            if (result) {
              const text = result.getText()
              const normalized = normalizeBarcode(text)
              if (!normalized) return

              const now = Date.now()
              const last = lastScanRef.current
              // Avoid spamming the same code every frame
              if (last && last.code === normalized && now - last.ts < 1500) {
                return
              }
              lastScanRef.current = { code: normalized, ts: now }

              handleBarcodeLookup(normalized)
            }
            if (err && !(err as any).message?.includes('No MultiFormat Readers')) {
              // ZXing will throw a lot while searching; ignore those
              // Only show a generic message if needed
              // console.debug('[scanner] error', err)
            }
          },
        )

        if (isCancelled) {
          controls.stop()
          return
        }

        scannerControlsRef.current = controls
        setIsCameraReady(true)
        setCameraError(null)
      } catch (error: any) {
        console.error('[scanner] Failed to start camera scanner', error)
        setCameraError(
          'Could not start camera. Check permissions and try again.',
        )
        setIsCameraReady(false)
      }
    }

    startScanner()

    return () => {
      isCancelled = true
      try {
        scannerControlsRef.current?.stop()
      } catch {
        // ignore
      }
      scannerControlsRef.current = null
      codeReader.reset()
    }
  }, [isCameraOpen, products]) // restart if product list changes

  // 🔹 Customer helpers
  function handleSelectExistingCustomer(cust: Customer) {
    setSelectedCustomerId(cust.id)
    setCustomerNameInput(cust.name)
    setCustomerPhoneInput(cust.phone ?? '')
    setCustomerSearch(`${cust.name}${cust.phone ? ` (${cust.phone})` : ''}`)
  }

  // 🔹 Commit sale
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
        subTotal,
        taxTotal: vatAmount,
        discountTotal: discountAmount,
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
      }

      let customerPayload: any = null
      if (customerMode === 'walk_in') {
        if (customerNameInput || customerPhoneInput) {
          customerPayload = {
            type: 'walk_in',
            name: customerNameInput || 'Walk-in customer',
            phone: customerPhoneInput || null,
          }
        }
      } else {
        if (selectedCustomerId) {
          customerPayload = {
            type: 'existing',
            id: selectedCustomerId,
            name: customerNameInput || null,
            phone: customerPhoneInput || null,
          }
        } else if (customerNameInput) {
          customerPayload = {
            type: 'named',
            name: customerNameInput,
            phone: customerPhoneInput || null,
          }
        }
      }

      const commitSaleFn = httpsCallable(functions, 'commitSale')
      await commitSaleFn({
        branchId: activeStoreId,
        items,
        totals,
        cashierId: user?.uid ?? null,
        saleId: `sale_${activeStoreId}_${Date.now()}`,
        payment,
        customer: customerPayload,
      })

      setCart([])
      setAmountPaidInput('')
      setVatInput('')
      setDiscountInput('')
      setCustomerMode('walk_in')
      setCustomerSearch('')
      setSelectedCustomerId(null)
      setCustomerNameInput('')
      setCustomerPhoneInput('')
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
            Scan barcodes with your camera or a USB barcode scanner, build a cart, apply
            discount, pick customer, then save the sale.
          </p>
        </div>
      </header>

      <div className="sell-page__grid">
        {/* LEFT: Scanner + product search */}
        <section className="card sell-page__left">
          <div className="sell-page__section-header">
            <h3>Scan barcode</h3>
            <p>
              Use your phone camera or a USB barcode scanner. We match the code to the
              product SKU/barcode you saved.
            </p>
          </div>

          <form className="sell-page__scan-form" onSubmit={handleScanSubmit}>
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

          <div className="sell-page__camera-block">
            <h4 className="sell-page__camera-title">Camera scanner (beta)</h4>
            <p className="sell-page__camera-text">
              Opens your device camera and automatically adds items as you scan.
            </p>

            <button
              type="button"
              className="button button--ghost"
              onClick={() => setIsCameraOpen(open => !open)}
            >
              {isCameraOpen ? 'Close camera scanner' : 'Open camera scanner'}
            </button>

            {isCameraOpen && (
              <div className="sell-page__camera-wrapper">
                <video
                  ref={videoRef}
                  className="sell-page__camera-preview"
                  muted
                  playsInline
                  autoPlay
                />
                {!isCameraReady && !cameraError && (
                  <p className="sell-page__camera-hint">
                    Initialising camera… hold barcode in front of the box.
                  </p>
                )}
                {cameraError && (
                  <p className="sell-page__camera-error">{cameraError}</p>
                )}
              </div>
            )}

            {!isCameraOpen && (
              <p className="sell-page__camera-hint sell-page__camera-hint--idle">
                Camera preview not ready yet.
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

          <div className="sell-page__totals">
            <div className="sell-page__totals-row">
              <span>Subtotal</span>
              <strong>{formatCurrency(subTotal)}</strong>
            </div>

            <div className="sell-page__totals-row">
              <span>VAT / Tax</span>
              <div className="sell-page__totals-input">
                <input
                  type="text"
                  placeholder="e.g. 5 or 5%"
                  value={vatInput}
                  onChange={e => setVatInput(e.target.value)}
                />
                <span>{formatCurrency(vatAmount)}</span>
              </div>
            </div>

            <div className="sell-page__totals-row">
              <span>Discount</span>
              <div className="sell-page__totals-input">
                <input
                  type="text"
                  placeholder="e.g. 10 or 5%"
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                />
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            </div>

            <div className="sell-page__totals-row sell-page__totals-row--grand">
              <span>Total</span>
              <strong>{formatCurrency(grandTotal)}</strong>
            </div>
          </div>

          {/* Customer + payment */}
          <div className="sell-page__customer">
            <div className="sell-page__customer-header">
              <span>Customer</span>
              <div className="sell-page__customer-mode">
                <label>
                  <input
                    type="radio"
                    name="customer-mode"
                    value="walk_in"
                    checked={customerMode === 'walk_in'}
                    onChange={() => setCustomerMode('walk_in')}
                  />
                  <span>Walk-in</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="customer-mode"
                    value="existing"
                    checked={customerMode === 'existing'}
                    onChange={() => setCustomerMode('existing')}
                  />
                  <span>Existing / named customer</span>
                </label>
              </div>
            </div>

            {customerMode === 'existing' && (
              <div className="sell-page__customer-search">
                <label className="field">
                  <span className="field__label">Search customer</span>
                  <input
                    type="text"
                    placeholder="Type name, phone, or email"
                    value={customerSearch}
                    onChange={e => {
                      setCustomerSearch(e.target.value)
                      setSelectedCustomerId(null)
                    }}
                  />
                </label>

                {filteredCustomers.length ? (
                  <ul className="sell-page__customer-results">
                    {filteredCustomers.map(c => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectExistingCustomer(c)}
                        >
                          <span className="sell-page__customer-results-name">
                            {c.name}
                          </span>
                          <span className="sell-page__customer-results-meta">
                            {c.phone || c.email || 'No contact on file'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sell-page__customer-results-empty">
                    No customers match this search.
                  </p>
                )}
              </div>
            )}

            <div className="sell-page__customer-details">
              <div className="field">
                <label className="field__label">Customer name</label>
                <input
                  type="text"
                  value={customerNameInput}
                  onChange={e => setCustomerNameInput(e.target.value)}
                  placeholder={
                    customerMode === 'walk_in'
                      ? 'Optional – leave blank for walk-in'
                      : 'Name of customer'
                  }
                />
              </div>
              <div className="field">
                <label className="field__label">Phone (optional)</label>
                <input
                  type="tel"
                  value={customerPhoneInput}
                  onChange={e => setCustomerPhoneInput(e.target.value)}
                  placeholder="Phone number"
                />
              </div>
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
                setVatInput('')
                setDiscountInput('')
                setScanStatus(null)
                setErrorMessage(null)
                setSuccessMessage(null)
                setCustomerMode('walk_in')
                setCustomerSearch('')
                setSelectedCustomerId(null)
                setCustomerNameInput('')
                setCustomerPhoneInput('')
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
