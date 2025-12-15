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
  setDoc,
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
  EncodeHintType,
  NotFoundException,
  QRCodeDecoderErrorCorrectionLevel,
} from '@zxing/library'
import { useKeyboardScanner } from '../components/BarcodeScanner'

import {
  PaymentMethod,
  buildReceiptPdf,
  type ReceiptLine,
  type ReceiptPayload,
  type ReceiptTender,
} from '../utils/receipt'

type ItemType = 'product' | 'service'

type Product = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  price: number | null
  taxRate?: number | null
  itemType: ItemType
  manufacturerName?: string | null
  productionDate?: Date | null
  batchNumber?: string | null
  expiryDate?: Date | null
  showOnReceipt?: boolean
}

type CartLine = {
  productId: string
  name: string
  qty: number
  price: number
  taxRate: number
  itemType: ItemType
  metadata?: string[]
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

function toDate(value: unknown): Date | null {
  if (!value) return null
  try {
    if (typeof (value as any).toDate === 'function') {
      const d: Date = (value as any).toDate()
      return Number.isNaN(d.getTime()) ? null : d
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  } catch {
    return null
  }
  return null
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
    price: typeof data.price === 'number' && Number.isFinite(data.price) ? data.price : null,
    taxRate: typeof data.taxRate === 'number' && Number.isFinite(data.taxRate) ? data.taxRate : null,
    itemType: data.itemType === 'service' ? 'service' : 'product',
    manufacturerName:
      typeof data.manufacturerName === 'string' && data.manufacturerName.trim()
        ? data.manufacturerName.trim()
        : null,
    productionDate: toDate(data.productionDate),
    batchNumber:
      typeof data.batchNumber === 'string' && data.batchNumber.trim() ? data.batchNumber.trim() : null,
    expiryDate: toDate(data.expiryDate),
    showOnReceipt: data.showOnReceipt === true,
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'GHS 0.00'
  return `GHS ${amount.toFixed(2)}`
}

function formatMetadataDate(value: Date | null | undefined): string | null {
  if (!value) return null
  const label = value.toLocaleDateString()
  return label || null
}

function buildProductMetadata(product: Product): string[] {
  if (!product.showOnReceipt) return []
  const metadata: string[] = []
  if (product.manufacturerName) metadata.push(`Manufacturer: ${product.manufacturerName}`)
  const producedOn = formatMetadataDate(product.productionDate)
  if (producedOn) metadata.push(`Produced: ${producedOn}`)
  if (product.batchNumber) metadata.push(`Batch: ${product.batchNumber}`)
  const expiresOn = formatMetadataDate(product.expiryDate)
  if (expiresOn) metadata.push(`Expires: ${expiresOn}`)
  return metadata
}

function createTenderId() {
  return Math.random().toString(36).slice(2, 10)
}

/** ✅ iOS/iPadOS detection (for Share Sheet button label + behavior) */
function isIOSLike() {
  const ua = navigator.userAgent || ''
  const iOS = /iPad|iPhone|iPod/i.test(ua)
  const iPadOS13Plus = ua.includes('Mac') && 'ontouchend' in document
  return iOS || iPadOS13Plus
}

/**
 * ✅ Smoothest flow on iOS/iPadOS:
 * - Prefer Share Sheet (Save to Files, WhatsApp, etc.)
 * - Fallback: open PDF in a viewer tab
 */
async function downloadOrSharePdf(fileName: string, blobUrl: string, shareText?: string) {
  const blob = await fetch(blobUrl).then(r => r.blob())
  const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
  const file = new File([pdfBlob], fileName, { type: 'application/pdf' })

  const navAny = navigator as any
  const canShareFiles = typeof navAny?.canShare === 'function' && navAny.canShare({ files: [file] })

  if (canShareFiles && typeof navAny?.share === 'function') {
    await navAny.share({
      title: 'Sale receipt',
      text: shareText ?? 'Sale receipt PDF',
      files: [file],
    })
    return
  }

  const tmpUrl = URL.createObjectURL(pdfBlob)
  window.open(tmpUrl, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(tmpUrl), 15000)
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
  const [additionalTenders, setAdditionalTenders] = useState<{ id: string; method: PaymentMethod; amount: string }[]>([])
  const [discountInput, setDiscountInput] = useState('')
  const [taxInput, setTaxInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const activityActor = user?.displayName || user?.email || 'Team member'

  const [scanInput, setScanInput] = useState('')
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null)

  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraStatusMessage, setCameraStatusMessage] = useState('')
  const [lastCameraScanAt, setLastCameraScanAt] = useState<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null)
  const appliedCustomerFromParams = useRef<string | null>(null)

  const [customerMode, setCustomerMode] = useState<CustomerMode>('walk_in')
  const [customerNameInput, setCustomerNameInput] = useState('')
  const [customerPhoneInput, setCustomerPhoneInput] = useState('')
  const [customerSearchTerm, setCustomerSearchTerm] = useState('')
  const [allCustomers, setAllCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  const [lastReceipt, setLastReceipt] = useState<ReceiptPayload | null>(null)

  const [receiptDownload, setReceiptDownload] = useState<{
    url: string | null
    fileName: string
    shareText: string
    shareUrl: string
  } | null>(null)

  const [receiptQrSvg, setReceiptQrSvg] = useState<string | null>(null)

  function extractStoreName(data: any): string | null {
    const candidates = [data?.company, data?.name, data?.companyName, data?.storeName, data?.businessName]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    return null
  }

  function withCollectionPath<T extends object>(ref: T | null, path: string) {
    if (!ref) return ref
    if (!(ref as any).collection) {
      try {
        ;(ref as any).collection = { path }
      } catch {}
    }
    return ref
  }
  useEffect(() => {
    if (!activeStoreId) {
      setStoreName(null)
      return
    }

    const refs = [
      withCollectionPath(doc(db, 'stores', activeStoreId), 'stores'),
      withCollectionPath(doc(db, 'workspaces', activeStoreId), 'workspaces'),
    ].filter(Boolean) as Array<ReturnType<typeof doc>>

    const unsubscribers = refs.map(ref =>
      onSnapshot(
        ref,
        snapshot => {
          const data = typeof (snapshot as any).data === 'function' ? snapshot.data() : null
          const name = extractStoreName(data)
          setStoreName(prev => (name ? name : prev ?? null))
        },
        () => setStoreName(prev => prev ?? null),
      ),
    )

    return () => unsubscribers.forEach(unsub => unsub())
  }, [activeStoreId])

  useEffect(() => {
    let cancelled = false
    if (!activeStoreId) {
      setProducts([])
      return () => {
        cancelled = true
      }
    }

    loadCachedProducts<Product>({ storeId: activeStoreId })
      .then(cached => {
        if (cancelled || !cached.length) return
        setProducts(
          cached
            .map((item, index) => mapFirestoreProduct((item as any).id ?? `cached-${index}`, item as any))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
        )
      })
      .catch(err => console.warn('[sell] Failed to load cached products', err))

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('name', 'asc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsub = onSnapshot(q, snap => {
      const rows: Product[] = snap.docs.map(d => mapFirestoreProduct(d.id, d.data()))
      saveCachedProducts(rows.map(r => ({ ...r, id: undefined as any })), { storeId: activeStoreId }).catch(err =>
        console.warn('[sell] Failed to cache products', err),
      )
      setProducts(rows)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [activeStoreId])

  useEffect(() => {
    if (!lastReceipt) return

    if (receiptDownload?.url) URL.revokeObjectURL(receiptDownload.url)

    const built = buildReceiptPdf(lastReceipt)
    const shareUrl = `${window.location.origin}/receipt/${encodeURIComponent(lastReceipt.saleId)}`
    const shareText = `Sale receipt${lastReceipt.companyName ? ` - ${lastReceipt.companyName}` : ''}\nView receipt: ${shareUrl}`

    setReceiptDownload({
      url: built?.url ?? null,
      fileName: built?.fileName ?? `${lastReceipt.saleId}.pdf`,
      shareText,
      shareUrl,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReceipt])

  useEffect(() => {
    if (!receiptDownload?.shareUrl) {
      setReceiptQrSvg(null)
      return
    }

    try {
      const writer = new BrowserQRCodeSvgWriter()
      const encodeHints = new Map<EncodeHintType, unknown>()
      encodeHints.set(EncodeHintType.MARGIN, 2)
      encodeHints.set(EncodeHintType.ERROR_CORRECTION, QRCodeDecoderErrorCorrectionLevel.H)

      const svg = writer.write(receiptDownload.shareUrl, 220, 220, encodeHints)
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-label', 'Receipt QR code')
      svg.setAttribute('width', '220')
      svg.setAttribute('height', '220')
      svg.setAttribute('viewBox', '0 0 220 220')
      setReceiptQrSvg(svg.outerHTML)
    } catch (error) {
      console.warn('[sell] Failed to build receipt QR code', error)
      setReceiptQrSvg(null)
    }
  }, [receiptDownload])

  useEffect(() => {
    return () => {
      if (receiptDownload?.url) URL.revokeObjectURL(receiptDownload.url)
    }
  }, [receiptDownload])

  useEffect(() => {
    let cancelled = false
    if (!activeStoreId) {
      setAllCustomers([])
      return () => {
        cancelled = true
      }
    }

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
      .catch(err => console.warn('[sell] Failed to load cached customers', err))

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
          phone: typeof data.phone === 'string' ? data.phone : null,
          email: typeof data.email === 'string' ? data.email : undefined,
        }
      })

      saveCachedCustomers(rows.map(r => ({ ...r, id: undefined as any })), { storeId: activeStoreId }).catch(err =>
        console.warn('[sell] Failed to cache customers', err),
      )

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

  function handleSelectCustomer(customer: Customer) {
    setCustomerMode('named')
    setSelectedCustomerId(customer.id)
    setCustomerNameInput(customer.name)
    setCustomerPhoneInput(customer.phone ?? '')
    setCustomerSearchTerm(customer.name)
  }

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
    return { subTotal: sub, autoTaxTotal: tax }
  }, [cart])

  const { effectiveTaxTotal, taxError } = useMemo(() => {
    const input = taxInput.trim()
    if (!input) return { effectiveTaxTotal: autoTaxTotal, taxError: null as string | null }

    let amount = 0
    let error: string | null = null

    if (input.endsWith('%')) {
      const num = Number(input.slice(0, -1).trim())
      if (!Number.isFinite(num) || num < 0) error = 'Enter a valid percentage (e.g. 7.5%)'
      else amount = subTotal * (num / 100)
    } else {
      const num = Number(input)
      if (!Number.isFinite(num) || num < 0) error = 'Enter a valid VAT amount or percent'
      else amount = num
    }

    return { effectiveTaxTotal: Number.isFinite(amount) ? amount : autoTaxTotal, taxError: error }
  }, [autoTaxTotal, subTotal, taxInput])

  const grossTotal = useMemo(() => subTotal + effectiveTaxTotal, [effectiveTaxTotal, subTotal])

  const { discountAmount, discountError, totalAfterDiscount } = useMemo(() => {
    const input = discountInput.trim()
    if (!input) return { discountAmount: 0, discountError: null as string | null, totalAfterDiscount: grossTotal }

    let amount = 0
    let error: string | null = null

    if (input.endsWith('%')) {
      const num = Number(input.slice(0, -1).trim())
      if (!Number.isFinite(num) || num < 0) error = 'Enter a valid percentage (e.g. 5 or 7.5)'
      else amount = grossTotal * (num / 100)
    } else {
      const num = Number(input)
      if (!Number.isFinite(num) || num < 0) error = 'Enter a valid amount or percentage'
      else amount = num
    }

    if (amount > grossTotal) amount = grossTotal
    const finalTotal = Math.max(0, grossTotal - amount)
    return { discountAmount: amount, discountError: error, totalAfterDiscount: finalTotal }
  }, [discountInput, grossTotal])

  const primaryAmountPaid = useMemo(() => {
    const raw = Number(amountPaidInput)
    if (!Number.isFinite(raw) || raw < 0) return 0
    return raw
  }, [amountPaidInput])

  const additionalAmountPaid = useMemo(
    () =>
      additionalTenders.reduce((sum, tender) => {
        const parsed = Number(tender.amount)
        if (!Number.isFinite(parsed) || parsed < 0) return sum
        return sum + parsed
      }, 0),
    [additionalTenders],
  )

  const totalAmountPaid = useMemo(() => primaryAmountPaid + additionalAmountPaid, [additionalAmountPaid, primaryAmountPaid])

  const changeDue = useMemo(() => {
    const diff = totalAmountPaid - totalAfterDiscount
    if (!Number.isFinite(diff)) return 0
    return diff > 0 ? diff : 0
  }, [totalAfterDiscount, totalAmountPaid])

  const isShortPayment = useMemo(() => {
    if (totalAmountPaid <= 0) return false
    return totalAmountPaid < totalAfterDiscount
  }, [totalAfterDiscount, totalAmountPaid])

  function handleAddTender() {
    setAdditionalTenders(current => [...current, { id: createTenderId(), method: 'cash', amount: '' }])
  }

  function handleTenderChange(id: string, updates: Partial<{ method: PaymentMethod; amount: string }>) {
    setAdditionalTenders(current => current.map(t => (t.id === id ? { ...t, ...updates } : t)))
  }

  function handleTenderRemove(id: string) {
    setAdditionalTenders(current => current.filter(t => t.id !== id))
  }

  function handleScanFromDecodedText(rawText: string, source: 'manual' | 'camera' | 'keyboard' = 'manual') {
    const normalized = normalizeBarcode(rawText)
    if (!normalized) {
      setScanStatus({ type: 'error', message: 'No barcode detected. Try scanning again.' })
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
      message: source === 'keyboard' ? `Added "${found.name}" via the scanner.` : `Added "${found.name}" to the cart.`,
    })
  }

  function handleScanSubmit(event: React.FormEvent) {
    event.preventDefault()
    setScanStatus(null)

    const normalized = normalizeBarcode(scanInput)
    if (!normalized) {
      setScanStatus({ type: 'error', message: 'No barcode detected. Try scanning again.' })
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
    message => setScanStatus({ type: 'error', message }),
  )
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
    setCameraStatusMessage('Opening camera… If this stays here, check that you allowed camera access.')

    let cancelled = false

    ;(async () => {
      try {
        let deviceId: string | undefined
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const videoDevices = devices.filter(d => d.kind === 'videoinput')
          if (videoDevices.length > 0) {
            const backCamera = videoDevices.find(d => /back|rear|environment/i.test(d.label || '')) || videoDevices[0]
            deviceId = backCamera.deviceId
          }
        }

        const controls = await reader.decodeFromVideoDevice(deviceId, videoRef.current!, (result, error) => {
          if (cancelled) return

          setIsCameraReady(true)
          setCameraStatusMessage('Camera is on. Center the barcode in the guide box and hold steady.')

          if (result) {
            setLastCameraScanAt(Date.now())
            const text = result.getText()
            if (text) handleScanFromDecodedText(text, 'camera')
          }

          if (error && !(error instanceof NotFoundException)) console.error('[sell] camera decode error', error)
        })

        scannerControlsRef.current = controls
      } catch (err: any) {
        console.error('[sell] camera init error', err)
        if (!cancelled) {
          setCameraError('We could not access your camera. Check permissions and try again.')
          setCameraStatusMessage('Camera access failed. Enter the code manually instead.')
          setIsCameraOpen(false)
        }
      }
    })()

    return () => {
      cancelled = true
      scannerControlsRef.current?.stop()
      scannerControlsRef.current = null
    }
  }, [isCameraOpen, products])

  function handleCloseCameraClick() {
    setIsCameraOpen(false)
    scannerControlsRef.current?.stop()
    scannerControlsRef.current = null
  }

  function addProductToCart(product: Product, qty: number = 1) {
    if (!product.price || product.price < 0) {
      setScanStatus({ type: 'error', message: `This item has no price. Set a price on the Products page first.` })
      return
    }

    setCart(prev => {
      const existingIndex = prev.findIndex(line => line.productId === product.id)
      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = { ...next[existingIndex], qty: next[existingIndex].qty + qty }
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
          metadata: buildProductMetadata(product),
        },
      ]
    })
  }

  function updateCartQty(productId: string, qty: number) {
    setCart(prev =>
      prev.map(line => (line.productId === productId ? { ...line, qty } : line)).filter(line => line.qty > 0),
    )
  }

  function removeCartLine(productId: string) {
    setCart(prev => prev.filter(line => line.productId !== productId))
  }

  function buildActivitySummary(items: CartLine[]) {
    if (!items.length) return 'Recorded sale'
    const labels = items.map(item => {
      const product = products.find(p => p.id === item.productId)
      const typeLabel =
        item.itemType === 'service' ? 'service' : product?.itemType === 'service' ? 'service' : 'product'
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
    tenders?: ReceiptTender[]
    receipt: ReceiptPayload
  }) {
    if (!activeStoreId) return
    try {
      const itemCount = options.items.reduce((sum, item) => sum + (item.qty || 0), 0)
      const summary = buildActivitySummary(options.items)
      const paymentLabel =
        options.tenders && options.tenders.length > 1
          ? options.tenders.map(tender => `${tender.method.replace('_', ' ')} ${formatCurrency(tender.amount)}`).join(' + ')
          : options.paymentMethod.replace('_', ' ')
      const detail = [`${itemCount || options.items.length} item${itemCount === 1 ? '' : 's'}`, `Total ${formatCurrency(options.total)}`, `Payment ${paymentLabel}`, `ID ${options.saleId}`].join(' · ')

      await addDoc(collection(db, 'activity'), {
        storeId: activeStoreId,
        type: 'sale',
        summary,
        detail,
        actor: activityActor,
        createdAt: serverTimestamp(),
        receipt: options.receipt,
      })
    } catch (error) {
      console.warn('[activity] Failed to log sale activity', error)
    }
  }

  /** ✅ UPDATED: Print via iframe for ALL devices (no blank tab on iPhone) */
  function printReceipt(options: {
    saleId: string
    items: { name: string; qty: number; price: number; metadata?: string[] }[]
    totals: { subTotal: number; taxTotal: number; discount: number; total: number }
    paymentMethod: PaymentMethod
    tenders?: ReceiptTender[]
    discountInput: string
    companyName?: string | null
    customerName?: string | null
    customerPhone?: string | null
  }) {
    const receiptDate = new Date().toLocaleString()
    const paymentLabel =
      options.tenders && options.tenders.length > 1
        ? options.tenders.map(t => `${t.method.replace('_', ' ')} (${formatCurrency(t.amount)})`).join(' + ')
        : options.paymentMethod.replace('_', ' ')

    const customerLine =
      options.customerName || options.customerPhone
        ? `Customer: ${options.customerName ?? 'Walk-in'}${options.customerPhone ? ` (${options.customerPhone})` : ''}`
        : null

    const lineRows = options.items
      .map(line => {
        const total = line.price * line.qty
        const metadataRows = (line.metadata ?? []).map(entry => `<tr class="meta-row"><td colspan="4">${entry}</td></tr>`).join('')
        return `<tr>
          <td>${line.name}</td>
          <td style="text-align:right">${line.qty}</td>
          <td style="text-align:right">${formatCurrency(line.price)}</td>
          <td style="text-align:right">${formatCurrency(total)}</td>
        </tr>${metadataRows}`
      })
      .join('')

    const receiptHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: 80mm auto; margin: 8mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      padding: 8px;
      color: #0f172a;
      width: 64mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h1 { font-size: 18px; margin: 0 0 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 6px 4px; font-size: 13px; }
    th { text-align: left; border-bottom: 1px solid #e2e8f0; }
    tfoot td { font-weight: 700; border-top: 1px solid #e2e8f0; }
    .meta { font-size: 12px; color: #475569; margin: 0; }
    .meta-row td { font-size: 12px; color: #475569; padding-top: 0; }
  </style>
</head>
<body>
  <h1>Sale receipt</h1>
  ${options.companyName ? `<p class="meta"><strong>${options.companyName}</strong></p>` : ''}
  <p class="meta">Sale ID: ${options.saleId}</p>
  <p class="meta">${receiptDate}</p>
  <p class="meta">Payment: ${paymentLabel}</p>
  ${customerLine ? `<p class="meta">${customerLine}</p>` : ''}

  <table>
    <thead>
      <tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr>
    </thead>
    <tbody>${lineRows}</tbody>
    <tfoot>
      <tr><td colspan="3">Subtotal</td><td style="text-align:right">${formatCurrency(options.totals.subTotal)}</td></tr>
      <tr><td colspan="3">VAT / Tax</td><td style="text-align:right">${formatCurrency(options.totals.taxTotal)}</td></tr>
      <tr><td colspan="3">Discount</td><td style="text-align:right">${options.discountInput ? options.discountInput : 'None'}</td></tr>
      <tr><td colspan="3">Total</td><td style="text-align:right">${formatCurrency(options.totals.total)}</td></tr>
      <tr><td colspan="3">Payment</td><td style="text-align:right">${paymentLabel}</td></tr>
    </tfoot>
  </table>
</body>
</html>`

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '1px'
    iframe.style.height = '1px'
    iframe.style.opacity = '0'
    iframe.style.pointerEvents = 'none'
    iframe.style.border = '0'
    iframe.srcdoc = receiptHtml
    document.body.appendChild(iframe)

    const cleanup = () => {
      try {
        document.body.removeChild(iframe)
      } catch {}
    }

    iframe.onload = () => {
      setTimeout(() => {
        const w = iframe.contentWindow
        if (!w) return cleanup()
        try {
          w.focus()
          w.print()
        } catch {
          cleanup()
          return
        }
        try {
          w.addEventListener('afterprint', cleanup, { once: true })
        } catch {}
        setTimeout(cleanup, 2000)
      }, 150)
    }
  }

  async function handleCommitSale() {
    setErrorMessage(null)
    setSuccessMessage(null)
    setScanStatus(null)

    if (!activeStoreId) return setErrorMessage('Select a workspace before recording a sale.')
    if (!cart.length) return setErrorMessage('Add at least one item to the cart.')
    if (taxError) return setErrorMessage('Please fix the VAT field before saving.')
    if (discountError) return setErrorMessage('Please fix the discount field before saving.')
    if (customerMode === 'named' && !customerNameInput.trim()) return setErrorMessage('Enter or choose a customer name.')

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

      const totals = { subTotal, taxTotal: effectiveTaxTotal, discount: discountAmount, total: totalAfterDiscount }

      const amountPaidValue = totalAmountPaid > 0 ? totalAmountPaid : totalAfterDiscount
      const changeDueValue = Math.max(0, amountPaidValue - totalAfterDiscount)

      const parsedAdditionalTenders: ReceiptTender[] = additionalTenders
        .map(t => ({ method: t.method, amount: Number(t.amount) }))
        .filter(t => Number.isFinite(t.amount) && t.amount > 0)

      const primaryTenderAmount = totalAmountPaid > 0 && primaryAmountPaid > 0 ? primaryAmountPaid : 0

      const tenders: ReceiptTender[] =
        totalAmountPaid > 0
          ? [
              ...(primaryTenderAmount > 0 ? [{ method: paymentMethod, amount: primaryTenderAmount }] : []),
              ...parsedAdditionalTenders,
            ]
          : [{ method: paymentMethod, amount: totalAfterDiscount }]

      const primaryPaymentMethod = tenders[0]?.method ?? paymentMethod

      const payment = {
        method: primaryPaymentMethod,
        amountPaid: amountPaidValue,
        changeDue: changeDueValue,
        tenders,
      }

      const trimmedCustomerName = customerNameInput.trim()
      const customerName = customerMode === 'named' ? trimmedCustomerName : trimmedCustomerName || 'Walk-in'
      const customerPhone = customerPhoneInput.trim() || null
      const customerPayload =
        customerMode === 'walk_in'
          ? null
          : {
              id: selectedCustomerId,
              name: customerName,
              phone: customerPhone,
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
        metadata: line.metadata?.length ? [...line.metadata] : undefined,
      }))

      const receiptPayload: ReceiptPayload = {
        saleId,
        items: receiptItems,
        totals,
        paymentMethod: primaryPaymentMethod,
        tenders,
        discountInput,
        companyName: storeName,
        customerName,
        customerPhone,
      } as any

      await setDoc(doc(db, 'receipts', saleId), {
        ...receiptPayload,
        storeId: activeStoreId,
        createdAt: serverTimestamp(),
      })

      printReceipt({
        saleId,
        items: cartSnapshot,
        totals,
        paymentMethod: primaryPaymentMethod,
        tenders,
        discountInput,
        companyName: storeName,
        customerName,
        customerPhone,
      })

      setLastReceipt(receiptPayload)

      await logSaleActivity({
        saleId,
        total: totalAfterDiscount,
        items: cartSnapshot,
        paymentMethod: primaryPaymentMethod,
        tenders,
        receipt: receiptPayload,
      })

      setCart([])
      setAmountPaidInput('')
      setAdditionalTenders([])
      setDiscountInput('')
      setTaxInput('')
      setCustomerNameInput('')
      setCustomerPhoneInput('')
      setSelectedCustomerId(null)
      setSuccessMessage('Sale recorded successfully.')
    } catch (error: any) {
      console.error('[sell] Failed to commit sale', error)
      setErrorMessage(typeof error?.message === 'string' ? error.message : 'We could not save this sale. Please try again.')
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
            Scan barcodes with your camera or a scanner, build a cart, apply discount, pick the customer, then save the sale.
          </p>
        </div>
      </header>

      <div className="sell-page__grid">
        <section className="card sell-page__left">
          <div className="sell-page__section-header">
            <h3>Scan barcode</h3>
            <p>Use your phone camera or a USB barcode scanner. We match the code to the product SKU/barcode you saved.</p>
          </div>

          <form className="sell-page__scan-form" onSubmit={handleScanSubmit}>
            <label className="field">
              <span className="field__label">Barcode / SKU</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label="Scan or type a barcode"
                autoCorrect="off"
                autoCapitalize="off"
                placeholder="Tap here, then scan the product barcode"
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
              />
            </label>
            <button type="submit" className="button button--primary" aria-label="Add">
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

          <div className="sell-page__section-header" style={{ marginTop: 16 }}>
            <h3>Camera scanner (beta)</h3>
            <p>Opens your device camera and automatically adds items as you scan.</p>
          </div>

          {isCameraOpen ? (
            <div className="sell-page__camera-panel">
              <div className="sell-page__camera-viewport">
                <video ref={videoRef} className="sell-page__camera-preview" autoPlay muted playsInline />
                <div className="sell-page__camera-overlay" aria-hidden="true" />
              </div>
              <div className="sell-page__camera-actions">
                <button type="button" className="button button--ghost" onClick={handleCloseCameraClick}>
                  Close camera
                </button>
              </div>
              <p className={'sell-page__camera-hint ' + (isCameraReady ? '' : 'sell-page__camera-hint--idle')}>
                {cameraStatusMessage}
              </p>
              {cameraError && <p className="sell-page__camera-error">{cameraError}</p>}
            </div>
          ) : (
            <button type="button" className="button button--ghost" onClick={() => setIsCameraOpen(true)}>
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
            <input id="sell-search" placeholder="Type to search..." value={searchText} onChange={e => setSearchText(e.target.value)} />
          </div>

          <div className="sell-page__product-list">
            {filteredProducts.length ? (
              filteredProducts.map(p => {
                const isUnavailable = typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price <= 0
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
                        <span style={{ color: '#b91c1c', fontSize: 12 }}>Price unavailable – set price to sell</span>
                      ) : (
                        formatCurrency(p.price)
                      )}
                    </div>
                  </button>
                )
              })
            ) : (
              <p className="sell-page__empty-products">No products match this search.</p>
            )}
          </div>
        </section>

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
                            onChange={e => updateCartQty(line.productId, Math.max(1, Number(e.target.value) || 1))}
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
              <p className="sell-page__empty-cart">Cart is empty. Scan or select a product to begin.</p>
            )}
          </div>

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
                    className={'sell-page__input' + (taxError ? ' sell-page__input--error' : '')}
                    placeholder={`Auto: ${formatCurrency(autoTaxTotal)}`}
                    value={taxInput}
                    onChange={e => setTaxInput(e.target.value)}
                    style={{ maxWidth: 140 }}
                  />
                  {!taxInput && <div className="sell-page__totals-hint">Using VAT from the product setup.</div>}
                  {taxError && <div className="sell-page__totals-hint sell-page__totals-hint--error">{taxError}</div>}
                  {taxInput && !taxError && <div className="sell-page__totals-hint">Override total: {formatCurrency(effectiveTaxTotal)}</div>}
                </div>
              </div>

              <div className="sell-page__totals-row">
                <span>Discount</span>
                <div style={{ textAlign: 'right' }}>
                  <input
                    type="text"
                    className={'sell-page__input' + (discountError ? ' sell-page__input--error' : '')}
                    placeholder="e.g. 5 or 5%"
                    value={discountInput}
                    onChange={e => setDiscountInput(e.target.value)}
                    style={{ maxWidth: 140 }}
                  />
                  {discountAmount > 0 && !discountError && (
                    <div style={{ fontSize: 12, color: '#4b5563' }}>− {formatCurrency(discountAmount)}</div>
                  )}
                  {discountError && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>{discountError}</div>}
                </div>
              </div>

              <div className="sell-page__totals-row sell-page__totals-row--grand">
                <span>Total</span>
                <strong>{formatCurrency(totalAfterDiscount)}</strong>
              </div>
            </div>
          </div>

          <div className="sell-page__customer" aria-labelledby="sell-customer-heading">
            <div className="sell-page__customer-header">
              <span id="sell-customer-heading">Customer</span>
              <div className="sell-page__customer-mode" role="group" aria-label="Customer type">
                <button type="button" className={customerMode === 'walk_in' ? 'is-active' : ''} onClick={() => setCustomerMode('walk_in')}>
                  Walk-in
                </button>
                <button type="button" className={customerMode === 'named' ? 'is-active' : ''} onClick={() => setCustomerMode('named')}>
                  Existing customer
                </button>
              </div>
            </div>

            {customerMode === 'named' && (
              <div className="sell-page__customer-search">
                <label className="field">
                  <span className="field__label">Search customers</span>
                  <input
                    placeholder="Type a name or phone number"
                    value={customerSearchTerm}
                    onChange={e => {
                      setCustomerSearchTerm(e.target.value)
                      setSelectedCustomerId(null)
                    }}
                  />
                </label>

                <ul className="sell-page__customer-results">
                  {customerResults.length ? (
                    customerResults.map(customer => (
                      <li key={customer.id}>
                        <button
                          type="button"
                          className={selectedCustomerId === customer.id ? 'is-active' : ''}
                          onClick={() => handleSelectCustomer(customer)}
                        >
                          <span className="sell-page__customer-results-name">{customer.name}</span>
                          {(customer.phone || customer.email) && (
                            <span className="sell-page__customer-results-meta">
                              {[customer.phone, customer.email].filter(Boolean).join(' • ')}
                            </span>
                          )}
                        </button>
                      </li>
                    ))
                  ) : (
                    <li>
                      <p className="sell-page__customer-results-empty">No customers match this search.</p>
                    </li>
                  )}
                </ul>
              </div>
            )}

            <div className="sell-page__customer-details">
              <label className="field">
                <span className="field__label">
                  Customer name {customerMode === 'named' ? '(required)' : '(optional)'}
                </span>
                <input
                  placeholder={customerMode === 'named' ? 'Select or enter a customer name' : 'Enter name (optional)'}
                  value={customerNameInput}
                  onChange={e => {
                    setCustomerNameInput(e.target.value)
                    setSelectedCustomerId(null)
                  }}
                />
              </label>

              <label className="field">
                <span className="field__label">Customer phone (optional)</span>
                <input placeholder="Add a phone number for the receipt" value={customerPhoneInput} onChange={e => setCustomerPhoneInput(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="sell-page__payment" style={{ marginTop: 20 }}>
            <div className="field">
              <label className="field__label">Payment method</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile_money">Mobile money</option>
                <option value="transfer">Bank transfer</option>
              </select>
            </div>

            <div className="field">
              <label className="field__label">Amount paid (optional)</label>
              <input type="number" min="0" step="0.01" placeholder="If customer pays cash" value={amountPaidInput} onChange={e => setAmountPaidInput(e.target.value)} />
              {totalAmountPaid > 0 && (
                <p className={'sell-page__change ' + (isShortPayment ? 'is-short' : '')}>
                  {isShortPayment ? `Short by ${formatCurrency(totalAfterDiscount - totalAmountPaid)}` : `Change due: ${formatCurrency(changeDue)}`}
                </p>
              )}
            </div>

            <div className="sell-page__additional-payments">
              <div className="sell-page__additional-header">
                <span>Additional payment methods (optional)</span>
                <button type="button" className="button button--ghost" onClick={handleAddTender}>
                  Add method
                </button>
              </div>

              {additionalTenders.length === 0 ? (
                <p className="sell-page__additional-hint">Use this to record split payments such as part cash and part mobile money.</p>
              ) : (
                <ul className="sell-page__additional-list">
                  {additionalTenders.map(tender => (
                    <li key={tender.id} className="sell-page__additional-row">
                      <select value={tender.method} onChange={e => handleTenderChange(tender.id, { method: e.target.value as PaymentMethod })}>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="mobile_money">Mobile money</option>
                        <option value="transfer">Bank transfer</option>
                      </select>

                      <input type="number" min="0" step="0.01" placeholder="Amount" value={tender.amount} onChange={e => handleTenderChange(tender.id, { amount: e.target.value })} />

                      <button type="button" className="button button--ghost" onClick={() => handleTenderRemove(tender.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {errorMessage && <p className="sell-page__message sell-page__message--error">{errorMessage}</p>}
          {successMessage && <p className="sell-page__message sell-page__message--success">{successMessage}</p>}

          {receiptDownload && lastReceipt && (
            <div className="sell-page__receipt-actions" role="status">
              <div className="sell-page__receipt-actions-row">
                {receiptDownload.url ? (
                  isIOSLike() ? (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() =>
                        downloadOrSharePdf(receiptDownload.fileName, receiptDownload.url!, receiptDownload.shareText).catch(err =>
                          console.warn('PDF share failed', err),
                        )
                      }
                    >
                      Save / Share PDF
                    </button>
                  ) : (
                    <a href={receiptDownload.url} download={receiptDownload.fileName} className="button button--ghost">
                      Download PDF (this device)
                    </a>
                  )
                ) : (
                  <span className="sell-page__receipt-hint">Preparing receipt file…</span>
                )}

                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() =>
                    printReceipt({
                      saleId: lastReceipt.saleId,
                      items: lastReceipt.items,
                      totals: lastReceipt.totals,
                      paymentMethod: lastReceipt.paymentMethod,
                      tenders: (lastReceipt as any).tenders,
                      discountInput: lastReceipt.discountInput,
                      companyName: lastReceipt.companyName,
                      customerName: lastReceipt.customerName,
                      customerPhone: (lastReceipt as any).customerPhone ?? null,
                    })
                  }
                >
                  Print again
                </button>
              </div>

              <div className="sell-page__share-row">
                <span>Share receipt:</span>
                <a href={`https://wa.me/?text=${encodeURIComponent(receiptDownload.shareText)}`} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(receiptDownload.shareUrl)}&text=${encodeURIComponent(receiptDownload.shareText)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Telegram
                </a>
                <a href={`mailto:?subject=${encodeURIComponent('Sale receipt')}&body=${encodeURIComponent(`${receiptDownload.shareText}\n\nOpen: ${receiptDownload.shareUrl}`)}`}>
                  Email
                </a>
              </div>

              <div className="sell-page__qr">
                <div className="sell-page__qr-header">
                  <p className="sell-page__qr-title">Receipt QR</p>
                  <p className="sell-page__qr-subtitle">Scan on a customer phone or second device to open the receipt link quickly.</p>
                </div>

                {receiptQrSvg ? (
                  <div className="sell-page__qr-code" dangerouslySetInnerHTML={{ __html: receiptQrSvg }} aria-hidden={!receiptQrSvg} />
                ) : (
                  <div className="sell-page__qr-code">
                    <span className="sell-page__qr-empty">QR unavailable</span>
                  </div>
                )}

                <p className="sell-page__qr-hint">Tip: Print this after checkout or have customers scan it directly at the counter.</p>
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

            <button type="button" className="button button--primary" onClick={handleCommitSale} disabled={isSaving || !cart.length}>
              {isSaving ? 'Saving…' : 'Record sale'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
