// web/src/pages/Sell.tsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'
import { normalizeBarcode } from '../utils/barcode'
import './Sell.css'

import {
  BrowserMultiFormatReader,
  NotFoundException,
} from '@zxing/browser'
import { useKeyboardScanner } from '../components/BarcodeScanner'

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

type Customer = {
  id: string
  name: string
  phone: string | null
  email?: string | null
}

type CustomerMode = 'walk_in' | 'named'

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
  const [discountInput, setDiscountInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // 🔹 Scan-specific state
  const [scanInput, setScanInput] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)

  // 🔹 Camera scanner
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<BrowserMultiFormatReader | null>(null)
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null)

  // 🔹 Customer selection
  const [customerMode, setCustomerMode] = useState<CustomerMode>('walk_in')
  const [customerNameInput, setCustomerNameInput] = useState('')
  const [customerPhoneInput, setCustomerPhoneInput] = useState('')
  const [allCustomers, setAllCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  // Load products
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

  // Load customers
  useEffect(() => {
    if (!activeStoreId) {
      setAllCustomers([])
      return
    }

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', activeStoreId),
      orderBy('name', 'asc'),
    )

    const unsub = onSnapshot(q, snap => {
      const rows: Customer[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any
        return {
          id: docSnap.id,
          name: String(data.name ?? 'Unnamed customer'),
          phone:
            typeof data.phone === 'string' ? data.phone : null,
          email:
            typeof data.email === 'string' ? data.email : undefined,
        }
      })
      setAllCustomers(rows)
    })

    return () => unsub()
  }, [activeStoreId])

  const customerSuggestions = useMemo(() => {
    if (customerMode !== 'named') return []
    const term = customerNameInput.trim().toLowerCase()
    if (!term) return []
    return allCustomers
      .filter(c => {
        const inName = c.name.toLowerCase().includes(term)
        const inPhone = (c.phone ?? '').toLowerCase().includes(term)
        return inName || inPhone
      })
      .slice(0, 5)
  }, [allCustomers, customerMode, customerNameInput])

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

  // Totals (before discount)
  const { subTotal, taxTotal, grossTotal } = useMemo(() => {
    let sub = 0
    let tax = 0
    for (const line of cart) {
      const lineSub = line.price * line.qty
      const rate = Number(line.taxRate || 0)
      const lineTax = rate > 0 ? lineSub * rate : 0
      sub += lineSub
      tax += lineTax
    }
    return {
      subTotal: sub,
      taxTotal: tax,
      grossTotal: sub + tax,
    }
  }, [cart])

  // Discount parsing
  const {
    discountAmount,
    discountError,
    totalAfterDiscount,
  } = useMemo(() => {
    const input = discountInput.trim()
    if (!input) {
      return {
        discountAmount: 0,
        discountError: null as string | null,
        totalAfterDiscount: grossTotal,
      }
    }

    let amount = 0
    let error: string | null = null

    if (input.endsWith('%')) {
      const num = Number(input.slice(0, -1).trim())
      if (!Number.isFinite(num) || num < 0) {
        error = 'Enter a valid percentage (e.g. 5 or 7.5)'
      } else {
        amount = grossTotal * (num / 100)
      }
    } else {
      const num = Number(input)
      if (!Number.isFinite(num) || num < 0) {
        error = 'Enter a valid amount or percentage'
      } else {
        amount = num
      }
    }

    if (amount > grossTotal) amount = grossTotal
    const finalTotal = Math.max(0, grossTotal - amount)

    return {
      discountAmount: amount,
      discountError: error,
      totalAfterDiscount: finalTotal,
    }
  }, [discountInput, grossTotal])

  const amountPaid = useMemo(() => {
    const raw = Number(amountPaidInput)
    if (!Number.isFinite(raw) || raw < 0) return 0
    return raw
  }, [amountPaidInput])

  const changeDue = useMemo(() => {
    const diff = amountPaid - totalAfterDiscount
    if (!Number.isFinite(diff)) return 0
    return diff > 0 ? diff : 0
  }, [amountPaid, totalAfterDiscount])

  const isShortPayment = useMemo(() => {
    if (amountPaid <= 0) return false
    return amountPaid < totalAfterDiscount
  }, [amountPaid, totalAfterDiscount])

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

  // 🔹 Use decoded text for both manual + camera
  function handleScanFromDecodedText(
    rawText: string,
    source: 'manual' | 'camera' | 'keyboard' = 'manual',
  ) {
    const normalized = normalizeBarcode(rawText)
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
      message:
        source === 'keyboard'
          ? `Added "${found.name}" via the scanner.`
          : `Added "${found.name}" to the cart.`,
    })
  }

  // 🔹 Manual scan submit
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

    handleScanFromDecodedText(normalized)
    setScanInput('')
  }

  useKeyboardScanner(
    result => {
      setScanStatus(null)
      handleScanFromDecodedText(result.code, result.source)
    },
    message =>
      setScanStatus({
        type: 'error',
        message,
      }),
  )

  // 🔹 Camera scanner logic (prefer back camera)
  useEffect(() => {
    if (!isCameraOpen || !videoRef.current) return

    const reader = new BrowserMultiFormatReader()
    scannerRef.current = reader
    setCameraError(null)
    setIsCameraReady(false)

    let cancelled = false

    ;(async () => {
      try {
        let deviceId: string | undefined

        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const videoDevices = devices.filter(d => d.kind === 'videoinput')

          if (videoDevices.length > 0) {
            const backCamera =
              videoDevices.find(d =>
                /back|rear|environment/i.test(d.label || ''),
              ) || videoDevices[0]

            deviceId = backCamera.deviceId
          }
        }

        const controls = await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current!,
          (result, error) => {
            if (cancelled) return

            if (result) {
              setIsCameraReady(true)
              const text = result.getText()
              if (text) {
                handleScanFromDecodedText(text)
              }
            }

            if (error && !(error instanceof NotFoundException)) {
              console.error('[sell] camera decode error', error)
            }
          },
        )

        scannerControlsRef.current = controls
      } catch (err: any) {
        console.error('[sell] camera init error', err)
        if (!cancelled) {
          setCameraError(
            'We could not access your camera. Check permissions and try again.',
          )
          setIsCameraOpen(false)
        }
      }
    })()

    return () => {
      cancelled = true

      if (scannerControlsRef.current) {
        scannerControlsRef.current.stop()
        scannerControlsRef.current = null
      }

      if (scannerRef.current && typeof scannerRef.current.reset === 'function') {
        scannerRef.current.reset()
        scannerRef.current = null
      }
    }
  }, [isCameraOpen, products])

  function handleCloseCameraClick() {
    setIsCameraOpen(false)

    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop()
      scannerControlsRef.current = null
    }

    if (scannerRef.current && typeof scannerRef.current.reset === 'function') {
      scannerRef.current.reset()
      scannerRef.current = null
    }
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
    if (discountError) {
      setErrorMessage('Please fix the discount field before saving.')
      return
    }
    if (customerMode === 'named' && !customerNameInput.trim()) {
      setErrorMessage('Enter or choose a customer name.')
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
        discount: discountAmount,
        total: totalAfterDiscount,
      }

      const payment = {
        method: paymentMethod,
        tenders: [
          {
            method: paymentMethod,
            amount: totalAfterDiscount,
          },
        ],
      }

      const customerPayload =
        customerMode === 'walk_in'
          ? null
          : {
              id: selectedCustomerId,
              name: customerNameInput.trim(),
              phone: customerPhoneInput.trim() || null,
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
      setDiscountInput('')
      setCustomerNameInput('')
      setCustomerPhoneInput('')
      setSelectedCustomerId(null)
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
            Scan barcodes with your camera or a scanner, build a cart, apply
            discount, pick the customer, then save the sale.
          </p>
        </div>
      </header>

      <div className="sell-page__grid">
        {/* LEFT */}
        <section className="card sell-page__left">
          <div className="sell-page__section-header">
            <h3>Scan barcode</h3>
            <p>
              Use your phone camera or a USB barcode scanner. We match the code
              to the product SKU/barcode you saved.
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

          {/* Camera */}
          <div className="sell-page__section-header" style={{ marginTop: 16 }}>
            <h3>Camera scanner (beta)</h3>
            <p>
              Opens your device camera and automatically adds items as you scan.
            </p>
          </div>

          {isCameraOpen ? (
            <div className="sell-page__camera-panel">
              <video
                ref={videoRef}
                className="sell-page__camera-preview"
                autoPlay
                muted
                playsInline
              />
              <div className="sell-page__camera-actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleCloseCameraClick}
                >
                  Close camera
                </button>
              </div>
              <p
                className={
                  'sell-page__camera-hint ' +
                  (isCameraReady ? '' : 'sell-page__camera-hint--idle')
                }
              >
                {isCameraReady
                  ? 'Camera is on. Point it at a barcode to add items automatically.'
                  : 'Opening camera… If this stays here, check that you allowed camera access.'}
              </p>
              {cameraError && (
                <p className="sell-page__camera-error">{cameraError}</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setIsCameraOpen(true)}
            >
              Open camera scanner
            </button>
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

        {/* RIGHT */}
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

          {/* Totals */}
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
              <div style={{ textAlign: 'right' }}>
                <input
                  type="text"
                  className={
                    'sell-page__input' +
                    (discountError ? ' sell-page__input--error' : '')
                  }
                  placeholder="e.g. 5 or 5%"
                  value={discountInput}
                  onChange={e => setDiscountInput(e.target.value)}
                  style={{ maxWidth: 140 }}
                />
                {discountAmount > 0 && !discountError && (
                  <div style={{ fontSize: 12, color: '#4b5563' }}>
                    − {formatCurrency(discountAmount)}
                  </div>
                )}
                {discountError && (
                  <div
                    style={{
                      fontSize: 12,
                      color: '#b91c1c',
                      marginTop: 2,
                    }}
                  >
                    {discountError}
                  </div>
                )}
              </div>
            </div>
            <div className="sell-page__totals-row sell-page__totals-row--grand">
              <span>Total</span>
              <strong>{formatCurrency(totalAfterDiscount)}</strong>
            </div>
          </div>

          {/* Customer */}
          <div style={{ marginTop: 16 }}>
            <div className="sell-page__section-header">
              <h3>Customer</h3>
              <p>
                Mark it as a walk-in or link the sale to an existing / named
                customer.
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 16,
                alignItems: 'center',
                marginTop: 8,
                marginBottom: 8,
              }}
            >
              <label style={{ display: 'flex', gap: 6, fontSize: 14 }}>
                <input
                  type="radio"
                  name="sell-customer-mode"
                  checked={customerMode === 'walk_in'}
                  onChange={() => setCustomerMode('walk_in')}
                />
                <span>Walk-in</span>
              </label>
              <label style={{ display: 'flex', gap: 6, fontSize: 14 }}>
                <input
                  type="radio"
                  name="sell-customer-mode"
                  checked={customerMode === 'named'}
                  onChange={() => setCustomerMode('named')}
                />
                <span>Existing / named customer</span>
              </label>
            </div>

            <div className="sell-page__payment">
              <div className="field">
                <label className="field__label">Customer name</label>
                <input
                  type="text"
                  placeholder="Type to search or add name"
                  value={customerNameInput}
                  onChange={e => {
                    setCustomerNameInput(e.target.value)
                    setSelectedCustomerId(null)
                  }}
                  disabled={customerMode === 'walk_in'}
                />
                {customerMode === 'named' &&
                  customerSuggestions.length > 0 && (
                    <ul className="sell-page__customer-suggestions">
                      {customerSuggestions.map(c => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomerNameInput(c.name)
                              setCustomerPhoneInput(c.phone ?? '')
                              setSelectedCustomerId(c.id)
                            }}
                          >
                            {c.name}
                            {c.phone ? ` · ${c.phone}` : ''}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
              <div className="field">
                <label className="field__label">Phone (optional)</label>
                <input
                  type="tel"
                  placeholder="0xxxxxxxxx"
                  value={customerPhoneInput}
                  onChange={e => setCustomerPhoneInput(e.target.value)}
                  disabled={customerMode === 'walk_in'}
                />
              </div>
            </div>
          </div>

          {/* Payment */}
          <div className="sell-page__payment" style={{ marginTop: 20 }}>
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
                <p
                  className={
                    'sell-page__change ' +
                    (isShortPayment ? 'is-short' : '')
                  }
                >
                  {isShortPayment
                    ? `Short by ${formatCurrency(
                        totalAfterDiscount - amountPaid,
                      )}`
                    : `Change due: ${formatCurrency(changeDue)}`}
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
                setDiscountInput('')
                setScanStatus(null)
                setErrorMessage(null)
                setSuccessMessage(null)
                setCustomerNameInput('')
                setCustomerPhoneInput('')
                setSelectedCustomerId(null)
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
