import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { Link, useLocation } from 'react-router-dom'
import { db } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus'
import { SubscriptionBanner } from '../components/SubscriptionBanner'
import {
  PRODUCT_CACHE_LIMIT,
  loadCachedProducts,
  saveCachedProducts,
} from '../utils/offlineCache'
import './Products.css'

interface ReceiptDetails {
  qty?: number | null
  supplier?: string | null
  receivedAt?: unknown
}

export type ProductRecord = {
  id: string
  name: string

  // NEW: treat everything as an "item" so we can include services
  itemType?: 'product' | 'service' // default to 'product' when missing

  price: number | null
  sku?: string | null

  // stock fields apply only to physical products
  stockCount?: number | null
  reorderLevel?: number | null
  reorderThreshold?: number | null
  lastReceipt?: ReceiptDetails | null

  // NEW: service-oriented optional fields
  durationMinutes?: number | null // e.g. 45-minute lash set
  defaultStaffTag?: string | null // e.g. "Nails", "Makeup", "Hair"

  createdAt?: unknown
  updatedAt?: unknown
  storeId?: string | null
  __optimistic?: boolean
}

type StatusTone = 'success' | 'error'

interface StatusState {
  tone: StatusTone
  message: string
}

function sanitizePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  return null
}

const DEFAULT_CREATE_FORM = {
  name: '',
  sku: '',
  price: '',
  reorderLevel: '',
  initialStock: '',
  itemType: 'product' as 'product' | 'service',
  durationMinutes: '',
  defaultStaffTag: '',
}

const DEFAULT_EDIT_FORM = {
  name: '',
  sku: '',
  price: '',
  reorderLevel: '',
  itemType: 'product' as 'product' | 'service',
  durationMinutes: '',
  defaultStaffTag: '',
}

const LAST_EXPORT_KEY = 'products:lastExportedAt'

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value) : null
  }
  if (typeof value === 'object') {
    const anyValue = value as {
      toDate?: () => Date
      toMillis?: () => number
      seconds?: number
      nanoseconds?: number
    }
    if (typeof anyValue.toDate === 'function') {
      try {
        return anyValue.toDate() ?? null
      } catch (error) {
        console.warn('[products] Failed to convert timestamp via toDate', error)
      }
    }
    if (typeof anyValue.toMillis === 'function') {
      try {
        const millis = anyValue.toMillis()
        return Number.isFinite(millis) ? new Date(millis) : null
      } catch (error) {
        console.warn('[products] Failed to convert timestamp via toMillis', error)
      }
    }
    if (typeof anyValue.seconds === 'number') {
      const millis =
        anyValue.seconds * 1000 +
        Math.round((anyValue.nanoseconds ?? 0) / 1_000_000)
      return Number.isFinite(millis) ? new Date(millis) : null
    }
  }
  return null
}

function formatReceiptDetails(receipt: ReceiptDetails | null | undefined): string {
  if (!receipt) return 'No receipts recorded'
  const qty = typeof receipt.qty === 'number' ? receipt.qty : null
  const supplier = typeof receipt.supplier === 'string' ? receipt.supplier : null
  const receivedAt = toDate(receipt.receivedAt)
  const parts: string[] = []
  if (qty !== null) {
    parts.push(`${qty} received`)
  }
  if (supplier) {
    parts.push(`from ${supplier}`)
  }
  if (receivedAt) {
    parts.push(
      `on ${receivedAt.toLocaleDateString()} ${receivedAt.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    )
  }
  if (!parts.length) {
    return 'Last receipt details unavailable'
  }
  return parts.join(' ')
}

function sortProducts(products: ProductRecord[]): ProductRecord[] {
  return [...products].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
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

export default function Products() {
  const { user } = useAuthUser()
  const { storeId: activeStoreId } = useActiveStore()
  const location = useLocation()
  const activityActor = user?.displayName || user?.email || 'Team member'
  const subscription = useSubscriptionStatus()
  const isSubscriptionInactive = subscription.isInactive
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [isLoadingProducts, setIsLoadingProducts] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM)
  const [createStatus, setCreateStatus] = useState<StatusState | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editForm, setEditForm] = useState(DEFAULT_EDIT_FORM)
  const [initialEditForm, setInitialEditForm] = useState(DEFAULT_EDIT_FORM)
  const [editStatus, setEditStatus] = useState<StatusState | null>(null)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [exportStatus, setExportStatus] = useState<StatusState | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [lastExportedAt, setLastExportedAt] = useState<Date | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setShowLowStockOnly(params.get('lowStock') === '1')
  }, [location.search])

  useEffect(() => {
    const stored = window.localStorage.getItem(LAST_EXPORT_KEY)
    if (!stored) return
    const parsed = Number(stored)
    if (Number.isFinite(parsed)) {
      setLastExportedAt(new Date(parsed))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadError(null)

    if (!activeStoreId) {
      setProducts([])
      setIsLoadingProducts(false)
      return () => {
        cancelled = true
      }
    }

    setIsLoadingProducts(true)

    loadCachedProducts<Omit<ProductRecord, '__optimistic'>>({
      storeId: activeStoreId,
    })
      .then(cached => {
        if (!cancelled && cached.length) {
          setLoadError(null)
          setProducts(prev => {
            const optimistic = prev.filter(
              item => item.__optimistic && item.storeId === activeStoreId,
            )
            const sanitized = cached.map(item => ({
              ...(item as ProductRecord),
              price: sanitizePrice((item as ProductRecord).price),
              __optimistic: false,
              storeId: activeStoreId,
            }))
            return sortProducts([...sanitized, ...optimistic])
          })
          setIsLoadingProducts(false)
        }
      })
      .catch(error => {
        console.warn('[products] Failed to load cached products', error)
      })

    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        if (cancelled) return

        // ✅ Clear any previous error once we get a good snapshot
        setLoadError(null)

        const rows = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...(docSnap.data() as Record<string, unknown>),
        }))
        const sanitizedRows = rows.map(row => {
          const typedRow = row as ProductRecord
          const resolvedReorderLevel =
            typeof typedRow.reorderLevel === 'number' &&
            Number.isFinite(typedRow.reorderLevel)
              ? typedRow.reorderLevel
              : typeof typedRow.reorderThreshold === 'number' &&
                  Number.isFinite(typedRow.reorderThreshold)
                ? typedRow.reorderThreshold
                : null
          return {
            ...typedRow,
            reorderLevel: resolvedReorderLevel,
            price: sanitizePrice(typedRow.price),
            storeId: activeStoreId,
            __optimistic: false,
          }
        })
        saveCachedProducts(sanitizedRows, { storeId: activeStoreId }).catch(error => {
          console.warn('[products] Failed to cache products', error)
        })
        setProducts(prev => {
          const optimistic = prev.filter(
            product => product.__optimistic && product.storeId === activeStoreId,
          )
          const optimisticRemainders = optimistic.filter(
            item => !rows.some(row => row.id === item.id),
          )
          return sortProducts([...sanitizedRows, ...optimisticRemainders])
        })
        setIsLoadingProducts(false)
      },
      error => {
        if (cancelled) return
        console.error('[products] Failed to subscribe to products', error)
        setLoadError('Unable to load products right now. Please try again shortly.')
        setIsLoadingProducts(false)
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  useEffect(() => {
    if (!editingProductId) {
      setEditForm(DEFAULT_EDIT_FORM)
      setInitialEditForm(DEFAULT_EDIT_FORM)
      return
    }
    const product = products.find(item => item.id === editingProductId)
    if (!product) return
    const nextForm = {
      name: product.name ?? '',
      sku: product.sku ?? '',
      price:
        typeof product.price === 'number' && Number.isFinite(product.price)
          ? String(product.price)
          : '',
      reorderLevel:
        typeof product.reorderLevel === 'number' &&
        Number.isFinite(product.reorderLevel)
          ? String(product.reorderLevel)
          : '',
      itemType: product.itemType ?? 'product',
      durationMinutes:
        typeof product.durationMinutes === 'number' &&
        Number.isFinite(product.durationMinutes)
          ? String(product.durationMinutes)
          : '',
      defaultStaffTag: product.defaultStaffTag ?? '',
    }
    setEditForm(nextForm)
    setInitialEditForm(nextForm)
  }, [editingProductId, products])

  const hasUnsavedEditChanges = useMemo(() => {
    if (!editingProductId) return false
    return (
      editForm.name !== initialEditForm.name ||
      editForm.sku !== initialEditForm.sku ||
      editForm.price !== initialEditForm.price ||
      editForm.reorderLevel !== initialEditForm.reorderLevel ||
      editForm.itemType !== initialEditForm.itemType ||
      editForm.durationMinutes !== initialEditForm.durationMinutes ||
      editForm.defaultStaffTag !== initialEditForm.defaultStaffTag
    )
  }, [
    editForm.name,
    editForm.sku,
    editForm.price,
    editForm.reorderLevel,
    editForm.itemType,
    editForm.durationMinutes,
    editForm.defaultStaffTag,
    editingProductId,
    initialEditForm,
  ])

  const productDataMap = useMemo(() => {
    return products.reduce<Record<string, ProductRecord>>((acc, product) => {
      acc[product.id] = product
      return acc
    }, {})
  }, [products])

  const lowStockProducts = useMemo(() => {
    return Object.values(productDataMap).filter(product => {
      const itemType = product.itemType ?? 'product'
      if (itemType !== 'product') return false
      const stockCount =
        typeof product.stockCount === 'number' ? product.stockCount : 0
      const reorder =
        typeof product.reorderLevel === 'number' ? product.reorderLevel : null
      return reorder !== null && stockCount <= reorder
    })
  }, [productDataMap])

  const lowStockCount = lowStockProducts.length

  const filteredProducts = useMemo(() => {
    const normalizedQuery = filterText.trim().toLowerCase()
    return sortProducts(
      products.filter(product => {
        const matchesLowStock =
          !showLowStockOnly || lowStockProducts.some(item => item.id === product.id)
        if (!matchesLowStock) return false
        if (!normalizedQuery) return true
        const haystack = `${product.name ?? ''} ${product.sku ?? ''}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      }),
    )
  }, [filterText, lowStockProducts, products, showLowStockOnly])

  function formatLastExportedAt(date: Date | null) {
    if (!date) return 'Never'
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }

  function buildCsv(rows: ProductRecord[]) {
    const header = ['Item', 'Type', 'SKU', 'On hand', 'Reorder point', 'Last receipt']
    const body = rows.map(product => {
      const itemType = product.itemType ?? 'product'
      const stockCount =
        itemType === 'product' && typeof product.stockCount === 'number'
          ? product.stockCount
          : ''
      const reorder =
        itemType === 'product' && typeof product.reorderLevel === 'number'
          ? product.reorderLevel
          : ''
      const receipt = formatReceiptDetails(product.lastReceipt)
      return [
        product.name ?? '',
        itemType === 'service' ? 'Service' : 'Product',
        product.sku ?? '',
        stockCount,
        reorder,
        receipt,
      ]
    })
    return [header, ...body]
      .map(columns =>
        columns
          .map(value => {
            const normalized = `${value ?? ''}`
            if (normalized.includes(',') || normalized.includes('"')) {
              return `"${normalized.replace(/"/g, '""')}"`
            }
            return normalized
          })
          .join(','),
      )
      .join('\n')
  }

  function openPrintPreview(rows: ProductRecord[]) {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) {
      throw new Error('Unable to open print preview window')
    }

    const tableRows = rows
      .map(product => {
        const itemType = product.itemType ?? 'product'
        const stockCount =
          itemType === 'product' && typeof product.stockCount === 'number'
            ? product.stockCount
            : '—'
        const reorder =
          itemType === 'product' && typeof product.reorderLevel === 'number'
            ? product.reorderLevel
            : '—'
        const receipt = formatReceiptDetails(product.lastReceipt)
        return `<tr><td>${product.name ?? ''}</td><td>${itemType === 'service' ? 'Service' : 'Product'}</td><td>${
          product.sku ?? '—'
        }</td><td>${stockCount}</td><td>${reorder}</td><td>${receipt}</td></tr>`
      })
      .join('')

    const html = `<!doctype html>
      <html>
        <head>
          <title>Low stock & items list</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; font-size: 14px; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>Low stock reorder / items list</h1>
          <p>Exported ${new Date().toLocaleString()}</p>
          <table>
            <thead><tr><th>Item</th><th>Type</th><th>SKU</th><th>On hand</th><th>Reorder point</th><th>Last receipt</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>`

    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  function handleExportReorderList() {
    if (isExporting) return
    if (!navigator.onLine) {
      setExportStatus({
        tone: 'error',
        message: 'Reconnect to the internet to download a fresh reorder list.',
      })
      return
    }
    if (!lowStockProducts.length) {
      setExportStatus({
        tone: 'error',
        message: 'All items are above their reorder points right now.',
      })
      return
    }
    setIsExporting(true)
    setExportStatus(null)
    try {
      const csv = buildCsv(lowStockProducts)
      const blob = new Blob([csv], { type: 'text/csv' })
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `reorder-list-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(downloadUrl)

      openPrintPreview(lowStockProducts)

      const now = new Date()
      window.localStorage.setItem(LAST_EXPORT_KEY, String(now.getTime()))
      setLastExportedAt(now)
      setExportStatus({
        tone: 'success',
        message: 'Reorder list downloaded. Print to save a PDF copy.',
      })
    } catch (error) {
      console.error('[products] Failed to export reorder list', error)
      setExportStatus({
        tone: 'error',
        message: 'Unable to export reorder list. Try again when online.',
      })
    } finally {
      setIsExporting(false)
    }
  }

  function handleCreateFieldChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = event.target
    setCreateForm(prev => ({ ...prev, [name]: value }))
  }

  function handleCancelEdit() {
    if (hasUnsavedEditChanges) {
      const confirmClose = window.confirm(
        'You have unsaved changes. Close the editor without saving?',
      )
      if (!confirmClose) {
        return
      }
    }
    setEditStatus(null)
    setEditingProductId(null)
  }

  function handleEditFieldChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = event.target
    setEditForm(prev => ({ ...prev, [name]: value }))
  }

  function resetCreateForm() {
    setCreateForm(DEFAULT_CREATE_FORM)
  }

  function validateNumbers(value: string, allowZero = true) {
    if (!value.trim()) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    if (parsed < 0) return null
    if (!allowZero && parsed === 0) return null
    return parsed
  }

  function validateDuration(value: string) {
    if (!value.trim()) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    if (parsed <= 0) return null
    return parsed
  }

  function parsePriceInput(value: string) {
    if (!value.trim()) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    if (parsed < 0) return null
    return parsed
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSubscriptionInactive) {
      setCreateStatus({
        tone: 'error',
        message: 'Your subscription is inactive. Reactivate it to add items.',
      })
      return
    }

    const name = createForm.name.trim()
    const sku = createForm.sku.trim()
    const itemType = (createForm.itemType as 'product' | 'service') || 'product'
    const price = parsePriceInput(createForm.price)
    const reorderLevel = validateNumbers(createForm.reorderLevel)
    const initialStock = validateNumbers(createForm.initialStock)
    const durationMinutes = validateDuration(createForm.durationMinutes)
    const defaultStaffTag = createForm.defaultStaffTag.trim() || ''

    if (!name) {
      setCreateStatus({
        tone: 'error',
        message:
          'Name your item so the team recognises it in the list.',
      })
      return
    }
    if (price === null) {
      setCreateStatus({
        tone: 'error',
        message: 'Enter a valid price that is zero or greater.',
      })
      return
    }
    if (!sku) {
      setCreateStatus({
        tone: 'error',
        message:
          'Add a SKU so you can search it quickly or scan barcodes during checkout.',
      })
      return
    }
    if (createForm.reorderLevel && reorderLevel === null) {
      setCreateStatus({
        tone: 'error',
        message:
          'Enter a valid reorder point that is zero or greater.',
      })
      return
    }
    if (itemType === 'product' && createForm.initialStock && initialStock === null) {
      setCreateStatus({
        tone: 'error',
        message:
          'Enter a valid opening stock that is zero or greater.',
      })
      return
    }

    if (!activeStoreId) {
      setCreateStatus({
        tone: 'error',
        message: 'Select a workspace before adding items.',
      })
      return
    }

    setIsCreating(true)
    setCreateStatus(null)

    let optimisticProduct: ProductRecord | null = null

    try {
      const duplicateQuery = query(
        collection(db, 'products'),
        where('storeId', '==', activeStoreId),
        where('sku', '==', sku),
        limit(1),
      )
      const duplicate = await getDocs(duplicateQuery)
      if (!duplicate.empty) {
        setCreateStatus({
          tone: 'error',
          message:
            'An item in this workspace already uses that SKU. Pick a unique SKU before saving.',
        })
        return
      }

      optimisticProduct = {
        id: `optimistic-${Date.now()}`,
        name,
        price,
        sku,
        itemType,
        durationMinutes: durationMinutes ?? null,
        defaultStaffTag: defaultStaffTag || null,
        reorderLevel: itemType === 'product' ? reorderLevel ?? null : null,
        stockCount: itemType === 'product' ? initialStock ?? 0 : null,
        lastReceipt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        storeId: activeStoreId,
        __optimistic: true,
      }

      setProducts(prev => sortProducts([optimisticProduct!, ...prev]))

      const ref = await addDoc(collection(db, 'products'), {
        name,
        price,
        sku,
        itemType,
        durationMinutes: durationMinutes ?? null,
        defaultStaffTag: defaultStaffTag || null,
        reorderLevel: itemType === 'product' ? reorderLevel ?? null : null,
        reorderThreshold: itemType === 'product' ? reorderLevel ?? null : null,
        stockCount: itemType === 'product' ? initialStock ?? 0 : null,
        storeId: activeStoreId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      try {
        await addDoc(collection(db, 'activity'), {
          storeId: activeStoreId,
          type: 'inventory',
          summary: `Added ${itemType === 'service' ? 'service' : 'product'} ${name}`,
          detail: `SKU: ${sku || '—'} · Price: GHS ${price.toFixed(2)}`,
          actor: activityActor,
          createdAt: serverTimestamp(),
        })
      } catch (activityError) {
        console.warn('[activity] Failed to log product creation', activityError)
      }

      setProducts(prev =>
        prev.map(product =>
          product.id === optimisticProduct!.id
            ? { ...product, id: ref.id, __optimistic: false }
            : product,
        ),
      )
      setCreateStatus({
        tone: 'success',
        message: itemType === 'service'
          ? 'Service created successfully.'
          : 'Product created successfully.',
      })
      resetCreateForm()
    } catch (error) {
      console.error('[products] Failed to create product', error)
      if (isOfflineError(error) && optimisticProduct) {
        setProducts(prev =>
          prev.map(product =>
            product.id === optimisticProduct?.id
              ? { ...product, __optimistic: true, storeId: activeStoreId }
              : product,
          ),
        )
        setCreateStatus({
          tone: 'success',
          message:
            'Offline — item saved locally and will sync when you reconnect.',
        })
        return
      }
      if (optimisticProduct) {
        setProducts(prev =>
          prev.filter(product => product.id !== optimisticProduct?.id),
        )
      }
      setCreateStatus({
        tone: 'error',
        message: 'Unable to create item. Please try again.',
      })
    } finally {
      setIsCreating(false)
    }
  }

  async function handleUpdateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSubscriptionInactive) {
      setEditStatus({
        tone: 'error',
        message: 'Your subscription is inactive. Resume it to edit items.',
      })
      return
    }

    if (!editingProductId) {
      setEditStatus({
        tone: 'error',
        message: 'Select an item to edit before saving.',
      })
      return
    }
    const name = editForm.name.trim()
    const sku = editForm.sku.trim()
    const itemType = (editForm.itemType as 'product' | 'service') || 'product'
    const price = parsePriceInput(editForm.price)
    const reorderLevel = validateNumbers(editForm.reorderLevel)
    const durationMinutes = validateDuration(editForm.durationMinutes)
    const defaultStaffTag = editForm.defaultStaffTag.trim() || ''

    if (!name) {
      setEditStatus({
        tone: 'error',
        message: 'Name your item so staff know what to pick.',
      })
      return
    }
    if (price === null) {
      setEditStatus({
        tone: 'error',
        message: 'Enter a valid price that is zero or greater.',
      })
      return
    }
    if (!sku) {
      setEditStatus({
        tone: 'error',
        message:
          'Every item needs a SKU so you can search or scan it quickly.',
      })
      return
    }
    if (editForm.reorderLevel && reorderLevel === null) {
      setEditStatus({
        tone: 'error',
        message:
          'Enter a valid reorder point that is zero or greater.',
      })
      return
    }

    if (!activeStoreId) {
      setEditStatus({
        tone: 'error',
        message: 'Select a workspace before updating items.',
      })
      return
    }

    const previous = products.find(product => product.id === editingProductId)
    if (!previous) {
      setEditStatus({
        tone: 'error',
        message: 'We could not find this item to update.',
      })
      return
    }

    const updatedValues: Partial<ProductRecord> = {
      name,
      price,
      sku,
      itemType,
      durationMinutes: durationMinutes ?? null,
      defaultStaffTag: defaultStaffTag || null,
      reorderLevel: itemType === 'product' ? reorderLevel ?? null : null,
      updatedAt: new Date(),
      storeId: activeStoreId,
    }

    setIsUpdating(true)
    setEditStatus(null)
    setProducts(prev =>
      sortProducts(
        prev.map(product =>
          product.id === editingProductId
            ? { ...product, ...updatedValues, __optimistic: true }
            : product,
        ),
      ),
    )

    try {
      await updateDoc(doc(collection(db, 'products'), editingProductId), {
        name,
        price,
        sku,
        itemType,
        durationMinutes: durationMinutes ?? null,
        defaultStaffTag: defaultStaffTag || null,
        reorderLevel: itemType === 'product' ? reorderLevel ?? null : null,
        reorderThreshold: itemType === 'product' ? reorderLevel ?? null : null,
        storeId: activeStoreId,
        updatedAt: serverTimestamp(),
      })
      try {
        await addDoc(collection(db, 'activity'), {
          storeId: activeStoreId,
          type: 'inventory',
          summary: `Updated ${itemType === 'service' ? 'service' : 'product'} ${name}`,
          detail: `SKU: ${sku || '—'} · Price: GHS ${price.toFixed(2)}`,
          actor: activityActor,
          createdAt: serverTimestamp(),
        })
      } catch (activityError) {
        console.warn('[activity] Failed to log product update', activityError)
      }
      setEditStatus({
        tone: 'success',
        message: 'Item details updated.',
      })
      setProducts(prev =>
        prev.map(product =>
          product.id === editingProductId
            ? { ...product, __optimistic: false }
            : product,
        ),
      )
      setEditingProductId(null)
    } catch (error) {
      console.error('[products] Failed to update product', error)
      setProducts(prev =>
        prev.map(product =>
          product.id === editingProductId ? previous : product,
        ),
      )
      if (isOfflineError(error)) {
        setEditStatus({
          tone: 'success',
          message:
            'Offline — item edits saved and will sync when you reconnect.',
        })
        setEditingProductId(null)
        return
      }
      setEditStatus({
        tone: 'error',
        message: 'Unable to update item. Please try again.',
      })
    } finally {
      setIsUpdating(false)
    }
  }

  function renderStatus(status: StatusState | null) {
    if (!status) return null
    return (
      <div
        className={`products-page__status products-page__status--${status.tone}`}
        role="status"
      >
        {status.message}
      </div>
    )
  }

  // ✅ Only show the big error banner when there is an error AND
  // we’re not loading AND there’s no data to show.
  const hasBlockingError =
    !!loadError && !isLoadingProducts && filteredProducts.length === 0

  return (
    <div className="page products-page">
      <SubscriptionBanner subscription={subscription} />

      {isSubscriptionInactive ? (
        <div className="products-page__restriction" role="alert">
          Your subscription is inactive. You can browse items but cannot add
          or edit them until you restart your plan.
        </div>
      ) : null}

      <header className="page__header">
        <div>
          <h2 className="page__title">Products & services</h2>
          <p className="page__subtitle">
            Review inventory, monitor low stock alerts, and keep your catalogue
            of items and services tidy.
          </p>
        </div>
        <Link to="/receive" className="products-page__receive-link">
          Receive stock
        </Link>
      </header>

      <section className="card products-page__card">
        <div className="products-page__toolbar">
          <label className="products-page__search">
            <span className="products-page__search-label">Search</span>
            <input
              type="search"
              placeholder="Search by name or SKU"
              value={filterText}
              onChange={event => setFilterText(event.target.value)}
            />
          </label>
          <div className="products-page__toolbar-actions">
            <label className="products-page__filter">
              <input
                type="checkbox"
                checked={showLowStockOnly}
                onChange={event => setShowLowStockOnly(event.target.checked)}
              />
              <span className="products-page__filter-label">
                Show low stock only
                {lowStockCount ? (
                  <span className="products-page__pill">{lowStockCount}</span>
                ) : null}
              </span>
            </label>

            <div className="products-page__export">
              <button
                type="button"
                className="products-page__export-button"
                onClick={handleExportReorderList}
                disabled={isExporting || isLoadingProducts}
              >
                {isExporting ? 'Preparing…' : 'Download reorder list'}
              </button>
              <div className="products-page__export-meta">
                Last export: {formatLastExportedAt(lastExportedAt)}
              </div>
            </div>
          </div>
        </div>

        {lowStockCount ? (
          <div className="products-page__low-stock-alert" role="status">
            <strong>{lowStockCount} item{lowStockCount === 1 ? '' : 's'}</strong>{' '}
            at or below the reorder point. Download the reorder list to restock
            before you run out.
          </div>
        ) : null}

        {renderStatus(exportStatus)}

        {hasBlockingError ? (
          <div className="products-page__error">{loadError}</div>
        ) : null}

        {isLoadingProducts ? (
          <div className="products-page__loading">Loading items…</div>
        ) : null}

        {!isLoadingProducts && filteredProducts.length === 0 && !hasBlockingError ? (
          <div className="products-page__empty" role="status">
            No items found. Add your first product or service so you can track it.
          </div>
        ) : null}

        {filteredProducts.length > 0 ? (
          <div className="products-page__table-wrapper">
            <table className="products-page__table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Type</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Price</th>
                  <th scope="col">On hand</th>
                  <th scope="col">Reorder point</th>
                  <th scope="col">Last receipt</th>
                  <th scope="col" className="products-page__actions">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(product => {
                  const itemType = product.itemType ?? 'product'
                  const stockCount =
                    itemType === 'product' &&
                    typeof product.stockCount === 'number'
                      ? product.stockCount
                      : null
                  const reorderLevel =
                    itemType === 'product' &&
                    typeof product.reorderLevel === 'number'
                      ? product.reorderLevel
                      : null
                  const isLowStock =
                    itemType === 'product' &&
                    reorderLevel !== null &&
                    stockCount !== null &&
                    stockCount <= reorderLevel
                  const isOutOfStock =
                    itemType === 'product' && stockCount === 0
                  const lastReceived = toDate(product.lastReceipt?.receivedAt)
                  const lastReceivedLabel = lastReceived
                    ? `Last received ${lastReceived.toLocaleDateString()} ${lastReceived.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'No receipt recorded yet'
                  return (
                    <tr
                      id={`product-${product.id}`}
                      key={product.id}
                      data-testid={`product-row-${product.id}`}
                    >
                      <th scope="row">
                        <div className="products-page__product-name">
                          <div className="products-page__product-name-row">
                            {product.name}
                            {itemType === 'service' && (
                              <span className="products-page__badge products-page__badge--service">
                                Service
                              </span>
                            )}
                            {product.__optimistic ? (
                              <span className="products-page__badge">
                                Syncing…
                              </span>
                            ) : null}
                            {isOutOfStock ? (
                              <span className="products-page__badge products-page__badge--danger">
                                Out of stock
                              </span>
                            ) : null}
                            {isLowStock ? (
                              <span className="products-page__badge products-page__badge--alert">
                                Low stock
                              </span>
                            ) : null}
                          </div>
                          <div
                            className="products-page__product-meta"
                            title={formatReceiptDetails(product.lastReceipt)}
                          >
                            {lastReceivedLabel}
                          </div>
                        </div>
                      </th>
                      <td>{itemType === 'service' ? 'Service' : 'Product'}</td>
                      <td>{product.sku || '—'}</td>
                      <td>
                        {typeof product.price === 'number' &&
                        Number.isFinite(product.price)
                          ? `GHS ${product.price.toFixed(2)}`
                          : '—'}
                      </td>
                      <td>{itemType === 'product' ? stockCount ?? 0 : '—'}</td>
                      <td>{itemType === 'product' ? reorderLevel ?? '—' : '—'}</td>
                      <td>{formatReceiptDetails(product.lastReceipt)}</td>
                      <td className="products-page__actions">
                        <button
                          type="button"
                          className="products-page__edit-button"
                          disabled={isSubscriptionInactive}
                          onClick={() => setEditingProductId(product.id)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card products-page__card">
        <h3 className="card__title">Add item</h3>
        <p className="card__subtitle">
          Capture both physical products and services you offer so sales and
          records stay accurate.
        </p>
        <form className="products-page__form" onSubmit={handleCreateProduct}>
          <fieldset className="products-page__fieldset" disabled={isSubscriptionInactive}>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                name="name"
                autoFocus
                value={createForm.name}
                onChange={handleCreateFieldChange}
                placeholder="e.g. House Blend Coffee or Acrylic Nails"
                required
              />
            </label>

            <label className="field">
              <span className="field__label">Item type</span>
              <select
                name="itemType"
                value={createForm.itemType}
                onChange={handleCreateFieldChange}
              >
                <option value="product">Physical product</option>
                <option value="service">Service</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">SKU</span>
              <input
                name="sku"
                value={createForm.sku}
                onChange={handleCreateFieldChange}
                placeholder="Barcode or internal code"
                required
                aria-describedby="create-sku-hint"
              />
            </label>
            <p className="field__hint" id="create-sku-hint">
              If you scan barcodes, this should match the code. For services, you
              can enter any reference code you like.
            </p>

            <label className="field">
              <span className="field__label">Price</span>
              <input
                name="price"
                value={createForm.price}
                onChange={handleCreateFieldChange}
                placeholder="How much you sell it for"
                inputMode="decimal"
                required
              />
            </label>

            {createForm.itemType === 'product' && (
              <>
                <label className="field">
                  <span className="field__label">Reorder point</span>
                  <input
                    name="reorderLevel"
                    value={createForm.reorderLevel}
                    onChange={handleCreateFieldChange}
                    placeholder="Alert when stock drops to…"
                    inputMode="numeric"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Opening stock</span>
                  <input
                    name="initialStock"
                    value={createForm.initialStock}
                    onChange={handleCreateFieldChange}
                    placeholder="Quantity currently on hand"
                    inputMode="numeric"
                  />
                </label>
              </>
            )}

            {createForm.itemType === 'service' && (
              <>
                <label className="field">
                  <span className="field__label">Duration (minutes)</span>
                  <input
                    name="durationMinutes"
                    value={createForm.durationMinutes}
                    onChange={handleCreateFieldChange}
                    placeholder="e.g. 45"
                    inputMode="numeric"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Staff / category tag (optional)</span>
                  <input
                    name="defaultStaffTag"
                    value={createForm.defaultStaffTag}
                    onChange={handleCreateFieldChange}
                    placeholder="e.g. Nails, Hair, Makeup"
                  />
                </label>
              </>
            )}

            <button
              type="submit"
              className="products-page__submit"
              disabled={isCreating || isSubscriptionInactive}
            >
              {isCreating ? 'Saving…' : 'Add item'}
            </button>
            {renderStatus(createStatus)}
          </fieldset>
        </form>
      </section>

      {editingProductId ? (
        <div
          className="products-page__dialog"
          role="dialog"
          aria-modal="true"
        >
          <div className="products-page__dialog-content">
            <h3>Edit item</h3>
            <form className="products-page__form" onSubmit={handleUpdateProduct}>
              <fieldset className="products-page__fieldset" disabled={isSubscriptionInactive}>
                <label className="field">
                  <span className="field__label">Name</span>
                  <input
                    name="name"
                    autoFocus
                    value={editForm.name}
                    onChange={handleEditFieldChange}
                    required
                  />
                </label>

                <label className="field">
                  <span className="field__label">Item type</span>
                  <select
                    name="itemType"
                    value={editForm.itemType}
                    onChange={handleEditFieldChange}
                  >
                    <option value="product">Physical product</option>
                    <option value="service">Service</option>
                  </select>
                </label>

                <label className="field">
                  <span className="field__label">SKU</span>
                  <input
                    name="sku"
                    value={editForm.sku}
                    onChange={handleEditFieldChange}
                    required
                    aria-describedby="edit-sku-hint"
                  />
                </label>
                <p className="field__hint" id="edit-sku-hint">
                  Update the SKU to mirror the barcode or reference code you use.
                </p>

                <label className="field">
                  <span className="field__label">Price</span>
                  <input
                    name="price"
                    value={editForm.price}
                    onChange={handleEditFieldChange}
                    inputMode="decimal"
                    required
                  />
                </label>

                {editForm.itemType === 'product' && (
                  <label className="field">
                    <span className="field__label">Reorder point</span>
                    <input
                      name="reorderLevel"
                      value={editForm.reorderLevel}
                      onChange={handleEditFieldChange}
                      inputMode="numeric"
                    />
                  </label>
                )}

                {editForm.itemType === 'service' && (
                  <>
                    <label className="field">
                      <span className="field__label">Duration (minutes)</span>
                      <input
                        name="durationMinutes"
                        value={editForm.durationMinutes}
                        onChange={handleEditFieldChange}
                        inputMode="numeric"
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">
                        Staff / category tag (optional)
                      </span>
                      <input
                        name="defaultStaffTag"
                        value={editForm.defaultStaffTag}
                        onChange={handleEditFieldChange}
                      />
                    </label>
                  </>
                )}

                <div className="products-page__dialog-actions">
                  <button
                    type="button"
                    className="products-page__cancel"
                    onClick={handleCancelEdit}
                    disabled={isUpdating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="products-page__submit"
                    disabled={isUpdating || isSubscriptionInactive}
                  >
                    {isUpdating ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
                {renderStatus(editStatus)}
              </fieldset>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
