// web/src/pages/Customers.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import {
  CUSTOMER_CACHE_LIMIT,
  loadCachedCustomers,
  saveCachedCustomers,
} from '../utils/offlineCache'
import { ensureCustomerLoyalty } from '../utils/customerLoyalty'

// ---------- Types ----------

type Customer = {
  id: string
  name?: string
  displayName?: string
  phone?: string
  email?: string
  notes?: string
  loyalty?: {
    points?: number
  }
  createdAt?: unknown
  updatedAt?: unknown
}

type CustomerSaleRow = {
  id: string
  total: number
  taxTotal: number
  createdAt: Date | null
}

// ---------- Helpers ----------

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

function toDate(value: any): Date | null {
  if (!value) return null
  if (value.toDate && typeof value.toDate === 'function') {
    return value.toDate()
  }
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

// ---------- Component ----------

export default function Customers() {
  const { storeId } = useActiveStore()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [queryText, setQueryText] = useState('')

  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false)

  const [customerSales, setCustomerSales] = useState<CustomerSaleRow[]>([])
  const [isLoadingCustomerSales, setIsLoadingCustomerSales] = useState(false)
  const [customerSalesError, setCustomerSalesError] = useState<string | null>(null)

  // ---------- Load customers (with offline cache) ----------

  useEffect(() => {
    let cancelled = false

    if (!storeId) {
      setCustomers([])
      setSelectedCustomerId('')
      return () => {
        cancelled = true
      }
    }

    setIsLoadingCustomers(true)

    // 1) Warm from offline cache
    loadCachedCustomers<Customer>({ storeId })
      .then(cached => {
        if (!cancelled && cached.length) {
          const normalized = cached.map(customer => ensureCustomerLoyalty(customer))
          const sorted = [...normalized].sort((a, b) =>
            getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
              sensitivity: 'base',
            }),
          )
          setCustomers(sorted)
          if (!selectedCustomerId && sorted[0]) {
            setSelectedCustomerId(sorted[0].id)
          }
        }
      })
      .catch(error => {
        console.warn('[customers] Failed to load cached customers', error)
      })

    // 2) Live Firestore subscription
    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', storeId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(
      q,
      snap => {
        if (cancelled) return
        const rows = snap.docs.map(docSnap =>
          ensureCustomerLoyalty({
            id: docSnap.id,
            ...(docSnap.data() as Customer),
          }),
        )

        saveCachedCustomers(rows, { storeId }).catch(err => {
          console.warn('[customers] Failed to cache customers', err)
        })

        const sorted = [...rows].sort((a, b) =>
          getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
            sensitivity: 'base',
          }),
        )
        setCustomers(sorted)
        setIsLoadingCustomers(false)

        if (!sorted.length) {
          setSelectedCustomerId('')
        } else if (!selectedCustomerId || !sorted.find(c => c.id === selectedCustomerId)) {
          // default to first customer if none selected / current selection gone
          setSelectedCustomerId(sorted[0].id)
        }
      },
      error => {
        if (cancelled) return
        console.error('[customers] Failed to load customers', error)
        setCustomers([])
        setIsLoadingCustomers(false)
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [storeId])

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId],
  )

  const selectedCustomerDataName = selectedCustomer
    ? getCustomerNameForData(selectedCustomer)
    : ''

  // ---------- Load sales for selected customer ----------

  useEffect(() => {
    if (!storeId || !selectedCustomer) {
      setCustomerSales([])
      setCustomerSalesError(null)
      return
    }

    setIsLoadingCustomerSales(true)
    setCustomerSalesError(null)

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', storeId),
      where('customer.id', '==', selectedCustomer.id), // 👈 match commitSale payload
      orderBy('createdAt', 'desc'),
      limit(100),
    )

    const unsubscribe = onSnapshot(
      q,
      snap => {
        const rows: CustomerSaleRow[] = snap.docs.map(docSnap => {
          const data = docSnap.data() as any
          const createdAt = toDate(data.createdAt)

          const total =
            typeof data.total === 'number'
              ? data.total
              : typeof data.totals?.total === 'number'
                ? data.totals.total
                : 0

          const taxTotal =
            typeof data.taxTotal === 'number'
              ? data.taxTotal
              : typeof data.totals?.taxTotal === 'number'
                ? data.totals.taxTotal
                : 0

          return {
            id: docSnap.id,
            total: Number(total) || 0,
            taxTotal: Number(taxTotal) || 0,
            createdAt,
          }
        })

        setCustomerSales(rows)
        setIsLoadingCustomerSales(false)
      },
      error => {
        console.error('[customers] Failed to load customer sales', error)
        setCustomerSales([])
        setIsLoadingCustomerSales(false)
        setCustomerSalesError('Unable to load sales for this customer.')
      },
    )

    return unsubscribe
  }, [storeId, selectedCustomer?.id])

  // ---------- Derived metrics ----------

  const filteredCustomers = useMemo(() => {
    const q = queryText.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(c => {
      const name = getCustomerDisplayName(c).toLowerCase()
      const email = (c.email ?? '').toLowerCase()
      const phone = (c.phone ?? '').toLowerCase()
      return (
        name.includes(q) ||
        email.includes(q) ||
        phone.includes(q)
      )
    })
  }, [customers, queryText])

  const totalSalesAmount = customerSales.reduce((sum, row) => sum + row.total, 0)
  const totalVatAmount
