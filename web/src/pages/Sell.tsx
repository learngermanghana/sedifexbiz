// src/pages/Sell.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  Timestamp,
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

type PaymentTender = {
  method: 'cash' | 'card'
  amount: number
  provider?: string
  providerRef?: string | null
  status?: string | null
}

type Payment = {
  tenders: PaymentTender[]
  totalPaid: number
  changeDue: number
  tip?: number | null
}

type ReceiptData = {
  saleId: string
  createdAt: Date
  items: CartLine[]
  subtotal: number
  taxTotal: number        // NEW: store final VAT used for this sale
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

type ReceiptShareStatus = 'attempt' | 'failed' | 'sent'

type LogReceiptSharePayload = {
  storeId: string
  saleId: string
  channel: ShareChannel
  status: ReceiptShareStatus
  contact: string | null
  customerId?: string | null
  customerName?: string | null
  errorMessage?: string | null
}

type ReceiptShareLog = LogReceiptSharePayload & {
  id: string
  createdAt?: Timestamp | null
  updatedAt?: Timestamp | null
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
  paymentInputs: {
    cash: string
    paystack: string // still used as "Card/Mobile" manual input
  }
  tipInput: string
  loyaltyEarnedInput: string
  loyaltyAppliedInput: string
  vatOverrideInput: string      // NEW: manual VAT override for this draft
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

function getReceiptShareStatusLabel(status: ReceiptShareStatus | string): string {
  if (status === 'failed') return 'Failed'
  if (status === 'sent') return 'Sent'
  return 'Pending'
}

function getReceiptShareStatusTone(status: ReceiptShareStatus | string): 'error' | 'success' | 'pending' {
  if (status === 'failed') return 'error'
  if (status === 'sent') return 'success'
  return 'pending'
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
    paymentInputs: {
      cash: '',
      paystack: '',
    },
    tipInput: '',
    loyaltyEarnedInput: '',
    loyaltyAppliedInput: '',
    vatOverrideInput: '', // NEW
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
  const [receiptShareLogs, setReceiptShareLogs] = useState<ReceiptShareLog[]>([])
  const [shareLogsError, setShareLogsError] = useState<string | null>(null)
  const [isLoadingShareLogs, setIsLoadingShareLogs] = useState(false)

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
  const cashAmountInput = activeDraft?.paymentInputs.cash ?? ''
  const paystackAmountInput = activeDraft?.paymentInputs.paystack ?? ''
  const tipInput = activeDraft?.tipInput ?? ''
  const loyaltyEarnedInput = activeDraft?.loyaltyEarnedInput ?? ''
  const loyaltyAppliedInput = activeDraft?.loyaltyAppliedInput ?? ''
  const vatOverrideInput = activeDraft?.vatOverrideInput ?? ''

  // Subtotal (no VAT yet)
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0)

  // VAT from product taxRate (auto)
  const cartTaxTotal = useMemo(
    () =>
      cart.reduce(
        (sum, line) => sum + (line.taxRate ?? 0) * line.price * line.qty,
        0,
      ),
    [cart],
  )

  // Manual VAT override
  const vatOverrideAmount = useMemo(() => {
    const parsed = Number(vatOverrideInput)
    if (!Number.isFinite(parsed) || parsed < 0) return null
    return parsed
  }, [vatOverrideInput])

  // Final VAT used in sale
  const taxTotal = vatOverrideAmount !== null ? vatOverrideAmount : cartTaxTotal

  // Grand total (Amount due = subtotal + VAT)
  const totalDue = subtotal + taxTotal

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

  const tipAmount = useMemo(() => {
    const parsed = Number(tipInput)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }, [tipInput])

  const cashAmount = useMemo(() => {
    const parsed = Number(cashAmountInput)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }, [cashAmountInput])

  const paystackAmount = useMemo(() => {
    const parsed = Number(paystackAmountInput)
    if (!Number.isFinite(parsed) || parsed < 0) return 0
    return parsed
  }, [paystackAmountInput])

  const totalWithTip = totalDue + tipAmount

  const amountPaid = cashAmount + paystackAmount
  const changeDue = Math.max(0, amountPaid - totalWithTip)
  const isPaymentShort = amountPaid < totalWithTip && totalWithTip > 0
  const paymentMethodsLabel = [
    cashAmount > 0 ? 'cash' : null,
    paystackAmount > 0 ? 'card/mobile' : null,
  ]
    .filter(Boolean)
    .join(' + ')

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

 
