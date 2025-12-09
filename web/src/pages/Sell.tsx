// web/src/pages/Sell.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'
import { normalizeBarcode } from '../utils/barcode'
import {
  CUSTOMER_CACHE_LIMIT,
  PRODUCT_CACHE_LIMIT,
  loadCachedCustomers,
  loadCachedProducts,
  saveCachedCustomers,
  saveCachedProducts,
} from '../utils/offlineCache'
import './Sell.css'

import { BrowserMultiFormatReader, BrowserQRCodeSvgWriter } from '@zxing/browser'
import {
  BarcodeFormat,
  DecodeHintType,
  NotFoundException,
} from '@zxing/library'
import { useKeyboardScanner } from '../components/BarcodeScanner'
import { buildSimplePdf } from '../utils/pdf'
import {
  PaymentMethod,
  buildReceiptPdf,
  type ReceiptLine,
  type ReceiptPayload,
} from '../utils/receipt'
import { requestAiAdvisor } from '../api/aiAdvisor'

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
  itemType: ItemType
}

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
  const [searchParams] = useSearchParams()

  const [storeName, setStoreName] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [searchText, setSearchText] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [amountPaidInput, setAmountPaidInput] = useState('')
  const [discountInput, setDiscountInput] = useState('')
  const [taxInput, setTaxInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [aiTip, setAiTip] = useState<string | null>(null)
  const [aiTipLoading, setAiTipLoading] = useState(false)
  const [aiTipError, setAiTipError] = useState<string | null>(null)
  const [aiTipOffline, setAiTipOffline] = useState(false)
  const aiTipSignatureRef = useRef<string>('')

  const activityActor = user?.displayName || user?.email || 'Team member'

  // 🔹 Scan-specific state
  const [scanInput, setScanInput] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)

  // 🔹 Camera scanner
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraStatusMessage, setCameraStatusMessage] = useState('')
  const [lastCameraScanAt, setLastCameraScanAt] = useState<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null)
  const appliedCustomerFromParams = useRef<string | null>(null)

  // 🔹 Customer selection
  const [customerMode, setCustomerMode] = useState<CustomerMode>('walk_in')
  const [customerNameInput, setCustomerNameInput] = useState('')
  const [customerPhoneInput, setCustomerPhoneInput] = useState('')
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [allCustomers, setAllCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [lastReceipt, setLastReceipt] = useState<ReceiptPayload | null>(null)
  const [receiptDownload, setReceiptDownload] = useState<{
    url: string
    fileName: string
    shareText: string
  } | null>(null)
  const [receiptQrSvg, setReceiptQrSvg] = useState<string | null>(null)

  function extractStoreName(data: any): string | null {
    const candidates = [
      data?.company,
      data?.name,
      data?.companyName,
      data?.storeName,
      data?.businessName,
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return null
  }

  useEffect(() => {
    if (!activeStoreId) {
      setStoreName(null)
      return
    }

    const refs = [
      doc(db, 'stores', activeStoreId),
      doc(db, 'workspaces', activeStoreId),
    ]

    const unsubscribers = refs.map(ref =>
      onSnapshot(
        ref,
        snapshot => {
          const name = extractStoreName(snapshot.data())
          setStoreName(prev => (name ? name : prev ?? null))
        },
        () => setStoreName(prev => prev ?? null),
      ),
    )

    return () => {
      unsubscribers.forEach(unsub => unsub())
    }
  }, [activeStoreId])

  // Load products
  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setProducts([])
      return () => {
        cancelled = true
      }
    }

    // 1) Seed from offline cache for instant results / offline support
    loadCachedProducts<Product>({ storeId: activeStoreId })
      .then(cached => {
        if (cancelled || !cached.length) return
        setProducts(
          cached
            .map((item, index) =>
              mapFirestoreProduct((item as any).id ?? `cached-${index}`, item as any),
            )
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        )
      })
      .catch(err => {
        console.warn('[sell] Failed to load cached products', err)
      })

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('name', 'asc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsub = onSnapshot(q, snap => {
      const rows: Product[] = snap.docs.map(d =>
        mapFirestoreProduct(d.id, d.data()),
      )

      saveCachedProducts(
        rows.map(r => ({ ...r, id: undefined as any })),
        { storeId: activeStoreId },
      ).catch(err => {
        console.warn('[sell] Failed to cache products', err)
      })
      setProducts(rows)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [activeStoreId])

  useEffect(() => {
    if (!lastReceipt) return

    if (receiptDownload?.url) {
      URL.revokeObjectURL(receiptDownload.url)
    }

    const built = buildReceiptPdf(lastReceipt)
    setReceiptDownload(built)
  }, [lastReceipt])

  useEffect(() => {
    if (!receiptDownload?.url) {
      setReceiptQrSvg(null)
      return
    }

    try {
      const writer = new BrowserQRCodeSvgWriter()
      const svg = writer.write(receiptDownload.url, 200, 200)
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', 'Receipt QR code')
      setReceiptQrSvg(svg.outerHTML)
    } catch (error) {
      console.warn('[sell] Failed to build receipt QR code', error)
      setReceiptQrSvg(null)
    }
  }, [receiptDownload])

  useEffect(() => {
    return () => {
      if (receiptDownload?.url) {
        URL.revokeObjectURL(receiptDownload.url)
      }
    }
  }, [receiptDownload])

  // Load customers
  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setAllCustomers([])
      return () => {
        cancelled = true
      }
    }

    // 1) Try cached customers first
    loadCachedCustomers<Customer>({ storeId: activeStoreId })
      .then(cached => {
        if (cancelled || !cached.length) return
        setAllCustomers(
          cached
            .map((item, index) => ({
              id: (item as any).id ?? `cached-${index}`,
              name: item.name,
              phone: item.phone ?? null,
              email: item.email ?? undefined,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        )
      })
      .catch(err => {
        console.warn('[sell] Failed to load cached customers', err)
      })

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', activeStoreId),
      orderBy('name', 'asc'),
      limit(CUSTOMER_CACHE_LIMIT),
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

      saveCachedCustomers(
        rows.map(r => ({ ...r, id: undefined as any })),
        { storeId: activeStoreId },
      ).catch(err => {
        console.warn('[sell] Failed to cache customers', err)
      })
      setAllCustomers(rows)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [activeStoreId])

  const initialCustomerId = searchParams.get('customerId')

  useEffect(() => {
    if (!initialCustomerId) return

    if (appliedCustomerFromParams.current === initialCustomerId) return

    const match = allCustomers.find(customer => customer.id === initialCustomerId)
    if (!match) return

    setCustomerMode('named')
    setSelectedCustomerId(match.id)
    setCustomerNameInput(match.name)
    setCustomerPhoneInput(match.phone ?? '')
    setCustomerSearchTerm(match.name)
    appliedCustomerFromParams.current = initialCustomerId
  }, [initialCustomerId, allCustomers])

  const customerResults = useMemo(() => {
    if (customerMode !== 'named') return []
    const term = customerSearchTerm.trim().toLowerCase()

    const matches = allCustomers.filter(c => {
      if (!term) return true
      const inName = c.name.toLowerCase().includes(term)
      const inPhone = (c.phone ?? '').toLowerCase().includes(term)
      return inName || inPhone
    })

    return matches.slice(0, 20)
  }, [allCustomers, customerMode, customerSearchTerm])

  // Keep customer fields tidy when switching modes
  useEffect(() => {
    if (customerMode === 'walk_in') {
      setCustomerNameInput('')
      setCustomerPhoneInput('')
      setCustomerSearchTerm('')
      setSelectedCustomerId(null)
    } else if (customerMode === 'named' && customerNameInput) {
      setCustomerSearchTerm(customerNameInput)
    }
  }, [customerMode, customerNameInput])

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
  const { subTotal, autoTaxTotal } = useMemo(() => {
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
      autoTaxTotal: tax,
    }
  }, [cart])

  // Allow overriding VAT/tax if the cashier wants to adjust the default rate
  const { effectiveTaxTotal, taxError } = useMemo(() => {
    const input = taxInput.trim()
    if (!input) {
      return { effectiveTaxTotal: autoTaxTotal, taxError: null as string | null }
    }

    let amount = 0
    let error: string | null = null

    if (input.endsWith('%')) {
      const num = Number(input.slice(0, -1).trim())
      if (!Number.isFinite(num) || num < 0) {
        error = 'Enter a valid percentage (e.g. 7.5%)'
      } else {
        amount = subTotal * (num / 100)
      }
    } else {
      const num = Number(input)
      if (!Number.isFinite(num) || num < 0) {
        error = 'Enter a valid VAT amount or percent'
      } else {
        amount = num
      }
    }

    return {
      effectiveTaxTotal: Number.isFinite(amount) ? amount : autoTaxTotal,
      taxError: error,
    }
  }, [autoTaxTotal, subTotal, taxInput])

  const grossTotal = useMemo(
    () => subTotal + effectiveTaxTotal,
    [effectiveTaxTotal, subTotal],
  )

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

  const aiCartContext = useMemo(() => {
    if (!cart.length) return null

    return {
      items: cart.map(line => ({
        id: line.productId,
        name: line.name,
        qty: line.qty,
        price: line.price,
        taxRate: line.taxRate,
        itemType: line.itemType,
        lineTotal: line.qty * line.price,
      })),
      totals: {
        subTotal,
        taxTotal: effectiveTaxTotal,
        discount: discountAmount,
        total: totalAfterDiscount,
      },
      paymentMethod,
      discountInput: discountInput.trim() || undefined,
      taxInput: taxInput.trim() || undefined,
    }
  }, [
    cart,
    discountAmount,
    discountInput,
    effectiveTaxTotal,
    paymentMethod,
    subTotal,
    taxInput,
    totalAfterDiscount,
  ])

  const aiCartSignature = useMemo(
    () => (aiCartContext ? JSON.stringify(aiCartContext) : ''),
    [aiCartContext],
  )

  async function fetchAiTip(manual = false) {
    if (!aiCartContext) return
    if (!manual && aiCartSignature === aiTipSignatureRef.current) return

    setAiTipLoading(true)
    setAiTipError(null)

    try {
      const response = await requestAiAdvisor({
        question: 'Suggest upsell or promo ideas for this cart.',
        storeId: activeStoreId ?? undefined,
        jsonContext: aiCartContext,
      })

      setAiTip(response.advice)
      aiTipSignatureRef.current = aiCartSignature
      setAiTipOffline(false)
    } catch (error) {
      console.error('[sell] Unable to fetch AI tip', error)
      const offline =
        !navigator.onLine || (error as any)?.code === 'unavailable'

      setAiTipOffline(offline)
      setAiTipError(
        offline
          ? 'You appear to be offline. Reconnect to refresh advice.'
          : 'We could not fetch advice right now. Please try again.',
      )
    } finally {
      setAiTipLoading(false)
    }
  }

  useEffect(() => {
    if (!aiCartSignature) {
      setAiTip(null)
      setAiTipError(null)
      setAiTipOffline(false)
      aiTipSignatureRef.current = ''
      return
    }

    const timer = window.setTimeout(() => {
      void fetchAiTip()
    }, 700)

    return () => window.clearTimeout(timer)
  }, [aiCartSignature])

  const handleRetryAiTip = () => {
    setAiTipOffline(false)
    void fetchAiTip(true)
  }

  const isAiRefreshDisabled = aiTipLoading || aiTipOffline || !aiCartContext

  function printReceipt(options: {
    saleId: string
    items: { name: string; qty: number; price: number }[]
    totals: { subTotal: number; taxTotal: number; discount: number; total: number }
    paymentMethod: PaymentMethod
    discountInput: string
    companyName?: string | null
    customerName?: string | null
  }) {
    try {
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.style.visibility = 'hidden'

      const receiptDate = new Date().toLocaleString()
      const lineRows = options.items
        .map(line => {
          const total = line.price * line.qty
          return `<tr><td>${line.name}</td><td style="text-align:right">${line.qty}</td><td style="text-align:right">${formatCurrency(line.price)}</td><td style="text-align:right">${formatCurrency(total)}</td></tr>`
        })
        .join('')

      const receiptHtml = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 16px; color: #0f172a; }
        h1 { font-size: 18px; margin: 0 0 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { padding: 6px 4px; font-size: 13px; }
        th { text-align: left; border-bottom: 1px solid #e2e8f0; }
        tfoot td { font-weight: 700; border-top: 1px solid #e2e8f0; }
        .meta { font-size: 12px; color: #475569; margin: 0; }
      </style>
    </head>
    <body>
      <h1>Sale receipt</h1>
      ${
        options.companyName
          ? `<p class="meta"><strong>${options.companyName}</strong></p>`
          : ''
      }
      <p class="meta">Sale ID: ${options.saleId}</p>
      <p class="meta">${receiptDate}</p>
      <p class="meta">Payment: ${options.paymentMethod.replace('_', ' ')}</p>
      ${options.customerName ? `<p class="meta">Customer: ${options.customerName}</p>` : ''}
      <table>
        <thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${lineRows}</tbody>
        <tfoot>
          <tr><td colspan="3">Subtotal</td><td style="text-align:right">${formatCurrency(options.totals.subTotal)}</td></tr>
          <tr><td colspan="3">VAT / Tax</td><td style="text-align:right">${formatCurrency(options.totals.taxTotal)}</td></tr>
          <tr><td colspan="3">Discount</td><td style="text-align:right">${options.discountInput ? options.discountInput : 'None'}</td></tr>
          <tr><td colspan="3">Total</td><td style="text-align:right">${formatCurrency(options.totals.total)}</td></tr>
          <tr><td colspan="3">Payment</td><td style="text-align:right">${options.paymentMethod.replace('_', ' ')}</td></tr>
        </tfoot>
      </table>
    </body>
  </html>`

      iframe.onload = () => {
        const frameWindow = iframe.contentWindow
        if (frameWindow) {
          frameWindow.focus()
          frameWindow.print()
        }

        setTimeout(() => {
          document.body.removeChild(iframe)
        }, 500)
      }

      iframe.srcdoc = receiptHtml
      document.body.appendChild(iframe)
    } catch (error) {
      console.error('[sell] Unable to print receipt', error)
    }
  }

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
          itemType: product.itemType,
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
    const hints = new Map<DecodeHintType, any>()
    hints.set(DecodeHintType.TRY_HARDER, true)
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE,
    ])
    reader.setHints(hints)
    setCameraError(null)
    setIsCameraReady(false)
    setLastCameraScanAt(null)
    setCameraStatusMessage(
      'Opening camera… If this stays here, check that you allowed camera access.',
    )

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

            setIsCameraReady(true)
            setCameraStatusMessage(
              'Camera is on. Center the barcode in the guide box and hold steady.',
            )

            if (result) {
              setLastCameraScanAt(Date.now())
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
          setCameraStatusMessage('Camera access failed. Enter the code manually instead.')
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
    }
  }, [isCameraOpen, products])

  useEffect(() => {
    if (!isCameraOpen) return

    setCameraStatusMessage(
      isCameraReady
        ? 'Camera is on. Hold the barcode closer to the lens and keep it steady.'
        : 'Opening camera… If this stays here, check that you allowed camera access.',
    )

    const id = window.setInterval(() => {
      if (!isCameraReady) return

      if (lastCameraScanAt && Date.now() - lastCameraScanAt < 5000) {
        setCameraStatusMessage(
          'Barcode detected! If it does not add automatically, move it closer and try again.',
        )
      } else {
        setCameraStatusMessage(
          'No barcode detected yet. Fill the guide box with the barcode and improve lighting.',
        )
      }
    }, 1200)

    return () => window.clearInterval(id)
  }, [isCameraOpen, isCameraReady, lastCameraScanAt])

  function handleCloseCameraClick() {
    setIsCameraOpen(false)

    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop()
      scannerControlsRef.current = null
    }
  }

  function buildActivitySummary(items: CartLine[]) {
    if (!items.length) return 'Recorded sale'

    const labels = items.map(item => {
      const product = products.find(p => p.id === item.productId)
      const typeLabel =
        item.itemType === 'service'
          ? 'service'
          : product?.itemType === 'service'
            ? 'service'
            : 'product'
      const name = item.name || product?.name || 'Item'
      return typeLabel === 'service' ? `${name} (service)` : name
    })

    if (labels.length === 1) return `Sold ${labels[0]}`

    const [first, second, ...rest] = labels
    const suffix = rest.length ? ` +${rest.length} more` : ''
    return `Sold ${first}, ${second}${suffix}`
  }

  async function logSaleActivity(options: {
    saleId: string
    total: number
    items: CartLine[]
    paymentMethod: PaymentMethod
    receipt: ReceiptPayload
  }) {
    if (!activeStoreId) return

    try {
      const itemCount = options.items.reduce((sum, item) => sum + (item.qty || 0), 0)
      const summary = buildActivitySummary(options.items)
      const detail = [
        `${itemCount || options.items.length} item${itemCount === 1 ? '' : 's'}`,
        `Total ${formatCurrency(options.total)}`,
        `Payment ${options.paymentMethod.replace('_', ' ')}`,
        `ID ${options.saleId}`,
      ].join(' · ')

      const receiptPayload: ReceiptPayload = {
        saleId: options.receipt.saleId,
        items: options.receipt.items.map(item => ({
          name: item.name,
          qty: item.qty,
          price: item.price,
        })),
        totals: options.receipt.totals,
        paymentMethod: options.receipt.paymentMethod,
        discountInput: options.receipt.discountInput,
        companyName: options.receipt.companyName ?? null,
        customerName: options.receipt.customerName ?? null,
      }

      await addDoc(collection(db, 'activity'), {
        storeId: activeStoreId,
        type: 'sale',
        summary,
        detail,
        actor: activityActor,
        createdAt: serverTimestamp(),
        receipt: receiptPayload,
      })
    } catch (error) {
      console.warn('[activity] Failed to log sale activity', error)
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
    if (taxError) {
      setErrorMessage('Please fix the VAT field before saving.')
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
      const saleId = `sale_${activeStoreId}_${Date.now()}`
      const cartSnapshot = [...cart]

      const items = cart.map(line => ({
        productId: line.productId,
        name: line.name,
        qty: line.qty,
        price: line.price,
        taxRate: line.taxRate,
        type: line.itemType,
        isService: line.itemType === 'service',
      }))

      const totals = {
        subTotal,
        taxTotal: effectiveTaxTotal,
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

      const customerName = customerMode === 'named' ? customerNameInput.trim() : null

      const customerPayload =
        customerMode === 'walk_in'
          ? null
          : {
              id: selectedCustomerId,
              name: customerName,
              phone: customerPhoneInput.trim() || null,
            }

      const commitSaleFn = httpsCallable(functions, 'commitSale')
      await commitSaleFn({
        branchId: activeStoreId,
        items,
        totals,
        cashierId: user?.uid ?? null,
        saleId,
        payment,
        customer: customerPayload,
      })

      const receiptItems: ReceiptLine[] = cartSnapshot.map(line => ({
        name: line.name,
        qty: line.qty,
        price: line.price,
      }))

      const receiptPayload: ReceiptPayload = {
        saleId,
        items: receiptItems,
        totals,
        paymentMethod,
        discountInput,
        companyName: storeName,
        customerName,
      }

      printReceipt({
        saleId,
        items: cartSnapshot,
        totals,
        paymentMethod,
        discountInput,
        companyName: storeName,
        customerName,
      })

      setLastReceipt(receiptPayload)

      await logSaleActivity({
        saleId,
        total: totalAfterDiscount,
        items: cartSnapshot,
        paymentMethod,
        receipt: receiptPayload,
      })

      setCart([])
      setAmountPaidInput('')
      setDiscountInput('')
      setTaxInput('')
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
              <div className="sell-page__camera-viewport">
                <video
                  ref={videoRef}
                  className="sell-page__camera-preview"
                  autoPlay
                  muted
                  playsInline
                />
                <div className="sell-page__camera-overlay" aria-hidden="true" />
              </div>
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
                {cameraStatusMessage}
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
              filteredProducts.map(p => {
                const isUnavailable =
                  typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price <= 0
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="sell-page__product-row"
                    onClick={() => addProductToCart(p, 1)}
                    disabled={isUnavailable}
                  >
                    <div className="sell-page__product-main">
                      <div className="sell-page__product-name">{p.name}</div>
                      <div className="sell-page__product-meta">
                        {p.sku && <span>SKU: {p.sku}</span>}
                        {p.barcode && <span>Code: {p.barcode}</span>}
                      </div>
                    </div>
                    <div className="sell-page__product-price">
                      {isUnavailable ? (
                        <span style={{ color: '#b91c1c', fontSize: 12 }}>
                          Price unavailable – set price to sell
                        </span>
                      ) : (
                        formatCurrency(p.price)
                      )}
                    </div>
                  </button>
                )
              })
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

          {/* Totals + AI tip */}
          <div className="sell-page__summary">
            <div className="sell-page__totals">
              <div className="sell-page__totals-row">
                <span>Subtotal</span>
                <strong>{formatCurrency(subTotal)}</strong>
              </div>
              <div className="sell-page__totals-row">
                <span>VAT / Tax</span>
                <div style={{ textAlign: 'right' }}>
                  <input
                    type="text"
                    className={
                      'sell-page__input' +
                      (taxError ? ' sell-page__input--error' : '')
                    }
                    placeholder={`Auto: ${formatCurrency(autoTaxTotal)}`}
                    value={taxInput}
                    onChange={e => setTaxInput(e.target.value)}
                    style={{ maxWidth: 140 }}
                  />
                  {!taxInput && (
                    <div className="sell-page__totals-hint">
                      Using VAT from the product setup.
                    </div>
                  )}
                  {taxError && (
                    <div className="sell-page__totals-hint sell-page__totals-hint--error">
                      {taxError}
                    </div>
                  )}
                  {taxInput && !taxError && (
                    <div className="sell-page__totals-hint">
                      Override total: {formatCurrency(effectiveTaxTotal)}
                    </div>
                  )}
                </div>
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

            <div className="sell-page__ai-tip">
              <div className="sell-page__ai-tip-header">
                <div>
                  <p className="sell-page__ai-tip-title">AI tip</p>
                  <p className="sell-page__ai-tip-subtitle">
                    Quick ideas based on the cart in memory.
                  </p>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  disabled={isAiRefreshDisabled}
                  onClick={() => fetchAiTip(true)}
                  title={
                    aiTipOffline
                      ? 'Offline — check your connection to refresh advice'
                      : undefined
                  }
                >
                  {aiTipLoading ? 'Loading…' : 'Refresh advice'}
                </button>
              </div>

              <div className="sell-page__ai-tip-body">
                {aiTipLoading ? (
                  <p className="sell-page__ai-tip-status">
                    <span className="sell-page__ai-tip-spinner" aria-hidden />
                    Thinking…
                  </p>
                ) : aiTip ? (
                  <p className="sell-page__ai-tip-text">{aiTip}</p>
                ) : (
                  <p className="sell-page__ai-tip-status">
                    {cart.length
                      ? 'We will suggest upsells once the cart settles.'
                      : 'Add items to the cart to get a tailored tip.'}
                  </p>
                )}

                {aiTipError && (
                  <p className="sell-page__ai-tip-error">
                    {aiTipError}{' '}
                    {aiCartContext && (
                      <button
                        type="button"
                        className="sell-page__ai-tip-retry"
                        onClick={handleRetryAiTip}
                        disabled={aiTipLoading}
                      >
                        Retry now
                      </button>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Customer */}
          <div className="sell-page__customer">
            <div className="sell-page__customer-header">
              <div>
                <h3>Customer</h3>
                <p>
                  Mark it as a walk-in or link the sale to an existing / named
                  customer.
                </p>
              </div>
              <div className="sell-page__customer-mode">
                <button
                  type="button"
                  className={
                    'button button--ghost button--small' +
                    (customerMode === 'walk_in' ? ' is-active' : '')
                  }
                  onClick={() => setCustomerMode('walk_in')}
                >
                  Walk-in
                </button>
                <button
                  type="button"
                  className={
                    'button button--ghost button--small' +
                    (customerMode === 'named' ? ' is-active' : '')
                  }
                  onClick={() => setCustomerMode('named')}
                >
                  Existing / named customer
                </button>
              </div>
            </div>

            {customerMode === 'walk_in' ? (
              <p className="sell-page__customer-results-empty">
                Sale will be recorded as a walk-in. Switch to "Existing / named"
                to attach a saved customer.
              </p>
            ) : (
              <>
                <div className="sell-page__customer-search">
                  <label className="field__label">Pick a saved customer</label>
                  <input
                    type="text"
                    placeholder="Search saved customers by name or phone"
                    value={customerSearchTerm}
                    onChange={e => setCustomerSearchTerm(e.target.value)}
                  />
                  <ul className="sell-page__customer-results">
                    {customerResults.length ? (
                      customerResults.map(c => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className={
                              selectedCustomerId === c.id ? 'is-active' : ''
                            }
                            onClick={() => {
                              setCustomerNameInput(c.name)
                              setCustomerPhoneInput(c.phone ?? '')
                              setSelectedCustomerId(c.id)
                              setCustomerSearchTerm(c.name)
                            }}
                          >
                            <span className="sell-page__customer-results-name">
                              {c.name}
                            </span>
                            <span className="sell-page__customer-results-meta">
                              {c.phone || 'No phone number saved'}
                            </span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <p className="sell-page__customer-results-empty">
                        No matching customers. Add a new one below.
                      </p>
                    )}
                  </ul>
                </div>

                <div className="sell-page__customer-details">
                  <div className="field">
                    <label className="field__label">Customer name</label>
                    <input
                      type="text"
                      placeholder="Type to add a new name"
                      value={customerNameInput}
                      onChange={e => {
                        setCustomerNameInput(e.target.value)
                        setSelectedCustomerId(null)
                      }}
                    />
                  </div>
                  <div className="field">
                    <label className="field__label">Phone (optional)</label>
                    <input
                      type="tel"
                      placeholder="0xxxxxxxxx"
                      value={customerPhoneInput}
                      onChange={e => setCustomerPhoneInput(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
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
          {receiptDownload && lastReceipt && (
            <div className="sell-page__receipt-actions" role="status">
              <div className="sell-page__receipt-actions-row">
                <a
                  href={receiptDownload.url}
                  download={receiptDownload.fileName}
                  className="button button--ghost"
                >
                  Download PDF
                </a>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() =>
                    printReceipt({
                      saleId: lastReceipt.saleId,
                      items: lastReceipt.items,
                      totals: lastReceipt.totals,
                      paymentMethod: lastReceipt.paymentMethod,
                      discountInput: lastReceipt.discountInput,
                      companyName: lastReceipt.companyName,
                      customerName: lastReceipt.customerName,
                    })
                  }
                >
                  Print again
                </button>
              </div>

              <div className="sell-page__share-row">
                <span>Share receipt:</span>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(receiptDownload.shareText)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(receiptDownload.url)}&text=${encodeURIComponent(
                    receiptDownload.shareText,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Telegram
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent('Sale receipt')}&body=${encodeURIComponent(
                    `${receiptDownload.shareText}\n\nDownload: ${receiptDownload.url}`,
                  )}`}
                >
                  Email
                </a>
              </div>

              <div className="sell-page__qr">
                <div className="sell-page__qr-header">
                  <p className="sell-page__qr-title">Receipt QR</p>
                  <p className="sell-page__qr-subtitle">
                    Scan on a customer phone or second device to open the receipt link
                    quickly.
                  </p>
                </div>

                <div
                  className="sell-page__qr-code"
                  dangerouslySetInnerHTML={
                    receiptQrSvg ? { __html: receiptQrSvg } : undefined
                  }
                  aria-hidden={!receiptQrSvg}
                >
                  {!receiptQrSvg && <span className="sell-page__qr-empty">QR unavailable</span>}
                </div>

                <p className="sell-page__qr-hint">
                  Tip: Print this after checkout or have customers scan it directly at the
                  counter.
                </p>
              </div>
            </div>
          )}

          <div className="sell-page__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setCart([])
                setAmountPaidInput('')
                setDiscountInput('')
                setTaxInput('')
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
              {isSaving ? 'Saving…' : 'Record sale'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
