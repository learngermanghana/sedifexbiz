import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  where,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'
import { db, functions as cloudFunctions } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus'
import './Sell.css'
import { Link } from 'react-router-dom'
import { queueCallableRequest } from '../utils/offlineQueue'
import BarcodeScanner, { ScanResult } from '../components/BarcodeScanner'
import {
  CUSTOMER_CACHE_LIMIT,
  PRODUCT_CACHE_LIMIT,
  loadCachedCustomers,
  loadCachedProducts,
  saveCachedCustomers,
  saveCachedProducts,
} from '../utils/offlineCache'
import { buildSimplePdf } from '../utils/pdf'
import { ensureCustomerLoyalty } from '../utils/customerLoyalty'
import { payWithPaystack } from '../lib/paystack'

type Product = {
  id: string
  name: string
  price: number | null
  taxRate?: number | null
  sku?: string | null
  stockCount?: number
  createdAt?: unknown
  updatedAt?: unknown
  itemType?: 'product' | 'service'
}

type CartLine = {
  productId: string
  name: string
  price: number
  qty: number
  taxRate?: number
}

type Customer = {
  id: string
  name: string
  displayName?: string
  phone?: string
  email?: string
  notes?: string
  loyalty?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

type StoreProfile = {
  id: string
  name: string | null
  displayName: string | null
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
}

type Payment = {
  method: string
  amountPaid: number
  changeDue: number
  provider?: string
  providerRef?: string | null
  status?: string | null
}

type ReceiptData = {
  saleId: string
  createdAt: Date
  items: CartLine[]
  subtotal: number
  loyaltyEarned?: number | null
  currentPoints?: number | null
  store?: {
    id: string | null
    name: string | null
    email: string | null
    phone: string | null
    addressLines: string[]
  }
  payment: Payment
  customer?: {
    name: string
    phone?: string
    email?: string
  }
}

type ReceiptSharePayload = {
  message: string
  emailHref: string
  smsHref: string
  whatsappHref: string
  pdfBlob: Blob
  pdfUrl: string
  pdfFileName: string
}

type ShareChannel = 'email' | 'sms' | 'whatsapp'

type LogReceiptSharePayload = {
  storeId: string
  saleId: string
  channel: ShareChannel
  status: 'attempt' | 'failed'
  contact: string | null
  customerId?: string | null
  customerName?: string | null
  errorMessage?: string | null
}

type LogReceiptShareResponse = { ok: boolean; shareId: string }

type CommitSalePayload = {
  branchId: string | null
  saleId: string
  cashierId: string
  customerId?: string | null
  loyaltyEarned?: number | null
  currentPoints?: number | null
  totals: {
    total: number
    taxTotal: number
  }
  payment: Payment
  customer?: {
    id?: string
    name: string
    phone?: string
    email?: string
  }
  items: Array<{
    productId: string
    name: string
    price: number
    qty: number
    taxRate?: number
  }>
}

type CommitSaleResponse = {
  ok: boolean
  saleId: string
}

/**
 * A single in-progress sale (one “cart tab”).
 */
type SaleDraft = {
  id: string
  cart: CartLine[]
  selectedCustomerId: string
  paymentMethod: 'cash' | 'paystack'
  amountTendered: string
  loyaltyEarnedInput: string
  loyaltyAppliedInput: string
}

function getCustomerPrimaryName(customer: Pick<Customer, 'displayName' | 'name'>): string {
  const displayName = customer.displayName?.trim()
  if (displayName) return displayName
  const legacyName = customer.name?.trim()
  if (legacyName) return legacyName
  return ''
}

function getCustomerFallbackContact(customer: Pick<Customer, 'email' | 'phone'>): string {
  const email = customer.email?.trim()
  if (email) return email
  const phone = customer.phone?.trim()
  if (phone) return phone
  return ''
}

function getCustomerSortKey(
  customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>,
): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) return primary
  return getCustomerFallbackContact(customer)
}

function getCustomerDisplayName(
  customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>,
): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) return primary
  const fallback = getCustomerFallbackContact(customer)
  if (fallback) return fallback
  return '—'
}

function getCustomerNameForData(
  customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>,
): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) return primary
  return getCustomerFallbackContact(customer)
}

function isOfflineError(error: unknown) {
  if (!navigator.onLine) return true
  if (error instanceof FirebaseError) {
    const code = (error.code || '').toLowerCase()
    return (
      code === 'unavailable' ||
      code === 'internal' ||
      code.endsWith('/unavailable') ||
      code.endsWith('/internal')
    )
  }
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase()
    return message.includes('network') || message.includes('fetch')
  }
  return false
}

function sanitizePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  return null
}

function sanitizeTaxRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  return null
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function mapStoreProfile(
  id: string,
  data: Record<string, unknown> | undefined,
): StoreProfile {
  const safeData = data || {}

  return {
    id,
    name: toNullableString(safeData.name),
    displayName: toNullableString(safeData.displayName),
    email: toNullableString(safeData.email),
    phone: toNullableString(safeData.phone),
    addressLine1: toNullableString(safeData.addressLine1),
    addressLine2: toNullableString(safeData.addressLine2),
    city: toNullableString(safeData.city),
    region: toNullableString(safeData.region),
    postalCode: toNullableString(safeData.postalCode),
    country: toNullableString(safeData.country),
  }
}

function buildReceiptStore(
  storeProfile: StoreProfile | null,
  activeStoreId: string | null,
): ReceiptData['store'] {
  const addressLines: string[] = []
  if (storeProfile?.addressLine1) addressLines.push(storeProfile.addressLine1)
  if (storeProfile?.addressLine2) addressLines.push(storeProfile.addressLine2)

  const cityParts = [storeProfile?.city, storeProfile?.region]
    .filter(Boolean)
    .map(part => part as string)
  if (cityParts.length) {
    addressLines.push(cityParts.join(', '))
  }

  const countryParts = [storeProfile?.postalCode, storeProfile?.country]
    .filter(Boolean)
    .map(part => part as string)
  if (countryParts.length) {
    addressLines.push(countryParts.join(' '))
  }

  return {
    id: storeProfile?.id ?? activeStoreId ?? null,
    name: storeProfile?.displayName ?? storeProfile?.name ?? null,
    email: storeProfile?.email ?? null,
    phone: storeProfile?.phone ?? null,
    addressLines,
  }
}

/**
 * Helpers for SaleDrafts
 */
function createEmptyDraft(id: string): SaleDraft {
  return {
    id,
    cart: [],
    selectedCustomerId: '',
    paymentMethod: 'cash',
    amountTendered: '',
    loyaltyEarnedInput: '',
    loyaltyAppliedInput: '',
  }
}

export default function Sell() {
  const user = useAuthUser()
  const { storeId: activeStoreId } = useActiveStore()
  const { isInactive: isSubscriptionInactive } = useSubscriptionStatus()

  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [queryText, setQueryText] = useState('')

  // Multi-sale support: multiple drafts & active draft
  const [saleDrafts, setSaleDrafts] = useState<SaleDraft[]>(() => [createEmptyDraft('draft-0')])
  const [activeDraftId, setActiveDraftId] = useState<string>('draft-0')

  const [saleError, setSaleError] = useState<string | null>(null)
  const [saleSuccess, setSaleSuccess] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [scannerStatus, setScannerStatus] = useState<{
    tone: 'success' | 'error'
    message: string
  } | null>(null)
  const [storeProfile, setStoreProfile] = useState<StoreProfile | null>(null)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [receiptSharePayload, setReceiptSharePayload] =
    useState<ReceiptSharePayload | null>(null)

  const activeDraft = useMemo(
    () => saleDrafts.find(d => d.id === activeDraftId) ?? saleDrafts[0],
    [saleDrafts, activeDraftId],
  )

  const updateActiveDraft = useCallback(
    (updater: (draft: SaleDraft) => SaleDraft) => {
      setSaleDrafts(drafts =>
        drafts.map(d => (d.id === activeDraftId ? updater(d) : d)),
      )
    },
    [activeDraftId],
  )

  // Aliases so rest of logic still uses simple names
  const cart = activeDraft?.cart ?? []
  const selectedCustomerId = activeDraft?.selectedCustomerId ?? ''
  const paymentMethod = activeDraft?.paymentMethod ?? 'cash'
  const amountTendered = activeDraft?.amountTendered ?? ''
  const loyaltyEarnedInput = activeDraft?.loyaltyEarnedInput ?? ''
  const loyaltyAppliedInput = activeDraft?.loyaltyAppliedInput ?? ''

  const canShareReceipt =
    Boolean(receiptSharePayload) && (typeof navigator === 'undefined' || navigator.onLine)

  // Subtotal (no VAT yet)
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0)

  // VAT amount (tax total)
  const cartTaxTotal = useMemo(
    () =>
      cart.reduce(
        (sum, line) => sum + (line.taxRate ?? 0) * line.price * line.qty,
        0,
      ),
    [cart],
  )

  // Grand total (Amount due = subtotal + VAT)
  const totalDue = subtotal + cartTaxTotal

  const totalQty = cart.reduce((s, l) => s + l.qty, 0)

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId)
  const selectedCustomerLoyalty = useMemo(
    () => (selectedCustomer ? ensureCustomerLoyalty(selectedCustomer).loyalty : null),
    [selectedCustomer],
  )

  const selectedCustomerDataName = selectedCustomer
    ? getCustomerNameForData(selectedCustomer)
    : ''

  const loyaltyEarned = useMemo(() => {
    const parsed = Number(loyaltyEarnedInput)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }, [loyaltyEarnedInput])

  const loyaltyApplied = useMemo(() => {
    const parsed = Number(loyaltyAppliedInput)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    const available = selectedCustomerLoyalty?.points ?? 0
    return Math.min(parsed, available)
  }, [loyaltyAppliedInput, selectedCustomerLoyalty?.points])

  const loyaltyCurrentPoints = useMemo(() => {
    if (!selectedCustomer) return null
    const available = selectedCustomerLoyalty?.points ?? 0
    return Math.max(0, available - loyaltyApplied + loyaltyEarned)
  }, [loyaltyApplied, loyaltyEarned, selectedCustomer, selectedCustomerLoyalty?.points])

  const loyaltyBalanceAfterSale = selectedCustomer
    ? loyaltyCurrentPoints ?? selectedCustomerLoyalty?.points ?? 0
    : null

  // For cash, user enters amount. For Paystack, assume full totalDue is paid.
  const amountPaid = paymentMethod === 'cash' ? Number(amountTendered || 0) : totalDue
  const changeDue = Math.max(0, amountPaid - totalDue)
  const isCashShort =
    paymentMethod === 'cash' && amountPaid < totalDue && totalDue > 0
  const paymentMethodLabel = paymentMethod === 'paystack' ? 'card/mobile' : paymentMethod

  const receiptStore = useMemo(
    () => buildReceiptStore(storeProfile, activeStoreId),
    [activeStoreId, storeProfile],
  )

  const logReceiptShare = useMemo(
    () =>
      httpsCallable<LogReceiptSharePayload, LogReceiptShareResponse>(
        cloudFunctions,
        'logReceiptShare',
      ),
    [],
  )

  // ---------- Store profile ----------
  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setStoreProfile(null)
      return () => {
        cancelled = true
      }
    }

    const ref = doc(db, 'stores', activeStoreId)
    getDoc(ref)
      .then(snapshot => {
        if (cancelled) return
        if (!snapshot.exists()) {
          setStoreProfile(null)
          return
        }

        setStoreProfile(mapStoreProfile(snapshot.id, snapshot.data() as Record<string, unknown>))
      })
      .catch(error => {
        if (cancelled) return
        console.error('[sell] Failed to load store profile', error)
        setStoreProfile(null)
      })

    return () => {
      cancelled = true
    }
  }, [activeStoreId])

  // ---------- Products (incl. services) ----------
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
        if (!cancelled && cached.length) {
          const sanitized = cached.map(item => ({
            ...(item as Product),
            price: sanitizePrice((item as Product).price),
            taxRate: sanitizeTaxRate((item as Product).taxRate),
          }))
          setProducts(
            sanitized.sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
            ),
          )
        }
      })
      .catch(error => {
        console.warn('[sell] Failed to load cached products', error)
      })

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
      }))
      const sanitizedRows = rows.map(row => ({
        ...(row as Product),
        price: sanitizePrice((row as Product).price),
        taxRate: sanitizeTaxRate((row as Product).taxRate),
      }))
      saveCachedProducts(sanitizedRows, { storeId: activeStoreId }).catch(error => {
        console.warn('[sell] Failed to cache products', error)
      })
      const sortedRows = [...sanitizedRows].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
      setProducts(sortedRows)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  // ---------- Customers ----------
  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setCustomers([])
      return () => {
        cancelled = true
      }
    }

    loadCachedCustomers<Customer>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          const normalized = cached.map(customer => ensureCustomerLoyalty(customer))
          setCustomers(
            [...normalized].sort((a, b) =>
              getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
                sensitivity: 'base',
              }),
            ),
          )
        }
      })
      .catch(error => {
        console.warn('[sell] Failed to load cached customers', error)
      })

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows = snap.docs.map(docSnap =>
        ensureCustomerLoyalty({ id: docSnap.id, ...(docSnap.data() as Customer) }),
      )
      saveCachedCustomers(rows, { storeId: activeStoreId }).catch(error => {
        console.warn('[sell] Failed to cache customers', error)
      })
      const sortedRows = [...rows].sort((a, b) =>
        getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
          sensitivity: 'base',
        }),
      )
      setCustomers(sortedRows)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  // ---------- Auto-print receipt ----------
  useEffect(() => {
    if (!receipt) return
    const timeout = window.setTimeout(() => {
      window.print()
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [receipt])

  // ---------- Build receipt share payload + PDF ----------
  useEffect(() => {
    if (!receipt) {
      setReceiptSharePayload(prev => {
        if (prev?.pdfUrl) {
          URL.revokeObjectURL(prev.pdfUrl)
        }
        return null
      })
      return
    }

    const receiptStoreInfo = receipt.store ?? buildReceiptStore(storeProfile, activeStoreId)
    const storeName = receiptStoreInfo?.name || 'Sedifex POS'
    const contactLine =
      receiptStoreInfo?.email || receiptStoreInfo?.phone || user?.email || 'sales@sedifex.app'

    const lines: string[] = []
    lines.push(storeName)
    receiptStoreInfo?.addressLines.forEach(line => lines.push(line))
    lines.push(contactLine)
    lines.push(receipt.createdAt.toLocaleString())

    if (receipt.customer) {
      lines.push('')
      lines.push('Customer:')
      lines.push(`  ${receipt.customer.name}`)
      if (receipt.customer.phone) {
        lines.push(`  ${receipt.customer.phone}`)
      }
      if (receipt.customer.email) {
        lines.push(`  ${receipt.customer.email}`)
      }
    }

    lines.push('')
    lines.push('Items:')
    const taxTotal = receipt.items.reduce(
      (sum, line) => sum + (line.taxRate ?? 0) * line.price * line.qty,
      0,
    )
    receipt.items.forEach(line => {
      const lineTotal = line.qty * line.price
      const lineTax = lineTotal * (line.taxRate ?? 0)
      const taxLabel = lineTax > 0 ? ` (Tax: GHS ${lineTax.toFixed(2)})` : ''
      lines.push(
        `  • ${line.qty} × ${line.name} — GHS ${lineTotal.toFixed(2)}${taxLabel}`,
      )
    })

    lines.push('')
    lines.push(`Subtotal: GHS ${receipt.subtotal.toFixed(2)}`)
    if (taxTotal > 0) {
      lines.push(`Tax: GHS ${taxTotal.toFixed(2)}`)
    }
    const totalWithTax = receipt.subtotal + taxTotal
    lines.push(`Total: GHS ${totalWithTax.toFixed(2)}`)
    lines.push(
      `Paid (${receipt.payment.method}): GHS ${receipt.payment.amountPaid.toFixed(2)}`,
    )
    lines.push(`Change: GHS ${receipt.payment.changeDue.toFixed(2)}`)

    if (typeof receipt.loyaltyEarned === 'number' && receipt.loyaltyEarned !== null) {
      lines.push(`Loyalty earned: ${receipt.loyaltyEarned} pts`)
    }
    if (typeof receipt.currentPoints === 'number' && receipt.currentPoints !== null) {
      lines.push(`Current points: ${receipt.currentPoints} pts`)
    }

    lines.push('')
    lines.push(`Sale #${receipt.saleId}`)
    lines.push('Thank you for shopping with us!')

    const message = lines.join('\n')
    const emailSubject = `Receipt for sale #${receipt.saleId}`

    const encodedSubject = encodeURIComponent(emailSubject)
    const encodedBody = encodeURIComponent(message)
    const emailHref = `mailto:${receipt.customer?.email ?? ''}?subject=${encodedSubject}&body=${encodedBody}`
    const smsHref = `sms:${receipt.customer?.phone ?? ''}?body=${encodedBody}`
    const whatsappHref = `https://wa.me/?text=${encodedBody}`

    const pdfLines = lines.slice(1) // drop duplicate title
    const pdfBytes = buildSimplePdf(storeName, pdfLines)
    const pdfBuffer = pdfBytes.slice().buffer
    const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' })
    const pdfUrl = URL.createObjectURL(pdfBlob)
    const pdfFileName = `receipt-${receipt.saleId}.pdf`

    setReceiptSharePayload(prev => {
      if (prev?.pdfUrl) {
        URL.revokeObjectURL(prev.pdfUrl)
      }
      return { message, emailHref, smsHref, whatsappHref, pdfBlob, pdfUrl, pdfFileName }
    })

    return () => {
      URL.revokeObjectURL(pdfUrl)
    }
  }, [activeStoreId, receipt, storeProfile, user?.email])

  const handleDownloadPdf = useCallback(() => {
    setReceiptSharePayload(prev => {
      if (!prev) return prev

      const url = prev.pdfUrl || URL.createObjectURL(prev.pdfBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = prev.pdfFileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      URL.revokeObjectURL(url)
      const refreshedUrl = URL.createObjectURL(prev.pdfBlob)
      return { ...prev, pdfUrl: refreshedUrl }
    })
  }, [])

  const handleShareChannel = useCallback(
    (channel: ShareChannel) => {
      if (!receiptSharePayload || !receipt || !activeStoreId) return

      const isOnline = typeof navigator === 'undefined' || navigator.onLine
      if (!isOnline) {
        setSaleError('You appear to be offline. Reconnect to share receipts.')
        return
      }

      const hrefMap: Record<ShareChannel, string> = {
        email: receiptSharePayload.emailHref,
        sms: receiptSharePayload.smsHref,
        whatsapp: receiptSharePayload.whatsappHref,
      }

      const logPayload: LogReceiptSharePayload = {
        storeId: activeStoreId,
        saleId: receipt.saleId,
        channel,
        status: 'attempt',
        contact: receipt.customer?.email ?? receipt.customer?.phone ?? null,
        customerId: selectedCustomer?.id ?? receipt.customer?.name ?? null,
        customerName: receipt.customer?.name ?? null,
      }

      logReceiptShare(logPayload).catch(error => {
        console.error('[sell] Failed to log share attempt', error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        logReceiptShare({ ...logPayload, status: 'failed', errorMessage }).catch(
          secondaryError => {
            console.error('[sell] Failed to log share failure', secondaryError)
          },
        )
      })

      const target = channel === 'sms' ? '_self' : '_blank'
      window.open(hrefMap[channel], target, 'noopener,noreferrer')
    },
    [activeStoreId, logReceiptShare, receipt, receiptSharePayload, selectedCustomer?.id],
  )

  useEffect(() => {
    const url = receiptSharePayload?.pdfUrl
    return () => {
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [receiptSharePayload?.pdfUrl])

  // ---------- Stock helpers ----------
  const productStockById = useMemo(() => {
    const map = new Map<string, number>()
    products.forEach(product => {
      const itemType = product.itemType ?? 'product'
      if (itemType === 'product' && typeof product.stockCount === 'number') {
        map.set(product.id, product.stockCount)
      }
    })
    return map
  }, [products])

  const getStockCount = useCallback(
    (productId: string) => productStockById.get(productId) ?? 0,
    [productStockById],
  )

  const hasInsufficientStockInCart = useMemo(
    () =>
      cart.some(line => {
        const product = products.find(p => p.id === line.productId)
        const itemType = product?.itemType ?? 'product'
        if (itemType === 'service') return false
        return line.qty > getStockCount(line.productId)
      }),
    [cart, getStockCount, products],
  )

  const addToCart = useCallback(
    (p: Product) => {
      if (typeof p.price !== 'number' || !Number.isFinite(p.price)) {
        return
      }
      updateActiveDraft(draft => {
        const cs = draft.cart
        const i = cs.findIndex(x => x.productId === p.id)
        const taxRate =
          typeof p.taxRate === 'number' && Number.isFinite(p.taxRate)
            ? p.taxRate
            : undefined
        if (i >= 0) {
          const copy = [...cs]
          copy[i] = { ...copy[i], qty: copy[i].qty + 1 }
          return { ...draft, cart: copy }
        }
        return {
          ...draft,
          cart: [
            ...cs,
            { productId: p.id, name: p.name, price: p.price, qty: 1, taxRate },
          ],
        }
      })
    },
    [updateActiveDraft],
  )

  const handleScannerError = useCallback((message: string) => {
    setScannerStatus({ tone: 'error', message })
  }, [])

  const handleScanResult = useCallback(
    (result: ScanResult) => {
      const normalized = result.code.trim()
      if (!normalized) return
      const match = products.find(product => {
        if (!product.sku) return false
        return product.sku.trim().toLowerCase() === normalized.toLowerCase()
      })
      if (!match) {
        setScannerStatus({
          tone: 'error',
          message: `We couldn't find a product for code ${normalized}.`,
        })
        return
      }
      if (typeof match.price !== 'number' || !Number.isFinite(match.price)) {
        setScannerStatus({
          tone: 'error',
          message: `${match.name} needs a price before it can be sold.`,
        })
        return
      }

      addToCart(match)
      const friendlySource =
        result.source === 'manual'
          ? 'manual entry'
          : result.source === 'camera'
          ? 'the camera'
          : 'the scanner'
      setScannerStatus({
        tone: 'success',
        message: `Added ${match.name} via ${friendlySource}.`,
      })
    },
    [addToCart, products],
  )

  function setQty(id: string, qty: number) {
    updateActiveDraft(draft => ({
      ...draft,
      cart: draft.cart
        .map(l => (l.productId === id ? { ...l, qty: Math.max(0, qty) } : l))
        .filter(l => l.qty > 0),
    }))
  }

  // ---------- Multi-sale tab handlers ----------
  const handleAddSale = useCallback(() => {
    const newId = `draft-${Date.now()}`
    setSaleDrafts(drafts => [...drafts, createEmptyDraft(newId)])
    setActiveDraftId(newId)
  }, [])

  const handleRemoveSale = useCallback(
    (id: string) => {
      setSaleDrafts(drafts => {
        if (drafts.length === 1) {
          // Never remove last draft; just reset it
          return drafts.map(d => (d.id === id ? createEmptyDraft(d.id) : d))
        }

        const filtered = drafts.filter(d => d.id !== id)
        if (id === activeDraftId && filtered[0]) {
          setActiveDraftId(filtered[0].id)
        }
        return filtered
      })
    },
    [activeDraftId],
  )

  // ---------- Record sale ----------
  async function recordSale() {
    const currentDraft = activeDraft
    if (!currentDraft) return

    const cart = currentDraft.cart

    if (cart.length === 0) return
    if (isSubscriptionInactive) {
      setSaleError('Your subscription is inactive. Reactivate to record sales.')
      return
    }
    if (!activeStoreId) {
      setSaleError('Select a workspace before recording a sale.')
      return
    }
    if (!user) {
      setSaleError('You must be signed in to record a sale.')
      return
    }
    if (hasInsufficientStockInCart) {
      setSaleError('Not enough stock')
      return
    }
    if (isCashShort) {
      setSaleError('Cash received is less than the total due.')
      return
    }
    setSaleError(null)
    setSaleSuccess(null)
    setReceipt(null)
    setIsRecording(true)

    const saleId = doc(collection(db, 'sales')).id
    const commitSale =
      httpsCallable<CommitSalePayload, CommitSaleResponse>(cloudFunctions, 'commitSale')
    const loyaltyEarnedValue = selectedCustomer ? loyaltyEarned : null
    const loyaltyCurrentPointsValue = selectedCustomer ? loyaltyCurrentPoints : null
    const payment: Payment = {
      method: paymentMethod === 'paystack' ? 'card' : paymentMethod,
      amountPaid,
      changeDue,
    }

    if (paymentMethod === 'paystack') {
      if (!navigator.onLine) {
        setSaleError(
          'Card/Mobile payments need an internet connection. Please reconnect and try again.',
        )
        setIsRecording(false)
        return
      }

      const paystackBuyer = selectedCustomer
        ? {
            email: selectedCustomer.email,
            phone: selectedCustomer.phone,
            name: selectedCustomerDataName || selectedCustomer.id,
          }
        : undefined
      // Charge the grand total (incl. VAT)
      const paystackResponse = await payWithPaystack(totalDue, paystackBuyer)
      if (!paystackResponse.ok || !paystackResponse.reference) {
        setSaleError(paystackResponse.error ?? 'Card/Mobile payment was cancelled.')
        setIsRecording(false)
        return
      }

      payment.provider = 'paystack'
      payment.providerRef = paystackResponse.reference
      payment.status = paystackResponse.status ?? 'success'
    }

    const payload: CommitSalePayload = {
      branchId: activeStoreId,
      saleId,
      cashierId: user.uid,
      customerId: selectedCustomer?.id ?? null,
      loyaltyEarned: loyaltyEarnedValue,
      currentPoints: loyaltyCurrentPointsValue,
      totals: {
        total: totalDue,
        taxTotal: cartTaxTotal,
      },
      payment,
      items: cart.map(line => ({
        productId: line.productId,
        name: line.name,
        price: line.price,
        qty: line.qty,
        taxRate: line.taxRate ?? 0,
      })),
    }
    if (selectedCustomer) {
      payload.customer = {
        id: selectedCustomer.id,
        name: selectedCustomerDataName || selectedCustomer.id,
        ...(selectedCustomer.phone ? { phone: selectedCustomer.phone } : {}),
        ...(selectedCustomer.email ? { email: selectedCustomer.email } : {}),
      }
    }

    const receiptItems = cart.map(line => ({ ...line, taxRate: line.taxRate ?? 0 }))

    try {
      const { data } = await commitSale(payload)
      if (!data?.ok) {
        throw new Error('Sale was not recorded')
      }

      const cashierNameOrEmail = user.displayName || user.email || 'Cashier'
      try {
        if (activeStoreId) {
          await addDoc(collection(db, 'activity'), {
            storeId: activeStoreId,
            type: 'sale',
            summary: `Sold ${totalQty} items for GHS ${totalDue.toFixed(2)}`,
            detail: `Paid with ${paymentMethodLabel}`,
            actor: cashierNameOrEmail,
            createdAt: serverTimestamp(),
          })
        }
      } catch (err) {
        console.warn('[activity] Failed to log sale activity', err)
      }

      setReceipt({
        saleId: data.saleId,
        createdAt: new Date(),
        items: receiptItems,
        subtotal,
        loyaltyEarned: loyaltyEarnedValue,
        currentPoints: loyaltyCurrentPointsValue,
        store: receiptStore,
        payment: payload.payment,
        customer: selectedCustomer
          ? {
              name: selectedCustomerDataName || selectedCustomer.id,
              phone: selectedCustomer.phone,
              email: selectedCustomer.email,
            }
          : undefined,
      })

      // Reset only the active draft
      updateActiveDraft(draft => ({
        ...draft,
        cart: [],
        selectedCustomerId: '',
        paymentMethod: 'cash',
        amountTendered: '',
        loyaltyEarnedInput: '',
        loyaltyAppliedInput: '',
      }))

      setSaleSuccess(`Sale recorded #${data.saleId}. Receipt sent to printer.`)
    } catch (err) {
      console.error('[sell] Unable to record sale', err)
      if (isOfflineError(err)) {
        const queuedPayment =
          paymentMethod === 'paystack'
            ? { ...payload.payment, status: payload.payment.status ?? 'pending' }
            : payload.payment
        const queuedPayload = { ...payload, payment: queuedPayment }
        const queued = await queueCallableRequest('commitSale', queuedPayload, 'sale')
        if (queued) {
          setReceipt({
            saleId,
            createdAt: new Date(),
            items: receiptItems,
            subtotal,
            loyaltyEarned: loyaltyEarnedValue,
            currentPoints: loyaltyCurrentPointsValue,
            store: receiptStore,
            payment: queuedPayment,
            customer: selectedCustomer
              ? {
                  name: selectedCustomerDataName || selectedCustomer.id,
                  phone: selectedCustomer.phone,
                  email: selectedCustomer.email,
                }
              : undefined,
          })

          // Reset only the active draft (queued offline)
          updateActiveDraft(draft => ({
            ...draft,
            cart: [],
            selectedCustomerId: '',
            paymentMethod: 'cash',
            amountTendered: '',
            loyaltyEarnedInput: '',
            loyaltyAppliedInput: '',
          }))

          setSaleSuccess(
            `Sale queued offline #${saleId}. We'll sync it once you're back online.`,
          )
          setIsRecording(false)
          return
        }
      }
      const message = err instanceof Error ? err.message : null
      setSaleError(
        message && message !== 'Sale was not recorded'
          ? message
          : 'We were unable to record this sale. Please try again.',
      )
    } finally {
      setIsRecording(false)
    }
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(queryText.toLowerCase()),
  )

  // ---------- Render ----------
  return (
    <div className="page sell-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Sell</h2>
          <p className="page__subtitle">
            Build a cart from your products and services, then record the sale in seconds.
          </p>
        </div>
        <div className="sell-page__total" aria-live="polite">
          <span className="sell-page__total-label">Total (incl. VAT)</span>
          <span className="sell-page__total-value">GHS {totalDue.toFixed(2)}</span>
        </div>
      </header>

      <section className="card">
        <div className="field">
          <label className="field__label" htmlFor="sell-search">
            Find an item
          </label>
          <input
            id="sell-search"
            autoFocus
            placeholder="Search by name"
            value={queryText}
            onChange={e => setQueryText(e.target.value)}
          />
          <p className="field__hint">
            Tip: search or scan a barcode to add products and services to the cart instantly.
          </p>
        </div>
        <BarcodeScanner
          className="sell-page__scanner"
          enableCameraFallback
          onScan={handleScanResult}
          onError={handleScannerError}
          manualEntryLabel="Scan or type a barcode"
        />
        {scannerStatus && (
          <div
            className={`sell-page__scanner-status sell-page__scanner-status--${scannerStatus.tone}`}
            role="status"
            aria-live="polite"
          >
            {scannerStatus.message}
          </div>
        )}
      </section>

      <div className="sell-page__grid">
        {/* Catalog */}
        <section className="card sell-page__catalog" aria-label="Product and service list">
          <div className="sell-page__section-header">
            <h3 className="card__title">Products &amp; services</h3>
            <p className="card__subtitle">{filtered.length} items available to sell.</p>
          </div>
          <div className="sell-page__catalog-list">
            {filtered.length ? (
              filtered.map(p => {
                const itemType = p.itemType ?? 'product'
                const isService = itemType === 'service'
                const hasPrice = typeof p.price === 'number' && Number.isFinite(p.price)
                const priceText = hasPrice ? `GHS ${p.price.toFixed(2)}` : 'Price unavailable'
                const inventoryLabel = isService
                  ? 'Service • no stock tracking'
                  : `Stock ${p.stockCount ?? 0}`
                const actionLabel = hasPrice ? 'Add' : 'Set price to sell'

                return (
                  <button
                    key={p.id}
                    type="button"
                    className="sell-page__product"
                    onClick={() => addToCart(p)}
                    disabled={!hasPrice}
                    title={hasPrice ? undefined : 'Update the price before selling this item.'}
                  >
                    <div>
                      <span className="sell-page__product-name">{p.name}</span>
                      <span className="sell-page__product-meta">
                        {priceText} • {inventoryLabel}
                      </span>
                    </div>
                    <span className="sell-page__product-action">
                      {isService ? 'Add service' : actionLabel}
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="empty-state">
                <h3 className="empty-state__title">No items found</h3>
                <p>
                  Try a different search term or add new products and services from the products
                  page.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Cart */}
        <section className="card sell-page__cart" aria-label="Cart">
          <div className="sell-page__section-header">
            <h3 className="card__title">Cart</h3>
            <p className="card__subtitle">Adjust quantities before recording the sale.</p>
          </div>

          {/* Multi-sale tabs */}
          <div className="sell-page__multi-sales">
            {saleDrafts.map((draft, index) => (
              <button
                key={draft.id}
                type="button"
                className={
                  'sell-page__multi-sales-tab' +
                  (draft.id === activeDraftId ? ' sell-page__multi-sales-tab--active' : '')
                }
                onClick={() => setActiveDraftId(draft.id)}
              >
                Sale {index + 1}
                {saleDrafts.length > 1 && (
                  <span
                    className="sell-page__multi-sales-tab-close"
                    onClick={e => {
                      e.stopPropagation()
                      handleRemoveSale(draft.id)
                    }}
                    aria-label={`Close sale ${index + 1}`}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              className="sell-page__multi-sales-add"
              onClick={handleAddSale}
            >
              + New sale
            </button>
          </div>

          {isSubscriptionInactive && (
            <p className="sell-page__message sell-page__message--error" role="status">
              Reactivate your subscription to commit sales.
            </p>
          )}

          {saleError && <p className="sell-page__message sell-page__message--error">{saleError}</p>}

          {saleSuccess && (
            <div className="sell-page__message sell-page__message--success">
              <span>{saleSuccess}</span>
              <div className="sell-page__engagement-actions">
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => window.print()}
                >
                  Print again
                </button>
                {receiptSharePayload && (
                  <>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => handleShareChannel('email')}
                      disabled={!canShareReceipt}
                      title={
                        canShareReceipt
                          ? undefined
                          : 'Sharing is unavailable offline. Reconnect to send receipts.'
                      }
                    >
                      Email receipt
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => handleShareChannel('sms')}
                      disabled={!canShareReceipt}
                      title={
                        canShareReceipt
                          ? undefined
                          : 'Sharing is unavailable offline. Reconnect to send receipts.'
                      }
                    >
                      Text receipt
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => handleShareChannel('whatsapp')}
                      disabled={!canShareReceipt}
                      title={
                        canShareReceipt
                          ? undefined
                          : 'Sharing is unavailable offline. Reconnect to send receipts.'
                      }
                    >
                      WhatsApp receipt
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {cart.length ? (
            <>
              {hasInsufficientStockInCart ? (
                <p className="sell-page__message sell-page__message--error" role="alert">
                  Not enough stock.
                </p>
              ) : null}

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="sell-page__numeric">
                        Qty
                      </th>
                      <th scope="col" className="sell-page__numeric">
                        Price
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map(line => {
                      const product = products.find(p => p.id === line.productId)
                      const itemType = product?.itemType ?? 'product'
                      const isService = itemType === 'service'
                      const stockCount = isService ? null : getStockCount(line.productId)
                      const hasInsufficientStock =
                        !isService && typeof stockCount === 'number' && line.qty > stockCount

                      return (
                        <tr key={line.productId}>
                          <td>
                            {line.name}
                            {isService && <div className="sell-page__item-pill">Service</div>}
                          </td>
                          <td className="sell-page__numeric">
                            <input
                              className={`input--inline input--align-right${
                                hasInsufficientStock ? ' sell-page__input--error' : ''
                              }`}
                              type="number"
                              min={0}
                              value={line.qty}
                              onChange={e => setQty(line.productId, Number(e.target.value))}
                              aria-invalid={hasInsufficientStock}
                            />
                            {hasInsufficientStock ? (
                              <div className="sell-page__qty-warning" role="alert">
                                Not enough stock (on hand: {stockCount ?? 0})
                              </div>
                            ) : null}
                          </td>
                          <td className="sell-page__numeric">
                            GHS {(line.price * line.qty).toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sell-page__summary">
                <div className="sell-page__summary-row">
                  <span>Subtotal</span>
                  <strong>GHS {subtotal.toFixed(2)}</strong>
                </div>
                <div className="sell-page__summary-row">
                  <span>VAT</span>
                  <strong>GHS {cartTaxTotal.toFixed(2)}</strong>
                </div>
                <div className="sell-page__summary-row">
                  <span>Total (incl. VAT)</span>
                  <strong>GHS {totalDue.toFixed(2)}</strong>
                </div>
              </div>

              <div className="sell-page__form-grid">
                <div className="sell-page__field-group">
                  <label className="field__label" htmlFor="sell-customer">
                    Customer
                  </label>
                  <select
                    id="sell-customer"
                    value={selectedCustomerId}
                    onChange={event =>
                      updateActiveDraft(draft => ({
                        ...draft,
                        selectedCustomerId: event.target.value,
                        loyaltyAppliedInput: '',
                        loyaltyEarnedInput: '',
                      }))
                    }
                    className="sell-page__select"
                  >
                    <option value="">Walk-in customer</option>
                    {customers.map(customer => (
                      <option key={customer.id} value={customer.id}>
                        {getCustomerDisplayName(customer)}
                      </option>
                    ))}
                  </select>
                  <p className="field__hint">
                    Need to add someone new? Manage records on the{' '}
                    <Link to="/customers" className="sell-page__customers-link">
                      Customers page
                    </Link>
                    .
                  </p>
                </div>

                <div className="sell-page__field-group">
                  <label className="field__label" htmlFor="sell-payment-method">
                    Payment method
                  </label>
                  <select
                    id="sell-payment-method"
                    value={paymentMethod}
                    onChange={event => {
                      const value = event.target.value as 'cash' | 'paystack'
                      updateActiveDraft(draft => ({
                        ...draft,
                        paymentMethod: value,
                        amountTendered: value === 'cash' ? draft.amountTendered : '',
                      }))
                    }}
                    className="sell-page__select"
                  >
                    <option value="cash">Cash</option>
                    <option value="paystack">Card/Mobile (Paystack)</option>
                  </select>
                </div>

                {paymentMethod === 'cash' && (
                  <div className="sell-page__field-group">
                    <label className="field__label" htmlFor="sell-amount-tendered">
                      Cash received
                    </label>
                    <input
                      id="sell-amount-tendered"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amountTendered}
                      onChange={event =>
                        updateActiveDraft(draft => ({
                          ...draft,
                          amountTendered: event.target.value,
                        }))
                      }
                      className="sell-page__input"
                    />
                  </div>
                )}
              </div>

              <div
                className="sell-page__loyalty-panel"
                role="group"
                aria-label="Loyalty rewards"
              >
                <div className="sell-page__loyalty-header">
                  <div>
                    <p className="field__label">Loyalty rewards</p>
                    <p className="sell-page__loyalty-hint">
                      Apply available points or note how many they earned on this sale.
                    </p>
                  </div>
                  <div className="sell-page__loyalty-balance" aria-live="polite">
                    {selectedCustomer
                      ? `Balance after sale: ${(loyaltyBalanceAfterSale ?? 0).toFixed(0)} pts`
                      : 'Select a customer to track points'}
                  </div>
                </div>
                <div className="sell-page__loyalty-grid">
                  <label className="sell-page__loyalty-field">
                    <span className="sell-page__loyalty-label">Apply points</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      max={selectedCustomerLoyalty?.points ?? undefined}
                      value={loyaltyAppliedInput}
                      onChange={event =>
                        updateActiveDraft(draft => ({
                          ...draft,
                          loyaltyAppliedInput: event.target.value,
                        }))
                      }
                      className="sell-page__input"
                      disabled={!selectedCustomer}
                    />
                    <span className="sell-page__loyalty-help">
                      {selectedCustomer
                        ? `Available: ${(selectedCustomerLoyalty?.points ?? 0).toFixed(0)} pts`
                        : 'Pick a customer to redeem points.'}
                    </span>
                  </label>
                  <label className="sell-page__loyalty-field">
                    <span className="sell-page__loyalty-label">Earn this sale</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={loyaltyEarnedInput}
                      onChange={event =>
                        updateActiveDraft(draft => ({
                          ...draft,
                          loyaltyEarnedInput: event.target.value,
                        }))
                      }
                      className="sell-page__input"
                      disabled={!selectedCustomer}
                    />
                    <span className="sell-page__loyalty-help">
                      {selectedCustomer
                        ? 'We will sync these points on the receipt and queued sale.'
                        : 'Add a customer to award or track points.'}
                    </span>
                  </label>
                </div>
              </div>

              <div className="sell-page__payment-summary" aria-live="polite">
                <div>
                  <span className="sell-page__summary-label">Subtotal</span>
                  <strong>GHS {subtotal.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="sell-page__summary-label">VAT</span>
                  <strong>GHS {cartTaxTotal.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="sell-page__summary-label">Amount due</span>
                  <strong>GHS {totalDue.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="sell-page__summary-label">Paid</span>
                  <strong>GHS {amountPaid.toFixed(2)}</strong>
                </div>
                <div className={`sell-page__change${isCashShort ? ' is-short' : ''}`}>
                  <span className="sell-page__summary-label">
                    {isCashShort ? 'Short' : 'Change due'}
                  </span>
                  <strong>GHS {changeDue.toFixed(2)}</strong>
                </div>
              </div>

              {saleSuccess && receiptSharePayload && (
                <section className="sell-page__engagement" aria-live="polite">
                  <h4 className="sell-page__engagement-title">Share the receipt</h4>
                  <p className="sell-page__engagement-text">
                    Email, text, or WhatsApp the receipt so your customer has a digital copy
                    right away.
                  </p>
                  <div className="sell-page__engagement-actions">
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={handleDownloadPdf}
                    >
                      Download PDF
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => handleShareChannel('whatsapp')}
                      disabled={!canShareReceipt}
                      title={
                        canShareReceipt
                          ? undefined
                          : 'Sharing is unavailable offline. Reconnect to send receipts.'
                      }
                    >
                      WhatsApp receipt
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => handleShareChannel('email')}
                      disabled={!canShareReceipt}
                      title={
                        canShareReceipt
                          ? undefined
                          : 'Sharing is unavailable offline. Reconnect to send receipts.'
                      }
                    >
                      Email receipt
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => handleShareChannel('sms')}
                      disabled={!canShareReceipt}
                      title={
                        canShareReceipt
                          ? undefined
                          : 'Sharing is unavailable offline. Reconnect to send receipts.'
                      }
                    >
                      Text receipt
                    </button>
                  </div>
                  <details className="sell-page__engagement-details">
                    <summary>Preview message</summary>
                    <pre className="sell-page__engagement-preview">
                      {receiptSharePayload.message}
                    </pre>
                  </details>
                </section>
              )}

              <button
                type="button"
                className="button button--primary button--block"
                onClick={recordSale}
                disabled={cart.length === 0 || isRecording || isSubscriptionInactive}
              >
                {isSubscriptionInactive ? '🔒 ' : ''}
                {isRecording ? 'Saving…' : 'Record sale'}
              </button>
            </>
          ) : (
            <div className="empty-state">
              <h3 className="empty-state__title">Cart is empty</h3>
              <p>Select products or services from the list to start a new sale.</p>
            </div>
          )}
        </section>
      </div>

      {/* PRINT RECEIPT AREA */}
      <div
        className={`receipt-print${receipt ? ' is-ready' : ''}`}
        aria-hidden={receipt ? 'false' : 'true'}
      >
        {receipt && (
          <div className="receipt-print__inner">
            {(() => {
              const storeInfo = receipt.store ?? receiptStore
              const headerName = storeInfo?.name || 'Sedifex POS'
              const headerContact =
                storeInfo?.phone || storeInfo?.email || user?.email || 'sales@sedifex.app'
              const headerAddress = (storeInfo?.addressLines ?? []).join(', ')

              const taxTotal = receipt.items.reduce(
                (sum, line) => sum + (line.taxRate ?? 0) * line.price * line.qty,
                0,
              )
              const totalWithTax = receipt.subtotal + taxTotal

              return (
                <>
                  <h2 className="receipt-print__title">{headerName}</h2>
                  <p className="receipt-print__meta">
                    {headerAddress && (
                      <>
                        {headerAddress}
                        <br />
                      </>
                    )}
                    {headerContact}
                    <br />
                    {receipt.createdAt.toLocaleString()}
                  </p>

                  {receipt.customer && (
                    <div className="receipt-print__section">
                      <strong>Customer:</strong>
                      <div>{receipt.customer.name}</div>
                      {receipt.customer.phone && <div>{receipt.customer.phone}</div>}
                      {receipt.customer.email && <div>{receipt.customer.email}</div>}
                    </div>
                  )}

                  <table className="receipt-print__table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipt.items.map(line => (
                        <tr key={line.productId}>
                          <td>{line.name}</td>
                          <td>{line.qty}</td>
                          <td>GHS {(line.qty * line.price).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="receipt-print__summary">
                    <div>
                      <span>Subtotal</span>
                      <strong>GHS {receipt.subtotal.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>VAT</span>
                      <strong>GHS {taxTotal.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>GHS {totalWithTax.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Paid ({receipt.payment.method})</span>
                      <strong>GHS {receipt.payment.amountPaid.toFixed(2)}</strong>
                    </div>
                    <div>
                      <span>Change</span>
                      <strong>GHS {receipt.payment.changeDue.toFixed(2)}</strong>
                    </div>
                    {typeof receipt.loyaltyEarned === 'number' &&
                    receipt.loyaltyEarned !== null ? (
                      <div>
                        <span>Loyalty earned</span>
                        <strong>{receipt.loyaltyEarned} pts</strong>
                      </div>
                    ) : null}
                    {typeof receipt.currentPoints === 'number' &&
                    receipt.currentPoints !== null ? (
                      <div>
                        <span>Points balance</span>
                        <strong>{receipt.currentPoints} pts</strong>
                      </div>
                    ) : null}
                  </div>

                  <p className="receipt-print__footer">
                    Sale #{receipt.saleId} — Thank you for shopping with us!
                  </p>
                </>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
