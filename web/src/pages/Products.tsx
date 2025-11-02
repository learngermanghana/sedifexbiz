import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  db,
  doc,
  deleteDoc,
  limit,
  onSnapshot,
  orderBy,
  rosterDb,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '../lib/db'
import type { FirebaseError } from 'firebase/app'
import { Link } from 'react-router-dom'

import { useActiveStore } from '../hooks/useActiveStore'
import {
  PRODUCT_CACHE_LIMIT,
  loadCachedProducts,
  saveCachedProducts,
} from '../utils/offlineCache'
import {
  listPendingProductOperations,
  queuePendingProductCreate,
  queuePendingProductUpdate,
  removePendingProductCreate,
  removePendingProductUpdate,
  replacePendingProductUpdateId,
} from '../utils/pendingProductQueue'
import './Products.css'

interface ReceiptDetails {
  qty?: number | null
  supplier?: string | null
  receivedAt?: unknown
}

export type ProductRecord = {
  id: string
  name: string
  price: number | null
  sku?: string | null
  stockCount?: number | null
  reorderThreshold?: number | null
  lastReceipt?: ReceiptDetails | null
  createdAt?: unknown
  updatedAt?: unknown
  storeId?: string | null
  workspaceId?: string | null
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

function sanitizeOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return null
}

const DEFAULT_CREATE_FORM = {
  name: '',
  sku: '',
  price: '',
  reorderThreshold: '',
  initialStock: '',
}

const DEFAULT_EDIT_FORM = {
  name: '',
  sku: '',
  price: '',
  reorderThreshold: '',
}

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
    const anyValue = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number; nanoseconds?: number }
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
      const millis = anyValue.seconds * 1000 + Math.round((anyValue.nanoseconds ?? 0) / 1_000_000)
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
    parts.push(`on ${receivedAt.toLocaleDateString()} ${receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  }
  if (!parts.length) {
    return 'Last receipt details unavailable'
  }
  return parts.join(' ')
}

function sortProducts(products: ProductRecord[]): ProductRecord[] {
  return [...products].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function isFirebaseError(error: unknown): error is FirebaseError & { code: string } {
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as { code?: unknown }
  return typeof candidate.code === 'string'
}

function isOfflineError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (isFirebaseError(error)) {
    const code = error.code.toLowerCase()
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
  const { storeId: activeStoreId, workspaceId: activeWorkspaceId } = useActiveStore()
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [isLoadingProducts, setIsLoadingProducts] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const rosterSyncSignatureRef = useRef<string | null>(null)
  const isSyncingPendingRef = useRef(false)
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM)
  const [createStatus, setCreateStatus] = useState<StatusState | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editForm, setEditForm] = useState(DEFAULT_EDIT_FORM)
  const [editStatus, setEditStatus] = useState<StatusState | null>(null)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const persistRosterSnapshot = useCallback(
    async (storeId: string, snapshotProducts: ProductRecord[]) => {
      if (!storeId) return

      const rosterItems = snapshotProducts.map(product => ({
        id: product.id,
        name: product.name ?? null,
        sku: product.sku ?? null,
        price: sanitizePrice(product.price),
        stockCount: sanitizeOptionalNumber(product.stockCount),
        reorderThreshold: sanitizeOptionalNumber(product.reorderThreshold),
        createdAt: product.createdAt ?? null,
        updatedAt: product.updatedAt ?? null,
        lastReceipt: product.lastReceipt ?? null,
        status: product.__optimistic ? 'pending' : 'confirmed',
      }))

      const signature = JSON.stringify(
        rosterItems.map(item => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          price: item.price,
          stockCount: item.stockCount,
          reorderThreshold: item.reorderThreshold,
          status: item.status,
        })),
      )

      if (rosterSyncSignatureRef.current === signature) {
        return
      }

      rosterSyncSignatureRef.current = signature

      try {
        await setDoc(
          doc(rosterDb, 'inventorySnapshots', storeId),
          {
            storeId,
            workspaceId: storeId,
            totalSkus: rosterItems.length,
            pendingSkus: rosterItems.filter(item => item.status === 'pending').length,
            items: rosterItems,
            syncedAt: serverTimestamp(),
            capturedAt: new Date().toISOString(),
          },
          { merge: true },
        )
      } catch (error) {
        rosterSyncSignatureRef.current = null
        console.warn('[products] Failed to persist roster inventory snapshot', error)
      }
    },
    [],
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const isModifierPressed = event.ctrlKey || event.metaKey
      if (!isModifierPressed || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'f') return

      const input = searchInputRef.current
      if (!input) return

      event.preventDefault()
      input.focus()
      input.select()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const optimisticSignature = useMemo(() => {
    if (!activeStoreId) return ''
    const ids = products
      .filter(product => product.__optimistic && product.storeId === activeStoreId)
      .map(product => product.id)
    ids.sort()
    return ids.join('|')
  }, [activeStoreId, products])

  useEffect(() => {
    let cancelled = false
    setLoadError(null)

    if (!activeStoreId || !activeWorkspaceId) {
      setProducts([])
      setIsLoadingProducts(false)
      return () => {
        cancelled = true
      }
    }

    setIsLoadingProducts(true)

    loadCachedProducts<Omit<ProductRecord, '__optimistic'>>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          setProducts(prev => {
            const optimistic = prev.filter(
              item => item.__optimistic && item.storeId === activeStoreId,
            )
            const sanitized = cached.map(item => ({
              ...(item as ProductRecord),
              price: sanitizePrice((item as ProductRecord).price),
              __optimistic: false,
              storeId: activeStoreId,
              workspaceId: activeWorkspaceId,
            }))
            return sortProducts([...sanitized, ...optimistic])
          })
          setIsLoadingProducts(false)
        }
      })
      .catch(error => {
        console.warn('[products] Failed to load cached products', error)
      })


    const productsCollection = collection(db, 'workspaces', activeWorkspaceId, 'products')
    const q = query(
      productsCollection,

      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      snapshot => {
        if (cancelled) return
        const rows = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...(docSnap.data() as Record<string, unknown>),
          __optimistic: docSnap.metadata.hasPendingWrites,
        }))
        const sanitizedRows = rows.map(row => ({
          ...(row as ProductRecord),
          price: sanitizePrice((row as ProductRecord).price),
          storeId: activeStoreId,

          workspaceId: activeWorkspaceId,
          __optimistic: false,

        }))
        saveCachedProducts(sanitizedRows, { storeId: activeStoreId }).catch(error => {
          console.warn('[products] Failed to cache products', error)
        })
        void persistRosterSnapshot(activeStoreId, sanitizedRows)
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
  }, [activeStoreId, activeWorkspaceId])

  useEffect(() => {
    if (!editingProductId) {
      setEditForm(DEFAULT_EDIT_FORM)
      return
    }
    const product = products.find(item => item.id === editingProductId)
    if (!product) return
    setEditForm({
      name: product.name ?? '',
      sku: product.sku ?? '',
      price:
        typeof product.price === 'number' && Number.isFinite(product.price)
          ? String(product.price)
          : '',
      reorderThreshold:
        typeof product.reorderThreshold === 'number' && Number.isFinite(product.reorderThreshold)
          ? String(product.reorderThreshold)
          : '',
    })
  }, [editingProductId, products])

  const filteredProducts = useMemo(() => {
    const normalizedQuery = filterText.trim().toLowerCase()
    return sortProducts(
      products.filter(product => {
        const stockCount = typeof product.stockCount === 'number' ? product.stockCount : 0
        const reorder = typeof product.reorderThreshold === 'number' ? product.reorderThreshold : null
        const matchesLowStock = !showLowStockOnly || (reorder !== null && stockCount <= reorder)
        if (!matchesLowStock) return false
        if (!normalizedQuery) return true
        const haystack = `${product.name ?? ''} ${product.sku ?? ''}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      }),
    )
  }, [filterText, products, showLowStockOnly])

  function handleCreateFieldChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = event.target
    setCreateForm(prev => ({ ...prev, [name]: value }))
  }

  function handleEditFieldChange(event: React.ChangeEvent<HTMLInputElement>) {
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

  function parsePriceInput(value: string) {
    if (!value.trim()) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    if (parsed < 0) return null
    return parsed
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = createForm.name.trim()
    const sku = createForm.sku.trim()
    const price = parsePriceInput(createForm.price)
    const reorderThreshold = validateNumbers(createForm.reorderThreshold)
    const initialStock = validateNumbers(createForm.initialStock)

    if (!name) {
      setCreateStatus({ tone: 'error', message: 'Name your product so the team recognises it on the shelf.' })
      return
    }
    if (price === null) {
      setCreateStatus({ tone: 'error', message: 'Enter a valid price that is zero or greater.' })
      return
    }
    if (!sku) {
      setCreateStatus({
        tone: 'error',
        message: 'Add a SKU that matches the barcode so you can scan it during checkout.',
      })
      return
    }
    if (createForm.reorderThreshold && reorderThreshold === null) {
      setCreateStatus({ tone: 'error', message: 'Enter a valid reorder point that is zero or greater.' })
      return
    }
    if (createForm.initialStock && initialStock === null) {
      setCreateStatus({ tone: 'error', message: 'Enter a valid opening stock that is zero or greater.' })
      return
    }

    if (!activeStoreId || !activeWorkspaceId) {
      setCreateStatus({ tone: 'error', message: 'Select a workspace before adding products.' })
      return
    }

    const optimisticProduct: ProductRecord = {
      id: `optimistic-${Date.now()}`,
      name,
      price,
      sku,
      reorderThreshold: reorderThreshold ?? null,
      stockCount: initialStock ?? 0,
      lastReceipt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      storeId: activeStoreId,

      workspaceId: activeWorkspaceId,

      __optimistic: true,
    }

    setIsCreating(true)
    setCreateStatus(null)
    setProducts(prev => sortProducts([optimisticProduct, ...prev]))
    void persistRosterSnapshot(activeStoreId, [optimisticProduct])

    try {

      const ref = await addDoc(collection(db, 'workspaces', activeWorkspaceId, 'products'), {

        name,
        price,
        sku,
        reorderThreshold: reorderThreshold ?? null,
        stockCount: initialStock ?? 0,
        storeId: activeStoreId,
        workspaceId: activeWorkspaceId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      setProducts(prev =>
        prev.map(product =>
          product.id === optimisticProduct.id
            ? { ...product, id: ref.id, __optimistic: false }
            : product,
        ),
      )
      setCreateStatus({ tone: 'success', message: 'Product created successfully.' })
      resetCreateForm()
    } catch (error) {
      console.error('[products] Failed to create product', error)
      if (isOfflineError(error)) {
        let queued = false
        try {
          await queuePendingProductCreate({
            clientId: optimisticProduct.id,
            storeId: activeStoreId,
            name,
            sku,
            price,
            reorderThreshold: reorderThreshold ?? null,
            stockCount: initialStock ?? 0,
          })
          queued = true
        } catch (queueError) {
          console.warn('[products] Failed to queue product create for retry', queueError)
        }
        if (queued) {
          setProducts(prev =>
            prev.map(product =>
              product.id === optimisticProduct.id
                ? { ...product, __optimistic: true, storeId: activeStoreId }
                : product,
            ),
          )
          setCreateStatus({
            tone: 'success',
            message: 'Offline — product saved locally and will sync when you reconnect.',
          })
          return
        }
        setProducts(prev => prev.filter(product => product.id !== optimisticProduct.id))
        setCreateStatus({
          tone: 'error',
          message: 'Unable to create product while offline. Please try again when you reconnect.',
        })
        return
      }
      setProducts(prev => prev.filter(product => product.id !== optimisticProduct.id))
      setCreateStatus({ tone: 'error', message: 'Unable to create product. Please try again.' })
    } finally {
      setIsCreating(false)
    }
  }

  async function handleUpdateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingProductId) {
      setEditStatus({ tone: 'error', message: 'Select a product to edit before saving.' })
      return
    }
    const name = editForm.name.trim()
    const sku = editForm.sku.trim()
    const price = parsePriceInput(editForm.price)
    const reorderThreshold = validateNumbers(editForm.reorderThreshold)

    if (!name) {
      setEditStatus({ tone: 'error', message: 'Name your product so staff know what to pick.' })
      return
    }
    if (price === null) {
      setEditStatus({ tone: 'error', message: 'Enter a valid price that is zero or greater.' })
      return
    }
    if (!sku) {
      setEditStatus({
        tone: 'error',
        message: 'Every product needs a SKU that matches its barcode for scanning.',
      })
      return
    }
    if (editForm.reorderThreshold && reorderThreshold === null) {
      setEditStatus({ tone: 'error', message: 'Enter a valid reorder point that is zero or greater.' })
      return
    }

    if (!activeStoreId || !activeWorkspaceId) {
      setEditStatus({ tone: 'error', message: 'Select a workspace before updating products.' })
      return
    }

    const previous = products.find(product => product.id === editingProductId)
    if (!previous) {
      setEditStatus({ tone: 'error', message: 'We could not find this product to update.' })
      return
    }

    const updatedValues: Partial<ProductRecord> = {
      name,
      price,
      sku,
      reorderThreshold: reorderThreshold ?? null,
      updatedAt: new Date(),
      storeId: activeStoreId,
      workspaceId: activeStoreId,
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

      await updateDoc(doc(collection(db, 'workspaces', activeWorkspaceId, 'products'), editingProductId), {

        name,
        price,
        sku,
        reorderThreshold: reorderThreshold ?? null,
        storeId: activeStoreId,
        workspaceId: activeWorkspaceId,
        updatedAt: serverTimestamp(),
      })
      setEditStatus({ tone: 'success', message: 'Product details updated.' })
      setProducts(prev =>
        prev.map(product =>
          product.id === editingProductId ? { ...product, __optimistic: false } : product,
        ),
      )
      const updatedProduct = { ...previous, ...updatedValues, __optimistic: false } as ProductRecord
      void persistRosterSnapshot(activeStoreId, [updatedProduct])
      setEditingProductId(null)
    } catch (error) {
      console.error('[products] Failed to update product', error)
      if (isOfflineError(error)) {
        let queued = false
        try {
          await queuePendingProductUpdate({
            productId: editingProductId,
            storeId: activeStoreId,
            name,
            sku,
            price,
            reorderThreshold: reorderThreshold ?? null,
            previous: {
              name: previous.name ?? '',
              sku: previous.sku ?? '',
              price: sanitizePrice(previous.price),
              reorderThreshold: sanitizeOptionalNumber(previous.reorderThreshold),
            },
          })
          queued = true
        } catch (queueError) {
          console.warn('[products] Failed to queue product update for retry', queueError)
        }
        if (queued) {
          setEditStatus({
            tone: 'success',
            message: 'Offline — product edits saved and will sync when you reconnect.',
          })
          setEditingProductId(null)
          return
        }
        setProducts(prev =>
          prev.map(product => (product.id === editingProductId ? previous : product)),
        )
        setEditStatus({
          tone: 'error',
          message: 'Unable to update product while offline. Please try again when you reconnect.',
        })
        return
      }
      setProducts(prev => prev.map(product => (product.id === editingProductId ? previous : product)))
      setEditStatus({ tone: 'error', message: 'Unable to update product. Please try again.' })
    } finally {
      setIsUpdating(false)
    }
  }

  async function handleDeleteProduct() {
    if (!editingProductId) {
      setEditStatus({ tone: 'error', message: 'Select a product to delete before removing.' })
      return
    }

    const product = products.find(item => item.id === editingProductId)
    if (!product) {
      setEditStatus({ tone: 'error', message: 'We could not find this product to delete.' })
      return
    }

    if (!activeStoreId || !activeWorkspaceId) {
      setEditStatus({ tone: 'error', message: 'Select a workspace before deleting products.' })
      return
    }

    const confirmed = typeof window !== 'undefined' ? window.confirm('Delete this product?') : true
    if (!confirmed) return

    setIsDeleting(true)
    setEditStatus(null)

    try {
      await deleteDoc(
        doc(collection(db, 'workspaces', activeWorkspaceId, 'products'), editingProductId),
      )
      setProducts(prev => {
        const next = prev.filter(item => item.id !== editingProductId)
        void persistRosterSnapshot(activeStoreId, next)
        return next
      })
      setEditStatus({ tone: 'success', message: 'Product deleted.' })
      setEditingProductId(null)
    } catch (error) {
      console.error('[products] Failed to delete product', error)
      if (isOfflineError(error)) {
        setEditStatus({
          tone: 'error',
          message: 'Unable to delete product while offline. Please try again when you reconnect.',
        })
        return
      }
      setEditStatus({ tone: 'error', message: 'Unable to delete product. Please try again.' })
    } finally {
      setIsDeleting(false)
    }
  }

  useEffect(() => {
    if (!activeStoreId || !activeWorkspaceId) return

    let cancelled = false

    const syncPendingOperations = async () => {
      if (isSyncingPendingRef.current) return
      isSyncingPendingRef.current = true

      try {
        const operations = await listPendingProductOperations(activeStoreId)
        if (cancelled || operations.length === 0) return

        const ordered = [...operations].sort((a, b) => a.createdAt - b.createdAt)

        for (const operation of ordered) {
          if (cancelled) return

          if (operation.kind === 'create') {
            try {
              const ref = await addDoc(
                collection(db, 'workspaces', activeWorkspaceId, 'products'),
                {
                  name: operation.name,
                  price: operation.price,
                  sku: operation.sku,
                  reorderThreshold: operation.reorderThreshold,
                  stockCount: operation.stockCount ?? 0,
                  storeId: operation.storeId,
                  workspaceId: activeWorkspaceId,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                },
              )
              if (cancelled) return
              await removePendingProductCreate(operation.clientId, operation.storeId)
              await replacePendingProductUpdateId(operation.clientId, ref.id, operation.storeId)
              for (const pendingOperation of ordered) {
                if (
                  pendingOperation.kind === 'update' &&
                  pendingOperation.storeId === operation.storeId &&
                  pendingOperation.productId === operation.clientId
                ) {
                  pendingOperation.productId = ref.id
                }
              }
              let syncedProduct: ProductRecord | null = null
              let found = false
              setProducts(prev => {
                const mapped = prev.map(product => {
                  if (product.id === operation.clientId) {
                    found = true
                    const updatedProduct = {
                      ...product,
                      id: ref.id,
                      name: operation.name,
                      sku: operation.sku,
                      price: operation.price,
                      reorderThreshold: operation.reorderThreshold,
                      stockCount:
                        typeof operation.stockCount === 'number'
                          ? operation.stockCount
                          : typeof product.stockCount === 'number'
                            ? product.stockCount
                            : 0,
                      storeId: operation.storeId,
                      workspaceId: activeWorkspaceId,
                      __optimistic: false,
                      updatedAt: new Date(),
                    } as ProductRecord
                    syncedProduct = updatedProduct
                    return updatedProduct
                  }
                  return product
                })
                if (!found) {
                  return prev
                }
                return sortProducts(mapped)
              })
              if (!found) {
                syncedProduct = {
                  id: ref.id,
                  name: operation.name,
                  sku: operation.sku,
                  price: operation.price,
                  reorderThreshold: operation.reorderThreshold,
                  stockCount: typeof operation.stockCount === 'number' ? operation.stockCount : 0,
                  storeId: operation.storeId,
                  workspaceId: activeWorkspaceId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  lastReceipt: null,
                  __optimistic: false,
                }
              }
              if (syncedProduct) {
                void persistRosterSnapshot(operation.storeId, [syncedProduct])
              }
            } catch (error) {
              if (isOfflineError(error)) {
                break
              }
              await removePendingProductCreate(operation.clientId, operation.storeId)
              setProducts(prev => prev.filter(product => product.id !== operation.clientId))
              setCreateStatus({ tone: 'error', message: 'Unable to create product. Please try again.' })
            }
            continue
          }

          if (operation.kind === 'update') {
            try {
              await updateDoc(
                doc(collection(db, 'workspaces', activeWorkspaceId, 'products'), operation.productId),
                {
                  name: operation.name,
                  price: operation.price,
                  sku: operation.sku,
                  reorderThreshold: operation.reorderThreshold,
                  storeId: operation.storeId,
                  updatedAt: serverTimestamp(),
                },
              )
              if (cancelled) return
              await removePendingProductUpdate(operation.productId, operation.storeId)
              let syncedProduct: ProductRecord | null = null
              setProducts(prev => {
                const mapped = prev.map(product => {
                  if (product.id === operation.productId) {
                    const updatedProduct = {
                      ...product,
                      name: operation.name,
                      sku: operation.sku,
                      price: operation.price,
                      reorderThreshold: operation.reorderThreshold,
                      __optimistic: false,
                      updatedAt: new Date(),
                    } as ProductRecord
                    syncedProduct = updatedProduct
                    return updatedProduct
                  }
                  return product
                })
                return sortProducts(mapped)
              })
              if (syncedProduct) {
                void persistRosterSnapshot(operation.storeId, [syncedProduct])
              }
            } catch (error) {
              if (isOfflineError(error)) {
                break
              }
              await removePendingProductUpdate(operation.productId, operation.storeId)
              setProducts(prev =>
                sortProducts(
                  prev.map(product => {
                    if (product.id === operation.productId) {
                      return {
                        ...product,
                        name: operation.previous.name,
                        sku: operation.previous.sku,
                        price: operation.previous.price,
                        reorderThreshold: operation.previous.reorderThreshold,
                        __optimistic: false,
                      }
                    }
                    return product
                  }),
                ),
              )
              setEditStatus({ tone: 'error', message: 'Unable to update product. Please try again.' })
            }
          }
        }
      } finally {
        isSyncingPendingRef.current = false
      }
    }

    void syncPendingOperations()

    function handleOnline() {
      void syncPendingOperations()
    }

    window.addEventListener('online', handleOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
    }
  }, [activeStoreId, activeWorkspaceId, optimisticSignature, persistRosterSnapshot, products])

  useEffect(() => {
    if (!activeStoreId) return
    void persistRosterSnapshot(activeStoreId, products)
  }, [activeStoreId, products, persistRosterSnapshot])

  function renderStatus(status: StatusState | null) {
    if (!status) return null
    return (
      <div className={`products-page__status products-page__status--${status.tone}`} role="status">
        {status.message}
      </div>
    )
  }

  return (
    <div className="page products-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Products</h2>
          <p className="page__subtitle">
            Review inventory, monitor low stock alerts, and keep your catalogue tidy.
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
              placeholder="Search by product or SKU"
              value={filterText}
              onChange={event => setFilterText(event.target.value)}
              ref={searchInputRef}
            />
          </label>
          <label className="products-page__filter">
            <input
              type="checkbox"
              checked={showLowStockOnly}
              onChange={event => setShowLowStockOnly(event.target.checked)}
            />
            <span>Show low stock only</span>
          </label>
        </div>
        {loadError ? <div className="products-page__error">{loadError}</div> : null}
        {isLoadingProducts ? <div className="products-page__loading">Loading products…</div> : null}
        {!isLoadingProducts && filteredProducts.length === 0 ? (
          <div className="products-page__empty" role="status">
            No products found. Add your first item so you can track inventory.
          </div>
        ) : null}
        {filteredProducts.length > 0 ? (
          <div className="products-page__table-wrapper">
            <table className="products-page__table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Price</th>
                  <th scope="col">On hand</th>
                  <th scope="col">Reorder point</th>
                  <th scope="col">Last receipt</th>
                  <th scope="col" className="products-page__actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map(product => {
                  const stockCount = typeof product.stockCount === 'number' ? product.stockCount : 0
                  const reorderThreshold =
                    typeof product.reorderThreshold === 'number' ? product.reorderThreshold : null
                  const isLowStock = reorderThreshold !== null && stockCount <= reorderThreshold
                  return (
                    <tr key={product.id} data-testid={`product-row-${product.id}`}>
                      <th scope="row">
                        <div className="products-page__product-name">
                          {product.name}
                          {product.__optimistic ? (
                            <span className="products-page__badge">Syncing…</span>
                          ) : null}
                          {isLowStock ? (
                            <span className="products-page__badge products-page__badge--alert">Low stock</span>
                          ) : null}
                        </div>
                      </th>
                      <td>{product.sku || '—'}</td>
                      <td>{
                        typeof product.price === 'number' && Number.isFinite(product.price)
                          ? `GHS ${product.price.toFixed(2)}`
                          : '—'
                      }</td>
                      <td>{stockCount}</td>
                      <td>{reorderThreshold ?? '—'}</td>
                      <td>{formatReceiptDetails(product.lastReceipt)}</td>
                      <td className="products-page__actions">
                        <button
                          type="button"
                          className="products-page__edit-button"
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
        <h3 className="card__title">Add product</h3>
        <p className="card__subtitle">
          Capture items you stock so sales and receipts stay accurate. Give each one a SKU that
          matches the barcode you plan to scan at checkout.
        </p>
        <form className="products-page__form" onSubmit={handleCreateProduct}>
          <label className="field">
            <span className="field__label">Name</span>
            <input
              name="name"
              value={createForm.name}
              onChange={handleCreateFieldChange}
              placeholder="e.g. House Blend Coffee"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">SKU</span>
            <input
              name="sku"
              value={createForm.sku}
              onChange={handleCreateFieldChange}
              placeholder="Barcode or SKU"
              required
              aria-describedby="create-sku-hint"
            />
          </label>
          <p className="field__hint" id="create-sku-hint">
            This must match the value encoded in your barcode so cashiers can scan products.
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
          <label className="field">
            <span className="field__label">Reorder point</span>
            <input
              name="reorderThreshold"
              value={createForm.reorderThreshold}
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
          <button type="submit" className="products-page__submit" disabled={isCreating}>
            {isCreating ? 'Saving…' : 'Add product'}
          </button>
          {renderStatus(createStatus)}
        </form>
      </section>

      {editingProductId ? (
        <div className="products-page__dialog" role="dialog" aria-modal="true">
          <div className="products-page__dialog-content">
            <h3>Edit product</h3>
            <form className="products-page__form" onSubmit={handleUpdateProduct}>
              <label className="field">
                <span className="field__label">Name</span>
                <input
                  name="name"
                  value={editForm.name}
                  onChange={handleEditFieldChange}
                  required
                />
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
                Update the SKU to mirror the barcode if you need to reprint or relabel items.
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
              <label className="field">
                <span className="field__label">Reorder point</span>
                <input
                  name="reorderThreshold"
                  value={editForm.reorderThreshold}
                  onChange={handleEditFieldChange}
                  inputMode="numeric"
                />
              </label>
              <div className="products-page__dialog-actions">
                <button
                  type="button"
                  className="products-page__delete"
                  onClick={handleDeleteProduct}
                  disabled={isUpdating || isDeleting}
                >
                  {isDeleting ? 'Deleting…' : 'Delete product'}
                </button>
                <button
                  type="button"
                  className="products-page__cancel"
                  onClick={() => setEditingProductId(null)}
                  disabled={isUpdating || isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="products-page__submit"
                  disabled={isUpdating || isDeleting}
                >
                  {isUpdating ? 'Saving…' : 'Save changes'}
                </button>
              </div>
              {renderStatus(editStatus)}
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
