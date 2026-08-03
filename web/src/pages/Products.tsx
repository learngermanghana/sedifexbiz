import SafeFirebaseImage from '../components/SafeFirebaseImage'
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  where,
} from 'firebase/firestore'
import './Products.css'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'
import { useMemberships } from '../hooks/useMemberships'
import {
  PRODUCT_CACHE_LIMIT,
  loadCachedProducts,
  saveCachedProducts,
} from '../utils/offlineCache'
import {
  buildNextStoreBarcodeCode,
  buildStoreBarcodePrefix,
  normalizeBarcode,
} from '../utils/barcode'
import { useStorePreferences } from '../hooks/useStorePreferences'
import { useStoreBilling } from '../hooks/useStoreBilling'
import { useWorkspaceIdentity } from '../hooks/useWorkspaceIdentity'
import type { ItemType, Product } from '../types/product'
import { ProductImageUploadError, uploadProductImage } from '../api/productImageUpload'
import { requestAiAdvisor } from '../api/aiAdvisor'
import { useToast } from '../components/ToastProvider'
import { playSound } from '../utils/sound'
import { buildPromoSlug } from '../utils/promoSlug'
import { productMatchesSearch } from '../utils/productSearch'

type CachedProduct = Omit<Product, 'id'>
type AbcBucket = 'A' | 'B' | 'C'
type ProductTab = 'add' | 'search'
type SaleRecord = {
  id: string
  items: Array<{
    productId: string | null
    qty: number
    price: number
    type?: string | null
    isService?: boolean
  }>
}
type ProductStoreMeta = {
  storeName: string | null
  storePhone: string | null
  storeCity: string | null
  websiteLink: string | null
}
const EXACT_UPLOAD_LIMIT_HINT = 'Maximum upload size is 5 MB (5,242,880 bytes).'
const DEFAULT_PRODUCT_IMAGE_URL = 'https://storage.googleapis.com/sedifeximage/stores/Y5ivjrJUBtWl7KzoR0aVszFu1c93/logo.jpg?v=1775656136764'
const MAX_DESCRIPTION_WORDS = 500
type DescriptionTemplate = 'general' | 'skin-care' | 'food' | 'fashion' | 'electronics'
const DESCRIPTION_TEMPLATE_OPTIONS: Array<{ value: DescriptionTemplate; label: string }> = [
  { value: 'general', label: 'General product' },
  { value: 'skin-care', label: 'Skin Care' },
  { value: 'food', label: 'Food & Beverages' },
  { value: 'fashion', label: 'Fashion' },
  { value: 'electronics', label: 'Electronics' },
]
const SUGGESTED_PRODUCT_CATEGORIES = [
  'General Products',
  'Skin Supplements',
  'Skin Care',
  'Hair Care',
  'Weight',
  'Food & Beverages',
  'Household',
  'Baby Care',
  'Electronics',
  'Fashion',
] as const
const DEFAULT_PRODUCT_CATEGORY = 'General Products'

function buildDescriptionPrompt(input: {
  itemName: string
  itemType: ItemType
  category: string
  template: DescriptionTemplate
}): string {
  const templateLabel =
    DESCRIPTION_TEMPLATE_OPTIONS.find(option => option.value === input.template)?.label ??
    'General product'

  return [
    'Write one creative, customer-facing product description for a store listing.',
    `Template: ${templateLabel}.`,
    `Product name: ${input.itemName || 'Not provided'}.`,
    `Item type: ${input.itemType}.`,
    `Category: ${input.category || 'Not provided'}.`,
    'Use natural, simple English with a Ghana-friendly tone.',
    'Format exactly as:',
    '- One short opening paragraph.',
    '- Three benefit bullets, each starting with "-".',
    '- One line that starts with "Best for:".',
    '- One short call-to-action line.',
    `Keep it under ${MAX_DESCRIPTION_WORDS} words.`,
    'Return plain text only.',
  ].join(' ')
}

/**
 * Helpers
 */
function sanitizeNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

function sanitizeTaxRate(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

// Users type VAT as "15" -> save 0.15
function parseTaxInput(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const raw = Number(trimmed)
  if (!Number.isFinite(raw) || raw < 0) return null
  // if > 1, treat as percent, else decimal
  const rate = raw > 1 ? raw / 100 : raw
  return rate
}

function formatVat(taxRate?: number | null): string {
  if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate <= 0) {
    return '—'
  }
  return `${(taxRate * 100).toFixed(0)}%`
}

function countWords(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length
}

function renderDescriptionInline(text: string, keyPrefix: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    const key = `${keyPrefix}-part-${index}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    return <React.Fragment key={key}>{part}</React.Fragment>
  })
}

function renderProductDescription(description: string): React.ReactNode {
  const lines = description.split('\n')
  const content: React.ReactNode[] = []
  let pendingBullets: string[] = []
  let blockIndex = 0

  const flushBullets = () => {
    if (!pendingBullets.length) return
    const listKey = `description-list-${blockIndex}`
    content.push(
      <ul key={listKey} className="products-page__description-list">
        {pendingBullets.map((item, itemIndex) => (
          <li key={`${listKey}-item-${itemIndex}`}>
            {renderDescriptionInline(item, `${listKey}-${itemIndex}`)}
          </li>
        ))}
      </ul>,
    )
    pendingBullets = []
    blockIndex += 1
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushBullets()
      continue
    }

    if (line.startsWith('- ')) {
      pendingBullets.push(line.slice(2).trim())
      continue
    }

    flushBullets()
    const paragraphKey = `description-paragraph-${blockIndex}`
    content.push(
      <p key={paragraphKey} className="products-page__description-paragraph">
        {renderDescriptionInline(line, paragraphKey)}
      </p>,
    )
    blockIndex += 1
  }

  flushBullets()
  return content
}

function toFriendlyFormError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    switch (error.code) {
      case 'permission-denied':
        return 'You do not have permission to save this item for the selected store.'
      case 'unavailable':
        return 'We could not reach the server. Check your connection and try again.'
      case 'deadline-exceeded':
        return 'Saving took too long. Please try again.'
      case 'failed-precondition':
        return 'This item could not be saved right now. Refresh and try again.'
      default:
        break
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  try {
    if (typeof (value as any).toDate === 'function') {
      const d: Date = (value as any).toDate()
      return Number.isNaN(d.getTime()) ? null : d
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  } catch {
    return null
  }
  return null
}

function createDraftProductKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `draft-${crypto.randomUUID()}`
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function buildProductImagePath(storeId: string, productKey: string, slot: number = 0): string {
  const safeSlot = Math.min(Math.max(slot, 0), 2)
  return `stores/${storeId}/products/${productKey}-${safeSlot + 1}.jpg`
}

function mapFirestoreProduct(id: string, data: Record<string, unknown>): Product {
  const nameRaw = typeof data.name === 'string' ? data.name : ''
  const normalizedName = normalizeProductName(nameRaw)
  const skuRaw = typeof data.sku === 'string' ? data.sku : ''

  // 🔹 Prefer explicit barcode field; fall back to sku (for old data)
  const barcodeSource =
    typeof data.barcode === 'string'
      ? data.barcode
      : typeof data.sku === 'string'
        ? data.sku
        : ''

  const normalizedBarcode = normalizeBarcode(barcodeSource)

  const itemType = data.itemType === 'service' ? 'service' : 'product'
  const category = normalizeProductCategory(data.category)

  const expiryDate = toDate(data.expiryDate)
  const productionDate = toDate(data.productionDate)
  const manufacturerName = typeof data.manufacturerName === 'string' ? data.manufacturerName.trim() : ''
  const batchNumber = typeof data.batchNumber === 'string' ? data.batchNumber.trim() : ''
  const showOnReceipt = data.showOnReceipt === true
  const imageUrl = typeof data.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl.trim() : null
  const imageUrls = normalizeImageUrls(data.imageUrls, imageUrl)
  const imageAlt = typeof data.imageAlt === 'string' && data.imageAlt.trim() ? data.imageAlt.trim() : null
  const description = typeof data.description === 'string' && data.description.trim() ? data.description.trim() : null
  const reorderPoint = sanitizeNumber(
    data.reorderPoint ?? data.reorderLevel ?? (data as any).reorderThreshold ?? null,
  )

  return {
    id,
    name: normalizedName || 'Untitled item',
    category,
    description,
    sku: skuRaw.trim() || null,
    barcode: normalizedBarcode || null,
    price: sanitizeNumber(data.price) ?? null,
    costPrice: sanitizeNumber(data.costPrice) ?? null,
    stockCount: sanitizeNumber(data.stockCount),
    reorderPoint,
    itemType,
    imageUrl,
    imageUrls,
    imageAlt: imageUrl ? imageAlt || (normalizedName || 'Product image') : null,
    taxRate: sanitizeTaxRate(data.taxRate),
    expiryDate,
    productionDate,
    manufacturerName: manufacturerName || null,
    batchNumber: batchNumber || null,
    showOnReceipt,
    lastReceiptAt: data.lastReceiptAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    sortOrder: sanitizeNumber(data.sortOrder),
  }
}

const BACKFILLED_PRODUCTS = new Set<string>()

async function backfillProductDefaults(
  productId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (BACKFILLED_PRODUCTS.has(productId)) return

  const updates: Record<string, unknown> = {}
  if (!('manufacturerName' in data)) updates.manufacturerName = null
  if (!('productionDate' in data)) updates.productionDate = null
  if (!('batchNumber' in data)) updates.batchNumber = null
  if (!('showOnReceipt' in data)) updates.showOnReceipt = false
  const existingImageUrl = typeof data.imageUrl === 'string' && data.imageUrl.trim() ? data.imageUrl.trim() : null
  const existingImageUrlFromList = Array.isArray(data.imageUrls)
    ? data.imageUrls.find((item): item is string => typeof item === 'string' && item.trim().length > 0) ?? null
    : null
  const resolvedImageUrl = existingImageUrl ?? existingImageUrlFromList

  if (!('imageUrl' in data) || !existingImageUrl) {
    updates.imageUrl = resolvedImageUrl || DEFAULT_PRODUCT_IMAGE_URL
  }

  if (!('imageUrls' in data)) {
    updates.imageUrls = resolvedImageUrl ? [resolvedImageUrl] : [DEFAULT_PRODUCT_IMAGE_URL]
  }

  if (!('imageAlt' in data) && resolvedImageUrl) {
    updates.imageAlt = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null
  }

  if (typeof data.name === 'string') {
    const normalizedProductName = normalizeProductName(data.name)
    if (normalizedProductName && normalizedProductName !== data.name.trim()) {
      updates.name = normalizedProductName
    }
  }
  if (shouldBackfillCategory(data.category)) {
    updates.category = normalizeProductCategory(data.category)
  }

  if (!Object.keys(updates).length) return

  BACKFILLED_PRODUCTS.add(productId)
  try {
    await updateDoc(doc(db, 'products', productId), updates)
  } catch (error) {
    BACKFILLED_PRODUCTS.delete(productId)
    console.warn('[products] Failed to backfill metadata defaults', error)
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
  return `GHS ${amount.toFixed(2)}`
}

function formatExpiry(expiryDate?: Date | null): string {
  if (!expiryDate) return '—'
  return expiryDate.toLocaleDateString()
}

function formatDateInputValue(date: Date | null | undefined): string {
  if (!date) return ''
  return date.toISOString().split('T')[0]
}

function parseDateInput(input: string): Date | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function resolveProductLimit(input: {
  billingStatus: string | null
  paymentStatus: string | null
  planKey: string | null
}): number | null {
  const billingStatus = input.billingStatus?.toLowerCase() ?? null
  const paymentStatus = input.paymentStatus?.toLowerCase() ?? null
  const planKey = input.planKey?.toLowerCase() ?? null

  if (billingStatus === 'trial' || paymentStatus === 'trial') return 10
  if (!planKey) return 10
  if (planKey.includes('scale')) return null
  if (planKey.includes('growth')) return 500
  if (planKey.includes('starter') || planKey.includes('standard')) return 100
  if (planKey.includes('free') || planKey.includes('trial')) return 10
  return 10
}

function normalizeImageUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}


function normalizeImageUrls(value: unknown, fallbackImageUrl: string | null): string[] {
  const list = Array.isArray(value)
    ? value
        .map(item => (typeof item === 'string' ? normalizeImageUrl(item) : null))
        .filter((item): item is string => Boolean(item))
    : []

  if (fallbackImageUrl && !list.includes(fallbackImageUrl)) {
    list.unshift(fallbackImageUrl)
  }

  return list
}

function findNextImageSlot(urls: string[]): number | null {
  for (let index = 0; index < 3; index += 1) {
    if (!urls[index]?.trim()) return index
  }
  return null
}


function normalizeProductName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, character => character.toUpperCase())
}

function toTitleCaseWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, character => character.toUpperCase())
}

function normalizeProductCategory(value: unknown): string {
  const normalizedRaw = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!normalizedRaw) return DEFAULT_PRODUCT_CATEGORY

  const canonical = normalizedRaw.toLowerCase()
  if (canonical === 'beverage' || canonical === 'beverages') {
    return 'Weight'
  }

  return toTitleCaseWords(normalizedRaw)
}

function shouldBackfillCategory(value: unknown): boolean {
  if (typeof value !== 'string') return true
  return normalizeProductCategory(value) !== value.trim()
}

function normalizeLookupValue(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function formatLastReceipt(lastReceiptAt: unknown): string {
  if (!lastReceiptAt) return 'No receipts recorded'
  try {
    // Firestore Timestamp
    if (typeof (lastReceiptAt as any).toDate === 'function') {
      const d: Date = (lastReceiptAt as any).toDate()
      return d.toLocaleDateString()
    }
    if (lastReceiptAt instanceof Date) {
      return lastReceiptAt.toLocaleDateString()
    }
  } catch {
    // ignore
  }
  return 'No receipts recorded'
}

function normalizeSaleItems(items: unknown): SaleRecord['items'] {
  if (!Array.isArray(items)) return []
  return items.map(item => {
    const itemData = item as Record<string, unknown>
    const productId = typeof itemData.productId === 'string' ? itemData.productId : null
    const qty = Number(itemData.qty) || 0
    const price = Number(itemData.price) || 0
    const type = typeof itemData.type === 'string' ? itemData.type : null
    const isService = itemData.isService === true

    return {
      productId,
      qty,
      price,
      type,
      isService,
    }
  })
}

export default function Products() {
  const { storeId: activeStoreId } = useActiveStore()
  const { memberships } = useMemberships()
  const user = useAuthUser()
  const { preferences } = useStorePreferences(activeStoreId)
  const { billing } = useStoreBilling()
  const { name: workspaceName } = useWorkspaceIdentity()
  const { publish } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [productStoreMeta, setProductStoreMeta] = useState<ProductStoreMeta>({
    storeName: null,
    storePhone: null,
    storeCity: null,
    websiteLink: null,
  })

  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [activeTab, setActiveTab] = useState<ProductTab>('add')
  const [searchText, setSearchText] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set())
  const [draggingProductId, setDraggingProductId] = useState<string | null>(null)
  // add-item form state
  const [name, setName] = useState('')
  const [itemType, setItemType] = useState<ItemType>('product')
  const [sku, setSku] = useState('')
  const [hasManualSkuOverride, setHasManualSkuOverride] = useState(false)
  const [categoryInput, setCategoryInput] = useState(DEFAULT_PRODUCT_CATEGORY)
  const [priceInput, setPriceInput] = useState('')
  const [costPriceInput, setCostPriceInput] = useState('')
  const [descriptionInput, setDescriptionInput] = useState('')
  const [descriptionTemplate, setDescriptionTemplate] = useState<DescriptionTemplate>('general')
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false)
  const [taxRateInput, setTaxRateInput] = useState('')
  const [reorderPointInput, setReorderPointInput] = useState('')
  const [openingStockInput, setOpeningStockInput] = useState('')
  const [expiryInput, setExpiryInput] = useState('')
  const [manufacturerInput, setManufacturerInput] = useState('')
  const [productionDateInput, setProductionDateInput] = useState('')
  const [batchNumberInput, setBatchNumberInput] = useState('')
  const [showOnReceiptInput, setShowOnReceiptInput] = useState(false)
  const [imageUrlInput, setImageUrlInput] = useState('')
  const [imageUrlInput2, setImageUrlInput2] = useState('')
  const [imageUrlInput3, setImageUrlInput3] = useState('')
  const [imageAltInput, setImageAltInput] = useState('')
  const [draftProductKey, setDraftProductKey] = useState(() => createDraftProductKey())
  const [imageFileInput, setImageFileInput] = useState<File | null>(null)
  const [imageUploadError, setImageUploadError] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [formStatus, setFormStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [formError, setFormError] = useState<string | null>(null)

  // edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editItemType, setEditItemType] = useState<ItemType>('product')
  const [editSku, setEditSku] = useState('')
  const [editHasManualSkuOverride, setEditHasManualSkuOverride] = useState(false)
  const [editCategoryInput, setEditCategoryInput] = useState('')
  const [editPriceInput, setEditPriceInput] = useState('')
  const [editCostPriceInput, setEditCostPriceInput] = useState('')
  const [editDescriptionInput, setEditDescriptionInput] = useState('')
  const [editDescriptionTemplate, setEditDescriptionTemplate] =
    useState<DescriptionTemplate>('general')
  const [isGeneratingEditDescription, setIsGeneratingEditDescription] = useState(false)
  const [editTaxRateInput, setEditTaxRateInput] = useState('')
  const [editReorderPointInput, setEditReorderPointInput] = useState('')
  const [editStockInput, setEditStockInput] = useState('') // 🔹 On hand (stock) editable
  const [editExpiryDateInput, setEditExpiryDateInput] = useState('')
  const [editProductionDateInput, setEditProductionDateInput] = useState('')
  const [editManufacturerInput, setEditManufacturerInput] = useState('')
  const [editBatchNumberInput, setEditBatchNumberInput] = useState('')
  const [editShowOnReceipt, setEditShowOnReceipt] = useState(false)
  const [editImageUrlInput, setEditImageUrlInput] = useState('')
  const [editImageUrlInput2, setEditImageUrlInput2] = useState('')
  const [editImageUrlInput3, setEditImageUrlInput3] = useState('')
  const [editImageAltInput, setEditImageAltInput] = useState('')
  const [editImageFileInput, setEditImageFileInput] = useState<File | null>(null)
  const [editImageUploadError, setEditImageUploadError] = useState<string | null>(null)
  const [isUploadingEditImage, setIsUploadingEditImage] = useState(false)
  const [salesError, setSalesError] = useState<string | null>(null)

  const maxProductsAllowed = useMemo(
    () =>
      resolveProductLimit({
        billingStatus: billing?.status ?? null,
        paymentStatus: billing?.paymentStatus ?? null,
        planKey: billing?.planKey ?? null,
      }),
    [billing?.paymentStatus, billing?.planKey, billing?.status],
  )

  useEffect(() => {
    if (editingId) return
    setItemType(preferences.productDefaults.defaultItemType === 'service' ? 'service' : 'product')
  }, [editingId, preferences.productDefaults.defaultItemType])

  const activeMembership = useMemo(
    () =>
      activeStoreId
        ? memberships.find(membership => membership.storeId === activeStoreId) ?? null
        : null,
    [activeStoreId, memberships],
  )

  const canManageProducts = activeMembership?.role === 'owner'
  const categoryOptions = useMemo(() => {
    const uniqueCategories = new Set<string>()
    SUGGESTED_PRODUCT_CATEGORIES.forEach(category => uniqueCategories.add(category))
    products.forEach(product => {
      const category = normalizeProductCategory(product.category)
      if (category) {
        uniqueCategories.add(category)
      }
    })
    return Array.from(uniqueCategories).sort((a, b) => a.localeCompare(b))
  }, [products])

  const barcodePrefix = useMemo(
    () => buildStoreBarcodePrefix({ workspaceName, storeId: activeStoreId }),
    [activeStoreId, workspaceName],
  )

  const nextAutoSku = useMemo(
    () =>
      buildNextStoreBarcodeCode({
        workspaceName,
        storeId: activeStoreId,
        existingCodes: products
          .filter(product => product.itemType === 'product')
          .map(product => product.barcode ?? product.sku),
      }),
    [activeStoreId, products, workspaceName],
  )

  const addPhotoPreviewUrls = useMemo(
    () =>
      [imageUrlInput, imageUrlInput2, imageUrlInput3]
        .map(url => normalizeImageUrl(url))
        .filter((url): url is string => Boolean(url)),
    [imageUrlInput, imageUrlInput2, imageUrlInput3],
  )

  /**
   * Load products for the active store
   */
  useEffect(() => {
    let cancelled = false
    let receivedLiveSnapshot = false

    if (!activeStoreId) {
      setProducts([])
      return () => {
        cancelled = true
      }
    }

    // 1. Live Firestore subscription (primary source of truth)
    const q = query(
      collection(db, 'products'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snapshot => {
      receivedLiveSnapshot = true
      const rows: Product[] = snapshot.docs.map(d => {
        const raw = d.data() as Record<string, unknown>
        backfillProductDefaults(d.id, raw)
        return mapFirestoreProduct(d.id, raw)
      })

      // save for offline
      saveCachedProducts(
        rows.map(r => ({
          ...r,
          id: undefined as any, // cache doesn't need the id
        })),
        { storeId: activeStoreId },
      ).catch(error => {
        console.warn('[products] Failed to cache products', error)
      })

      const sorted = [...rows].sort((a, b) => {
        const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER
        const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER
        if (aOrder !== bOrder) return aOrder - bOrder
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
      setProducts(sorted)
    })

    // 2. Fallback to cached products only if live data has not arrived yet.
    loadCachedProducts<CachedProduct>({ storeId: activeStoreId })
      .then(cached => {
        if (cancelled || receivedLiveSnapshot || !cached.length) return
        const mapped = cached.map((item, index) =>
          mapFirestoreProduct(
            // cached objects don't have ids, so we fake a stable-ish one
            (item as any).id ?? `cached-${index}`,
            item as any,
          ),
        )
        setProducts(
          mapped.sort((a, b) => {
            const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER
            const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER
            if (aOrder !== bOrder) return aOrder - bOrder
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          }),
        )
      })
      .catch(error => {
        console.warn('[products] Failed to load cached products', error)
      })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setProductStoreMeta({
        storeName: null,
        storePhone: null,
        storeCity: null,
        websiteLink: null,
      })
      return
    }

    ;(async () => {
      try {
        const snapshot = await getDoc(doc(db, 'stores', activeStoreId))
        const data = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null
        if (!data || cancelled) return

        const storeName =
          typeof data.displayName === 'string' && data.displayName.trim()
            ? data.displayName.trim()
            : typeof data.name === 'string' && data.name.trim()
              ? data.name.trim()
              : null
        const promoSlug = buildPromoSlug(
          typeof data.promoSlug === 'string' ? data.promoSlug : null,
          storeName,
          typeof data.name === 'string' ? data.name : null,
          activeStoreId,
        )

        setProductStoreMeta({
          storeName,
          storePhone:
            typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim() : null,
          storeCity:
            typeof data.city === 'string' && data.city.trim() ? data.city.trim() : null,
          websiteLink: promoSlug
            ? `https://www.sedifex.com/${encodeURIComponent(promoSlug)}`
            : null,
        })
      } catch (error) {
        console.warn('[products] Failed to load store metadata for product defaults', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeStoreId])

  /**
   * Load sales to compute ABC analysis
   */
  useEffect(() => {
    if (!activeStoreId) {
      setSales([])
      setSalesError(null)
      return
    }

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', activeStoreId),
      orderBy('createdAt', 'desc'),
      limit(500),
    )

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const rows: SaleRecord[] = snapshot.docs.filter(docSnap => docSnap.data().status !== 'voided').map(docSnap => {
          const data = docSnap.data() as Record<string, unknown>
          return {
            id: docSnap.id,
            items: normalizeSaleItems(data.items),
          }
        })
        setSales(rows)
        setSalesError(null)
      },
      error => {
        console.warn('[products] Failed to load sales for ABC analysis', error)
        setSales([])
        setSalesError('Sales data unavailable, ABC analysis may be incomplete.')
      },
    )

    return () => unsubscribe()
  }, [activeStoreId])

  const abcAnalysis = useMemo(() => {
    const revenueByProduct = new Map<string, number>()
    let totalRevenue = 0

    for (const sale of sales) {
      for (const item of sale.items) {
        if (!item.productId) continue
        const itemType = typeof item.type === 'string' ? item.type.toLowerCase() : null
        if (item.isService || itemType === 'service') {
          continue
        }
        const revenue = item.qty * item.price
        if (!Number.isFinite(revenue) || revenue <= 0) continue
        totalRevenue += revenue
        revenueByProduct.set(item.productId, (revenueByProduct.get(item.productId) ?? 0) + revenue)
      }
    }

    if (totalRevenue <= 0) return new Map<string, { bucket: AbcBucket; shareOfSales: number }>()

    const sorted = [...revenueByProduct.entries()].sort((a, b) => b[1] - a[1])
    const analysis = new Map<string, { bucket: AbcBucket; shareOfSales: number }>()
    let cumulativeRevenue = 0

    for (const [productId, revenue] of sorted) {
      cumulativeRevenue += revenue
      const cumulativeShare = cumulativeRevenue / totalRevenue
      const bucket: AbcBucket =
        cumulativeShare <= 0.7 ? 'A' : cumulativeShare <= 0.9 ? 'B' : 'C'
      analysis.set(productId, {
        bucket,
        shareOfSales: revenue / totalRevenue,
      })
    }

    return analysis
  }, [sales])

  const getAbcInfo = (productId: string) => {
    const entry = abcAnalysis.get(productId)
    if (!entry) {
      return { bucket: 'C' as AbcBucket, note: 'No sales yet' }
    }
    const shareLabel =
      entry.shareOfSales < 0.01
        ? '<1% of sales'
        : `${Math.round(entry.shareOfSales * 100)}% of sales`
    return { bucket: entry.bucket, note: shareLabel }
  }

  /**
   * Filtering logic
   */
  const visibleProducts = useMemo(() => {
    let result = products

    if (showLowStockOnly) {
      result = result.filter(p => {
        if (p.itemType !== 'product') return false
        if (typeof p.stockCount !== 'number') return false
        if (typeof p.reorderPoint !== 'number') return false
        return p.stockCount <= p.reorderPoint
      })
    }

    if (searchText.trim()) {
      result = result.filter(product => productMatchesSearch(product, searchText))
    }

    return result
  }, [products, searchText, showLowStockOnly])

  const editingProduct = useMemo(
    () => products.find(product => product.id === editingId) ?? null,
    [editingId, products],
  )

  const lowStockCount = useMemo(
    () =>
      products.filter(p => {
        if (p.itemType !== 'product') return false
        if (typeof p.stockCount !== 'number') return false
        if (typeof p.reorderPoint !== 'number') return false
        return p.stockCount <= p.reorderPoint
      }).length,
    [products],
  )
  const hasReachedProductLimit =
    maxProductsAllowed !== null && products.length >= maxProductsAllowed

  const moveProductBefore = (draggedId: string, targetId: string) => {
    if (!draggedId || !targetId || draggedId === targetId) return
    setProducts(current => {
      const dragged = current.find(product => product.id === draggedId)
      const target = current.find(product => product.id === targetId)
      if (!dragged || !target) return current

      const draggedVisibleIndex = visibleProducts.findIndex(product => product.id === draggedId)
      const targetVisibleIndex = visibleProducts.findIndex(product => product.id === targetId)
      if (draggedVisibleIndex < 0 || targetVisibleIndex < 0) return current

      const visibleWithoutDragged = visibleProducts.filter(product => product.id !== draggedId)
      const insertionIndex =
        draggedVisibleIndex < targetVisibleIndex ? targetVisibleIndex - 1 : targetVisibleIndex
      visibleWithoutDragged.splice(insertionIndex, 0, dragged)
      const visibleOrder = new Map(visibleWithoutDragged.map((product, index) => [product.id, index]))

      return [...current].sort((a, b) => {
        const aIndex = visibleOrder.get(a.id)
        const bIndex = visibleOrder.get(b.id)
        if (typeof aIndex === 'number' && typeof bIndex === 'number') return aIndex - bIndex
        if (typeof aIndex === 'number') return -1
        if (typeof bIndex === 'number') return 1
        return 0
      })
    })
  }

  async function generateDescriptionWithAi(input: {
    itemName: string
    itemType: ItemType
    category: string
    template: DescriptionTemplate
  }): Promise<string> {
    const response = await requestAiAdvisor({
      question: buildDescriptionPrompt(input),
      storeId: activeStoreId ?? undefined,
    })
    return typeof response.advice === 'string' ? response.advice.trim() : ''
  }

  async function handleGenerateDescription() {
    if (isGeneratingDescription) return

    const normalizedProductName = normalizeProductName(name)
    if (!normalizedProductName) {
      setFormStatus('error')
      setFormError('Add an item name first so AI can generate a better description.')
      return
    }

    setFormStatus('idle')
    setFormError(null)
    setIsGeneratingDescription(true)
    try {
      const generated = await generateDescriptionWithAi({
        itemName: normalizedProductName,
        itemType,
        category: normalizeProductCategory(categoryInput),
        template: descriptionTemplate,
      })
      if (!generated) {
        setFormStatus('error')
        setFormError('AI could not generate a description right now. Please try again.')
        return
      }
      setDescriptionInput(generated)
      setFormStatus('success')
      publish({ tone: 'success', message: 'AI drafted a description. Review and edit before saving.' })
    } catch (error) {
      console.error('[products] Failed to generate product description', error)
      setFormStatus('error')
      setFormError('Could not generate description with AI right now. Please try again.')
    } finally {
      setIsGeneratingDescription(false)
    }
  }

  async function handleGenerateEditDescription(product: Product) {
    if (isGeneratingEditDescription) return

    const normalizedProductName = normalizeProductName(editName || product.name)
    if (!normalizedProductName) {
      setFormStatus('error')
      setFormError('Add an item name first so AI can generate a better description.')
      return
    }

    setFormStatus('idle')
    setFormError(null)
    setIsGeneratingEditDescription(true)
    try {
      const generated = await generateDescriptionWithAi({
        itemName: normalizedProductName,
        itemType: editItemType,
        category: normalizeProductCategory(editCategoryInput),
        template: editDescriptionTemplate,
      })
      if (!generated) {
        setFormStatus('error')
        setFormError('AI could not generate a description right now. Please try again.')
        return
      }
      setEditDescriptionInput(generated)
      setFormStatus('success')
      publish({ tone: 'success', message: 'AI drafted a description. Review and save when ready.' })
    } catch (error) {
      console.error('[products] Failed to generate edit description', error)
      setFormStatus('error')
      setFormError('Could not generate description with AI right now. Please try again.')
    } finally {
      setIsGeneratingEditDescription(false)
    }
  }

  /**
   * Add item handler
   */
  async function handleAddItem(event: React.FormEvent) {
    event.preventDefault()
    if (isSaving || isUploadingImage) return
    if (!activeStoreId) return

    setFormStatus('idle')
    setFormError(null)

    const normalizedProductName = normalizeProductName(name)
    if (!normalizedProductName) {
      setFormStatus('error')
      setFormError('Please enter a name for this item.')
      return
    }

    const isService = itemType === 'service'

    const priceNumber = priceInput ? Number(priceInput) : NaN
    const reorderPointNumber = reorderPointInput ? Number(reorderPointInput) : NaN
    const costPriceNumber = costPriceInput ? Number(costPriceInput) : NaN
    const openingStockNumber = openingStockInput ? Number(openingStockInput) : NaN
    const taxRateNumber = parseTaxInput(taxRateInput)
    const trimmedDescription = descriptionInput.trim()
    const descriptionWordCount = countWords(trimmedDescription)
    const expiryDate = parseDateInput(expiryInput)
    const productionDate = parseDateInput(productionDateInput)
    const manufacturerName = manufacturerInput.trim()
    const batchNumber = batchNumberInput.trim()
    const normalizedImageUrl = normalizeImageUrl(imageUrlInput)
    const normalizedImageUrl2 = normalizeImageUrl(imageUrlInput2)
    const normalizedImageUrl3 = normalizeImageUrl(imageUrlInput3)
    const normalizedImageUrls = Array.from(
      new Set([normalizedImageUrl, normalizedImageUrl2, normalizedImageUrl3].filter(Boolean)),
    ) as string[]
    const primaryImageUrl = normalizedImageUrls[0] ?? null
    const imageAlt = imageAltInput.trim()

    if (Number.isNaN(priceNumber) || priceNumber < 0) {
      setFormStatus('error')
      setFormError('Price is required. Enter a valid selling price (0 or more).')
      return
    }
    if (descriptionWordCount > MAX_DESCRIPTION_WORDS) {
      setFormStatus('error')
      setFormError(`Description must be ${MAX_DESCRIPTION_WORDS} words or fewer.`)
      return
    }

    if (
      isStockTracked &&
      openingStockInput &&
      (Number.isNaN(openingStockNumber) || openingStockNumber < 0)
    ) {
      setFormStatus('error')
      setFormError('Opening stock must be zero or more.')
      return
    }
    if (imageUrlInput.trim() && !normalizedImageUrl) {
      setFormStatus('error')
      setFormError('Image URL must start with http:// or https://')
      return
    }
    if (imageUrlInput2.trim() && !normalizedImageUrl2) {
      setFormStatus('error')
      setFormError('Image URL 2 must start with http:// or https://')
      return
    }
    if (imageUrlInput3.trim() && !normalizedImageUrl3) {
      setFormStatus('error')
      setFormError('Image URL 3 must start with http:// or https://')
      return
    }

    let finalPrice: number | null = null
    let finalCostPrice: number | null = null
    if (!Number.isNaN(priceNumber) && priceNumber >= 0) {
      finalPrice = Number(priceNumber.toFixed(2)) // 🔹 respect user input (2dp)
    }
    if (!Number.isNaN(costPriceNumber) && costPriceNumber >= 0) {
      finalCostPrice = Number(costPriceNumber.toFixed(2))
    }

    const trimmedSku = sku.trim()
    const normalizedCategory = normalizeProductCategory(categoryInput)
    const normalizedName = normalizeLookupValue(normalizedProductName)
    const normalizedSku = normalizeBarcode(trimmedSku)

    const duplicateNameProduct = products.find(
      product => normalizeLookupValue(product.name) === normalizedName,
    )
    if (duplicateNameProduct) {
      setFormStatus('error')
      setFormError(`"${normalizedProductName}" already exists. Update the existing item instead.`)
      return
    }

    if (!isService && normalizedSku) {
      const duplicateSkuProduct = products.find(product => {
        const existingSku = normalizeBarcode(product.barcode ?? product.sku ?? '')
        return existingSku === normalizedSku
      })

      if (duplicateSkuProduct) {
        setFormStatus('error')
        setFormError(`SKU "${trimmedSku}" is already assigned to another item.`)
        return
      }
    }

    if (maxProductsAllowed !== null && products.length >= maxProductsAllowed) {
      setFormStatus('error')
      setFormError(
        `Your current plan allows up to ${maxProductsAllowed} active products. Upgrade from Account to add more items.`,
      )
      return
    }

    setIsSaving(true)
    try {
      const productRef = doc(collection(db, 'products'))
      const productId = productRef.id

      await setDoc(productRef, {
        productKey: productId,
        storeId: activeStoreId,
        storeName: productStoreMeta.storeName,
        storePhone: productStoreMeta.storePhone,
        storeCity: productStoreMeta.storeCity,
        websiteLink: productStoreMeta.websiteLink,
        name: normalizedProductName,
        itemType,
        category: normalizedCategory,
        description: trimmedDescription || null,
        price: finalPrice,
        costPrice: finalCostPrice,
        // 🔹 Keep SKU as typed, but also store a normalized barcode field
        sku: isService ? null : trimmedSku || null,
        barcode: isService ? null : normalizeBarcode(trimmedSku) || null,
        taxRate: taxRateNumber,
        reorderPoint:
          isStockTracked && !Number.isNaN(reorderPointNumber) && reorderPointNumber >= 0
            ? reorderPointNumber
            : null,
        stockCount:
          isStockTracked && !Number.isNaN(openingStockNumber) && openingStockNumber >= 0
            ? openingStockNumber
            : null,
        expiryDate: isStockTracked ? expiryDate : null,
        productionDate: !isService ? productionDate : null,
        manufacturerName: !isService && manufacturerName ? manufacturerName : null,
        batchNumber: !isService && batchNumber ? batchNumber : null,
        showOnReceipt: !isService && showOnReceiptInput,
        imageUrl: primaryImageUrl,
        imageUrls: normalizedImageUrls,
        imageAlt: primaryImageUrl ? imageAlt || normalizedProductName : null,
        sortOrder: products.length + 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      setFormStatus('success')
      setFormError(null)

      // reset form
      setName('')
      setItemType('product')
      setSku('')
      setHasManualSkuOverride(false)
      setCategoryInput(DEFAULT_PRODUCT_CATEGORY)
      setPriceInput('')
      setCostPriceInput('')
      setDescriptionInput('')
      setDescriptionTemplate('general')
      setTaxRateInput('')
      setReorderPointInput('')
      setOpeningStockInput('')
      setManufacturerInput('')
      setProductionDateInput('')
      setBatchNumberInput('')
      setShowOnReceiptInput(false)
      setImageUrlInput('')
      setImageUrlInput2('')
      setImageUrlInput3('')
      setImageAltInput('')
      setDraftProductKey(createDraftProductKey())

      await logInventoryActivity(
        `Added ${normalizedProductName}`,
        isService
          ? 'Service added to catalogue'
          : `SKU ${trimmedSku || '—'} · Price ${finalPrice !== null ? `GHS ${finalPrice.toFixed(2)}` : '—'}`,
      )
      publish({
        tone: 'success',
        message: isService
          ? `${normalizedProductName} added to catalogue.`
          : `${normalizedProductName} added. You can now sell it from the Sell page.`,
      })
      void playSound('success')
    } catch (error) {
      console.error('[products] Failed to add item', error)
      setFormStatus('error')
      setFormError(toFriendlyFormError(error, 'We could not save this item. Please try again.'))
      void playSound('error')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleImageUpload() {
    if (!activeStoreId) {
      setImageUploadError('Select an active store before uploading product images.')
      return
    }
    if (!imageFileInput) {
      setImageUploadError('Choose an image file before uploading.')
      return
    }

    setImageUploadError(null)
    setIsUploadingImage(true)
    try {
      const currentUrls = [imageUrlInput, imageUrlInput2, imageUrlInput3]
      const nextSlot = findNextImageSlot(currentUrls)
      if (nextSlot === null) {
        setImageUploadError('You already have 3 images. Remove one URL before uploading another.')
        return
      }

      const uploadedUrl = await uploadProductImage(imageFileInput, {
        storagePath: buildProductImagePath(activeStoreId, draftProductKey, nextSlot),
      })
      if (nextSlot === 0) setImageUrlInput(uploadedUrl)
      if (nextSlot === 1) setImageUrlInput2(uploadedUrl)
      if (nextSlot === 2) setImageUrlInput3(uploadedUrl)
      setImageFileInput(null)
      publish({ tone: 'success', message: `Image ${nextSlot + 1} uploaded successfully.` })
      void playSound('action')
    } catch (error) {
      console.error('[products] Failed to upload product image', error)
      if (error instanceof ProductImageUploadError) {
        setImageUploadError(`${error.message} ${EXACT_UPLOAD_LIMIT_HINT}`.trim())
      } else {
        setImageUploadError(`Image upload failed. ${EXACT_UPLOAD_LIMIT_HINT} Please try again.`)
      }
      void playSound('error')
    } finally {
      setIsUploadingImage(false)
    }
  }

  const handleItemTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as ItemType
    setItemType(value)
    if (value === 'service') {
      // services should not have barcodes
      setSku('')
      setHasManualSkuOverride(false)
      setExpiryInput('')
      setManufacturerInput('')
      setProductionDateInput('')
      setBatchNumberInput('')
      setShowOnReceiptInput(false)
    }
  }

  const isService = itemType === 'service'
  const isStockTracked = itemType === 'product'
  const activityActor = user?.displayName || user?.email || 'Team member'

  useEffect(() => {
    if (itemType !== 'product') return
    if (hasManualSkuOverride) return
    setSku(nextAutoSku)
  }, [hasManualSkuOverride, itemType, nextAutoSku])

  useEffect(() => {
    if (!editingId) return
    if (editItemType !== 'product') return
    if (editHasManualSkuOverride) return
    if (editSku.trim()) return
    setEditSku(nextAutoSku)
  }, [editHasManualSkuOverride, editItemType, editSku, editingId, nextAutoSku])

  async function logInventoryActivity(summary: string, detail: string) {
    if (!activeStoreId) return

    try {
      await addDoc(collection(db, 'activity'), {
        storeId: activeStoreId,
        type: 'inventory',
        summary,
        detail,
        actor: activityActor,
        createdAt: serverTimestamp(),
      })
    } catch (error) {
      console.warn('[activity] Failed to log product activity', error)
    }
  }

  /**
   * Edit helpers
   */
  function startEditing(product: Product) {
    if (!canManageProducts) return

    setActiveTab('search')
    setExpandedProductIds(prev => new Set(prev).add(product.id))
    setEditingId(product.id)
    setEditName(product.name)
    setEditItemType(product.itemType)
    setEditSku(product.sku ?? '')
    setEditHasManualSkuOverride(false)
    setEditCategoryInput(product.category ?? '')
    setEditPriceInput(
      typeof product.price === 'number' && Number.isFinite(product.price)
        ? String(product.price)
        : '',
    )
    setEditCostPriceInput(
      typeof product.costPrice === 'number' && Number.isFinite(product.costPrice)
        ? String(product.costPrice)
        : '',
    )
    setEditDescriptionInput(product.description ?? '')
    setEditDescriptionTemplate('general')
    setEditTaxRateInput(
      typeof product.taxRate === 'number' && Number.isFinite(product.taxRate)
        ? String((product.taxRate * 100).toFixed(0)) // show as percent
        : '',
    )
    setEditReorderPointInput(
      typeof product.reorderPoint === 'number' && Number.isFinite(product.reorderPoint)
        ? String(product.reorderPoint)
        : '',
    )
    setEditStockInput(
      typeof product.stockCount === 'number' && Number.isFinite(product.stockCount)
        ? String(product.stockCount)
        : '',
    )
    setEditExpiryDateInput(formatDateInputValue(product.expiryDate))
    setEditProductionDateInput(formatDateInputValue(product.productionDate))
    setEditManufacturerInput(product.manufacturerName ?? '')
    setEditBatchNumberInput(product.batchNumber ?? '')
    setEditShowOnReceipt(product.showOnReceipt === true)
    setEditImageUrlInput(product.imageUrls?.[0] ?? product.imageUrl ?? '')
    setEditImageUrlInput2(product.imageUrls?.[1] ?? '')
    setEditImageUrlInput3(product.imageUrls?.[2] ?? '')
    setEditImageAltInput(product.imageAlt ?? '')
    setEditImageFileInput(null)
    setEditImageUploadError(null)
    setFormStatus('idle')
    setFormError(null)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditHasManualSkuOverride(false)
    setEditImageFileInput(null)
    setEditImageUploadError(null)
  }


  useEffect(() => {
    const searchQuery = searchParams.get('search')
    if (searchQuery && searchText !== searchQuery) {
      setActiveTab('search')
      setSearchText(searchQuery)
    }
  }, [searchParams, searchText])

  useEffect(() => {
    const editProductId = searchParams.get('edit')
    if (!editProductId || !canManageProducts || products.length === 0) return

    const target = products.find((product) => product.id === editProductId)
    if (!target) return

    startEditing(target)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('edit')
      return next
    })
  }, [canManageProducts, products, searchParams, setSearchParams])

  function toggleExpandedProduct(productId: string) {
    setExpandedProductIds(prev => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }

  async function handleSaveEdit(product: Product) {
    if (!canManageProducts) return
    if (!editingId || editingId !== product.id) return

    const normalizedProductName = normalizeProductName(editName)
    if (!normalizedProductName) {
      setFormStatus('error')
      setFormError('Please enter a name for this item.')
      return
    }

    const isStockTracked = editItemType === 'product'
    const priceNumber = editPriceInput ? Number(editPriceInput) : NaN
    const reorderPointNumber = editReorderPointInput
      ? Number(editReorderPointInput)
      : NaN
    const taxRateNumber = parseTaxInput(editTaxRateInput)
    const costPriceNumber = editCostPriceInput ? Number(editCostPriceInput) : NaN
    const trimmedDescription = editDescriptionInput.trim()
    const descriptionWordCount = countWords(trimmedDescription)
    const stockNumberRaw =
      editStockInput.trim() === '' ? null : Number(editStockInput.trim())
    const expiryDate = parseDateInput(editExpiryDateInput)
    const productionDate = parseDateInput(editProductionDateInput)
    const manufacturerName = editManufacturerInput.trim()
    const batchNumber = editBatchNumberInput.trim()
    const normalizedImageUrl = normalizeImageUrl(editImageUrlInput)
    const normalizedImageUrl2 = normalizeImageUrl(editImageUrlInput2)
    const normalizedImageUrl3 = normalizeImageUrl(editImageUrlInput3)
    const normalizedImageUrls = Array.from(
      new Set([normalizedImageUrl, normalizedImageUrl2, normalizedImageUrl3].filter(Boolean)),
    ) as string[]
    const primaryImageUrl = normalizedImageUrls[0] ?? null
    const imageAlt = editImageAltInput.trim()

    if (Number.isNaN(priceNumber) || priceNumber < 0) {
      setFormStatus('error')
      setFormError('Price is required. Enter a valid selling price (0 or more).')
      return
    }
    if (descriptionWordCount > MAX_DESCRIPTION_WORDS) {
      setFormStatus('error')
      setFormError(`Description must be ${MAX_DESCRIPTION_WORDS} words or fewer.`)
      return
    }

    if (isStockTracked && stockNumberRaw !== null) {
      if (!Number.isFinite(stockNumberRaw) || stockNumberRaw < 0) {
        setFormStatus('error')
        setFormError('On hand must be zero or more.')
        return
      }
    }
    if (editImageUrlInput.trim() && !normalizedImageUrl) {
      setFormStatus('error')
      setFormError('Image URL must start with http:// or https://')
      return
    }
    if (editImageUrlInput2.trim() && !normalizedImageUrl2) {
      setFormStatus('error')
      setFormError('Image URL 2 must start with http:// or https://')
      return
    }
    if (editImageUrlInput3.trim() && !normalizedImageUrl3) {
      setFormStatus('error')
      setFormError('Image URL 3 must start with http:// or https://')
      return
    }

    let finalPrice: number | null = null
    let finalCostPrice: number | null = null
    if (!Number.isNaN(priceNumber) && priceNumber >= 0) {
      finalPrice = Number(priceNumber.toFixed(2))
    }
    if (!Number.isNaN(costPriceNumber) && costPriceNumber >= 0) {
      finalCostPrice = Number(costPriceNumber.toFixed(2))
    }

    const finalStock =
      !isStockTracked || stockNumberRaw === null ? null : Math.floor(stockNumberRaw)

    const trimmedSku = editSku.trim()
    const normalizedCategory = normalizeProductCategory(editCategoryInput)

    setFormStatus('idle')
    setFormError(null)

    try {
      const ref = doc(db, 'products', product.id)
      await updateDoc(ref, {
        name: normalizedProductName,
        itemType: editItemType,
        category: normalizedCategory,
        description: trimmedDescription || null,
        sku: isStockTracked ? trimmedSku || null : null,
        barcode: isStockTracked ? normalizeBarcode(trimmedSku) || null : null,
        price: finalPrice,
        costPrice: finalCostPrice,
        taxRate: taxRateNumber,
        reorderPoint:
          isStockTracked &&
          !Number.isNaN(reorderPointNumber) &&
          reorderPointNumber >= 0
            ? reorderPointNumber
            : null,
        stockCount: finalStock,
        expiryDate: isStockTracked ? expiryDate : null,
        productionDate: isStockTracked ? productionDate : null,
        manufacturerName: isStockTracked && manufacturerName ? manufacturerName : null,
        batchNumber: isStockTracked && batchNumber ? batchNumber : null,
        showOnReceipt: isStockTracked && editShowOnReceipt,
        imageUrl: primaryImageUrl,
        imageUrls: normalizedImageUrls,
        imageAlt: primaryImageUrl ? imageAlt || normalizedProductName : null,
        updatedAt: serverTimestamp(),
      })

      setEditingId(null)
      setEditHasManualSkuOverride(false)
      setFormStatus('success')
      setFormError('Item updated successfully.')

      await logInventoryActivity(
        `Updated ${normalizedProductName}`,
        isStockTracked
          ? `SKU ${trimmedSku || '—'} · Stock ${
              typeof finalStock === 'number' ? finalStock : '—'
            } · Price ${
              typeof finalPrice === 'number' ? `GHS ${finalPrice.toFixed(2)}` : '—'
            }`
          : 'Service or made-to-order details updated',
      )
    } catch (error) {
      console.error('[products] Failed to update item', error)
      setFormStatus('error')
      setFormError(toFriendlyFormError(error, 'We could not update this item. Please try again.'))
    }
  }

  async function handleEditImageUpload(product: Product) {
    if (!activeStoreId) {
      setEditImageUploadError('Select an active store before uploading product images.')
      return
    }
    if (!editImageFileInput) {
      setEditImageUploadError('Choose an image file before uploading.')
      return
    }

    setEditImageUploadError(null)
    setIsUploadingEditImage(true)
    try {
      const currentUrls = [editImageUrlInput, editImageUrlInput2, editImageUrlInput3]
      const nextSlot = findNextImageSlot(currentUrls)
      if (nextSlot === null) {
        setEditImageUploadError('You already have 3 images. Remove one URL before uploading another.')
        return
      }

      const uploadedUrl = await uploadProductImage(editImageFileInput, {
        storagePath: buildProductImagePath(activeStoreId, product.id, nextSlot),
      })
      if (nextSlot === 0) setEditImageUrlInput(uploadedUrl)
      if (nextSlot === 1) setEditImageUrlInput2(uploadedUrl)
      if (nextSlot === 2) setEditImageUrlInput3(uploadedUrl)
      setEditImageFileInput(null)
      publish({ tone: 'success', message: `Image ${nextSlot + 1} uploaded successfully.` })
      void playSound('action')
    } catch (error) {
      console.error('[products] Failed to upload product image while editing', error)
      if (error instanceof ProductImageUploadError) {
        setEditImageUploadError(`${error.message} ${EXACT_UPLOAD_LIMIT_HINT}`.trim())
      } else {
        setEditImageUploadError(`Image upload failed. ${EXACT_UPLOAD_LIMIT_HINT} Please try again.`)
      }
      void playSound('error')
    } finally {
      setIsUploadingEditImage(false)
    }
  }

  async function handleDelete(product: Product) {
    if (!canManageProducts) return

    const confirmed = window.confirm(
      `Delete "${product.name}"? This cannot be undone.`,
    )
    if (!confirmed) return

    try {
      const ref = doc(db, 'products', product.id)
      await deleteDoc(ref)
      if (editingId === product.id) {
        setEditingId(null)
        setEditHasManualSkuOverride(false)
      }

      await logInventoryActivity(
        `Deleted ${product.name}`,
        'Removed from catalogue',
      )
    } catch (error) {
      console.error('[products] Failed to delete item', error)
      setFormStatus('error')
      setFormError(
        error instanceof Error
          ? error.message
          : 'We could not delete this item. Please try again.',
      )
    }
  }

  return (
    <div className="page products-page">
      <header className="page__header products-page__header">
        <div>
          <h2 className="page__title">Items</h2>
          <p className="page__subtitle">
            Review inventory, monitor low stock alerts, and keep your catalogue of items
            and services tidy.
          </p>
        </div>
      </header>

      <div className="products-page__grid">
        <div className="products-page__tabs" role="tablist" aria-label="Items sub-tabs">
          <button
            type="button"
            role="tab"
            id="products-tab-add"
            aria-controls="products-panel-add"
            aria-selected={activeTab === 'add'}
            className={`products-page__tab ${activeTab === 'add' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            Add product
          </button>
          <button
            type="button"
            role="tab"
            id="products-tab-search"
            aria-controls="products-panel-search"
            aria-selected={activeTab === 'search'}
            className={`products-page__tab ${activeTab === 'search' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            Search products
          </button>
        </div>

        {/* Add item card */}
        <section
          className={`card products-page__add-card ${activeTab !== 'add' ? 'products-page__panel--hidden' : ''}`}
          role="tabpanel"
          id="products-panel-add"
          aria-labelledby="products-tab-add"
          hidden={activeTab !== 'add'}
        >
          <h3 className="card__title">Add item</h3>
          <p className="card__subtitle">
            Capture both physical products and services you offer so sales and records
            stay accurate.
          </p>

          {hasReachedProductLimit && (
            <p className="products__message products__message--error" role="alert">
              You have reached your plan limit ({maxProductsAllowed} active products). Upgrade your
              plan to add more items. <Link to="/account">Upgrade now</Link>.
            </p>
          )}

          {formStatus === 'success' && formError === null && (
            <p className="products__message products__message--success">
              Item added. You can now sell it from the Sell page.
            </p>
          )}

          {formStatus === 'success' && formError === 'Item updated successfully.' && (
            <p className="products__message products__message--success">
              {formError}
            </p>
          )}

          {formStatus === 'error' && formError && (
            <p className="products__message products__message--error">{formError}</p>
          )}

          <form className="form" onSubmit={handleAddItem}>
            <div className="field">
              <label className="field__label" htmlFor="add-name">
                Name <span className="field__required">(required)</span>
              </label>
              <input
                id="add-name"
                placeholder="e.g. House Blend Coffee or Acrylic Nails"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-type">
                Item type
              </label>
              <select id="add-type" value={itemType} onChange={handleItemTypeChange}>
                <option value="product">Physical product</option>
                <option value="service">Service</option>
              </select>
              <div>
                <p className="field__hint">
                  <strong>Physical product:</strong> Tracks on-hand stock for items you store so you
                  can watch low-stock alerts.
                </p>
                <p className="field__hint">
                  <strong>Service:</strong> No stock counts—best for labour or time-based work while
                  still setting a selling price.
                </p>
              </div>
            </div>

            {!isService && (
              <div className="field">
                <label className="field__label" htmlFor="add-sku">
                  SKU / Barcode
                </label>
                <input
                  id="add-sku"
                  placeholder={`Auto-fills like ${barcodePrefix}0001 (you can edit it)`}
                  value={sku}
                  onChange={e => {
                    setSku(e.target.value)
                    setHasManualSkuOverride(true)
                  }}
                />
                <p className="field__hint">
                  Barcode values auto-fill from your store prefix ({barcodePrefix}) plus sequential
                  numbers (for example {barcodePrefix}0001). You can overwrite this any time.
                </p>
              </div>
            )}

            <div className="field">
              <label className="field__label" htmlFor="add-price">
                Price <span className="field__required">(required)</span>
              </label>
              <input
                id="add-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="How much you sell it for"
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                required
              />
              <p className="field__hint">
                Price is required before you can save. We round it to 2 decimal places.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-cost-price">
                Cost price <span className="field__optional">(optional)</span>
              </label>
              <input
                id="add-cost-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="How much it costs you"
                value={costPriceInput}
                onChange={e => setCostPriceInput(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-description">
                Product description <span className="field__optional">(optional, up to 500 words)</span>
              </label>
              <div className="products-page__description-tools">
                <select
                  id="add-description-template"
                  value={descriptionTemplate}
                  onChange={event =>
                    setDescriptionTemplate(event.target.value as DescriptionTemplate)
                  }
                >
                  {DESCRIPTION_TEMPLATE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleGenerateDescription}
                  disabled={isGeneratingDescription}
                >
                  {isGeneratingDescription ? 'Generating…' : 'Generate full description with A.I'}
                </button>
              </div>
              <textarea
                id="add-description"
                value={descriptionInput}
                onChange={e => setDescriptionInput(e.target.value)}
                rows={6}
              />
              <p className="field__hint">
                {countWords(descriptionInput)} / {MAX_DESCRIPTION_WORDS} words
              </p>
              <p className="field__hint">
                Pick a template (Skin Care, food, and more) then tap Generate full description with A.I for a richer,
                more realistic draft.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-category">
                Category
              </label>
              <input
                id="add-category"
                type="text"
                value={categoryInput}
                onChange={e => setCategoryInput(e.target.value)}
                onBlur={e => setCategoryInput(normalizeProductCategory(e.target.value))}
                list="category-options-add"
                placeholder="Select or type a category"
              />
              <datalist id="category-options-add">
                {categoryOptions.map(category => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </datalist>
              <p className="field__hint">
                {categoryOptions.length
                  ? 'Pick from suggestions or type your own category.'
                  : 'Type your first category to get started.'}
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="add-opening-stock">
                Opening stock
              </label>
              <input
                id="add-opening-stock"
                type="number"
                min="0"
                step="1"
                placeholder="Quantity currently on hand"
                value={openingStockInput}
                onChange={e => setOpeningStockInput(e.target.value)}
                disabled={isService}
              />
            </div>

            <section className="products-page__photo-section" aria-label="Product photos">
              <h3>Product photos</h3>
              <p className="field__hint">
                Upload up to 3 images. The first image is used as the main product photo.
              </p>

              <div className="products-page__photo-grid">
                {addPhotoPreviewUrls.length ? (
                  addPhotoPreviewUrls.map((url, index) => (
                    <article key={`${url}-${index}`} className="products-page__photo-preview">
                      <SafeFirebaseImage src={url} alt={index === 0 ? 'Main image preview' : `Image ${index + 1} preview`} />
                      <p>{index === 0 ? 'Main image' : `Image ${index + 1}`}</p>
                    </article>
                  ))
                ) : (
                  <article className="products-page__photo-placeholder">No image yet</article>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor="add-image-file">
                  Browse image <span className="field__optional">(optional)</span>
                </label>
                <input
                  id="add-image-file"
                  type="file"
                  accept="image/*"
                  onChange={event => {
                    const file = event.target.files?.[0] ?? null
                    setImageFileInput(file)
                    setImageUploadError(null)
                  }}
                />
                <div className="products-page__upload-actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={!imageFileInput || isUploadingImage}
                    onClick={() => {
                      void handleImageUpload()
                    }}
                  >
                    {isUploadingImage ? 'Uploading…' : 'Upload and use URL'}
                  </button>
                  {imageUploadError ? (
                    <p className="products-page__upload-error">{imageUploadError}</p>
                  ) : null}
                </div>
                <p className="field__hint">
                  Uploads to your backend and auto-fills the next empty image URL slot (up to 3), so the saved URL can
                  be shared by email before customers view the full product page.
                </p>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="add-image-url">
                  Image URL 1 <span className="field__optional">(optional)</span>
                </label>
                <div className="products-page__field-inline">
                  <input
                    id="add-image-url"
                    type="url"
                    placeholder="https://example.com/product-image.jpg"
                    value={imageUrlInput}
                    onChange={e => setImageUrlInput(e.target.value)}
                  />
                  <button type="button" className="button button--ghost" onClick={() => setImageUrlInput('')}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="add-image-url-2">
                  Image URL 2 <span className="field__optional">(optional)</span>
                </label>
                <div className="products-page__field-inline">
                  <input
                    id="add-image-url-2"
                    type="url"
                    placeholder="https://example.com/product-image-side.jpg"
                    value={imageUrlInput2}
                    onChange={e => setImageUrlInput2(e.target.value)}
                  />
                  <button type="button" className="button button--ghost" onClick={() => setImageUrlInput2('')}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="add-image-url-3">
                  Image URL 3 <span className="field__optional">(optional)</span>
                </label>
                <div className="products-page__field-inline">
                  <input
                    id="add-image-url-3"
                    type="url"
                    placeholder="https://example.com/product-image-back.jpg"
                    value={imageUrlInput3}
                    onChange={e => setImageUrlInput3(e.target.value)}
                  />
                  <button type="button" className="button button--ghost" onClick={() => setImageUrlInput3('')}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="add-image-alt">
                  Image alt text <span className="field__optional">(optional)</span>
                </label>
                <input
                  id="add-image-alt"
                  type="text"
                  value={imageAltInput}
                  onChange={e => setImageAltInput(e.target.value)}
                />
                <p className="field__hint">Defaults to the item name when left empty.</p>
              </div>
            </section>

            <details className="products-page__optional-expander">
              <summary>Optional item details</summary>

              <div className="field">
                <label className="field__label" htmlFor="add-tax">
                  VAT (percent)
                </label>
                <input
                  id="add-tax"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 15 for 15% VAT, or leave blank"
                  value={taxRateInput}
                  onChange={e => setTaxRateInput(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="add-reorder">
                  Reorder point
                </label>
                <input
                  id="add-reorder"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Alert when stock drops to..."
                  value={reorderPointInput}
                  onChange={e => setReorderPointInput(e.target.value)}
                  disabled={isService}
                />
              </div>

              {!isService && (
                <div className="field">
                  <label className="field__label" htmlFor="add-expiry">
                    Expiry date
                  </label>
                  <input
                    id="add-expiry"
                    type="date"
                    value={expiryInput}
                    onChange={e => setExpiryInput(e.target.value)}
                  />
                  <p className="field__hint">
                    Stay ahead of expiring batches so pharmacy stock never goes to waste.
                  </p>
                </div>
              )}

              {!isService && (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor="add-production">
                      Production date <span className="field__optional">(optional)</span>
                    </label>
                    <input
                      id="add-production"
                      type="date"
                      value={productionDateInput}
                      onChange={e => setProductionDateInput(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="add-manufacturer">
                      Manufacturer name <span className="field__optional">(optional)</span>
                    </label>
                    <input
                      id="add-manufacturer"
                      type="text"
                      value={manufacturerInput}
                      onChange={e => setManufacturerInput(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="add-batch">
                      Batch number <span className="field__optional">(optional)</span>
                    </label>
                    <input
                      id="add-batch"
                      type="text"
                      value={batchNumberInput}
                      onChange={e => setBatchNumberInput(e.target.value)}
                    />
                  </div>

                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={showOnReceiptInput}
                      onChange={event => setShowOnReceiptInput(event.target.checked)}
                    />
                    <span>
                      Show production details on receipts and labels{' '}
                      <span className="field__optional">(optional)</span>
                    </span>
                  </label>
                </>
              )}
            </details>

            <button
              type="submit"
              className="button button--primary"
              disabled={isSaving}
            >
              {isSaving ? 'Adding…' : 'Add item'}
            </button>
          </form>
        </section>

        {/* List card */}
        <section
          className={`card products-page__list-card ${activeTab !== 'search' ? 'products-page__panel--hidden' : ''}`}
          role="tabpanel"
          id="products-panel-search"
          aria-labelledby="products-tab-search"
          hidden={activeTab !== 'search'}
        >
          <div className="products-page__list-header">
            <div className="field field--inline">
              <label className="field__label" htmlFor="products-search">
                Search
              </label>
              <input
                id="products-search"
                placeholder="Search by name, category, SKU, or barcode"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
            </div>
          </div>

          <div className="products-page__list-controls">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={showLowStockOnly}
                onChange={e => setShowLowStockOnly(e.target.checked)}
              />
              <span>Show low stock only ({lowStockCount})</span>
            </label>
            <button type="button" className="button button--ghost">
              Download reorder list
            </button>
          </div>
          <p className="products-page__abc-hint">
            ABC analysis ranks items by sales revenue from the last 500 sales. A = top 70%, B = next
            20%, C = remaining.
            {salesError ? <span className="products-page__abc-error">{salesError}</span> : null}
          </p>

          {editingProduct ? (
            editItemType !== 'product' ? (
              <section className="card products-page__edit-card" aria-live="polite">
                <p className="field__hint">
                  Receipt and batch details only apply to products. Switch this item back to a
                  product to edit its manufacturing info.
                </p>
              </section>
            ) : (
              <section className="card products-page__edit-card" aria-live="polite">
                <h4>Receipt &amp; batch details</h4>
                <p className="field__hint">
                  Add optional production details that can appear on receipts, labels, and invoices.
                </p>

                <div className="field">
                  <label className="field__label" htmlFor="edit-production">
                    Production date <span className="field__optional">(optional)</span>
                  </label>
                  <input
                    id="edit-production"
                    type="date"
                    value={editProductionDateInput}
                    onChange={event => setEditProductionDateInput(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="edit-manufacturer">
                    Manufacturer name <span className="field__optional">(optional)</span>
                  </label>
                  <input
                    id="edit-manufacturer"
                    type="text"
                    value={editManufacturerInput}
                    onChange={event => setEditManufacturerInput(event.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="edit-batch">
                    Batch number <span className="field__optional">(optional)</span>
                  </label>
                  <input
                    id="edit-batch"
                    type="text"
                    value={editBatchNumberInput}
                    onChange={event => setEditBatchNumberInput(event.target.value)}
                  />
                </div>

                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={editShowOnReceipt}
                    onChange={event => setEditShowOnReceipt(event.target.checked)}
                  />
                  <span>
                    Show production details on receipts and labels{' '}
                    <span className="field__optional">(optional)</span>
                  </span>
                </label>
              </section>
            )
          ) : null}

          {visibleProducts.length === 0 ? (
            <div className="empty-state">
              <h3 className="empty-state__title">No items found</h3>
              <p>
                Try a different search term, or add new items using the form on the left.
              </p>
            </div>
          ) : (
            <div className="products-page__list" aria-live="polite">
              {visibleProducts.map(product => {
                const isEditing = editingId === product.id
                const isExpanded = isEditing || expandedProductIds.has(product.id)
                const displayItemType = isEditing ? editItemType : product.itemType
                const isStockTracked = displayItemType === 'product'

                return (
                  <article
                    key={product.id}
                    className={`products-page__list-card ${isEditing ? 'is-editing' : ''}`}
                    draggable={activeTab === 'search' && !editingId}
                    onDragStart={() => setDraggingProductId(product.id)}
                    onDragOver={event => {
                      event.preventDefault()
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      if (draggingProductId) {
                        moveProductBefore(draggingProductId, product.id)
                      }
                      setDraggingProductId(null)
                    }}
                    onDragEnd={() => setDraggingProductId(null)}
                  >
                    <header className="products-page__list-card__header">
                      <div className="products-page__thumb-wrap">
                        {product.imageUrl ? (
                          <SafeFirebaseImage
                            className="products-page__thumb"
                            src={product.imageUrl}
                            alt={product.imageAlt ?? product.name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="products-page__thumb products-page__thumb--placeholder">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="products-page__list-title">
                        <h4>{product.name}</h4>
                        <span className="products-page__badge products-page__badge--muted">
                          {displayItemType === 'service' ? 'Service' : 'Product'}
                        </span>
                        {isStockTracked && typeof product.reorderPoint === 'number' &&
                          typeof product.stockCount === 'number' &&
                          product.stockCount <= product.reorderPoint && (
                            <span className="products-page__pill">Low stock</span>
                          )}
                      </div>
                      <div className="products-page__list-meta">
                        <span className="products-page__meta-label">Last receipt:</span>
                        <span>{formatLastReceipt(product.lastReceiptAt)}</span>
                      </div>
                      <button
                        type="button"
                        className="button button--ghost products-page__expand-button"
                        onClick={() => toggleExpandedProduct(product.id)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? 'Hide details' : 'View details'}
                      </button>
                    </header>

                    {isExpanded ? (
                      <>
                        <div className="products-page__list-grid">
                          <div className="products-page__list-field">
                            <label className="field__label">
                              Name <span className="field__required">(required)</span>
                            </label>
                            {isEditing ? (
                              <input
                                value={editName}
                                onChange={event => setEditName(event.target.value)}
                                required
                              />
                            ) : (
                              <p className="products-page__list-value">{product.name}</p>
                            )}
                          </div>

                      <div className="products-page__list-field">
                        <label className="field__label">Item type</label>
                        {isEditing ? (
                          <select
                              value={editItemType}
                              onChange={event => {
                                const nextItemType = event.target.value as ItemType
                                setEditItemType(nextItemType)
                                if (nextItemType === 'service') {
                                  setEditSku('')
                                  setEditHasManualSkuOverride(false)
                                }
                              }}
                          >
                            <option value="product">Physical product</option>
                            <option value="service">Service</option>
                          </select>
                        ) : (
                          <p className="products-page__list-value">
                            {product.itemType === 'service' ? 'Service' : 'Physical product'}
                          </p>
                        )}
                      </div>

                      {displayItemType !== 'service' && (
                        <div className="products-page__list-field">
                          <label className="field__label">SKU / Barcode</label>
                          {isEditing ? (
                            <>
                              <input
                                value={editSku}
                                onChange={event => {
                                  setEditSku(event.target.value)
                                  setEditHasManualSkuOverride(true)
                                }}
                                placeholder={`Auto-fills like ${barcodePrefix}0001 (you can edit it)`}
                              />
                              <p className="field__hint">
                                If this item has no barcode yet, we auto-fill one for you.
                              </p>
                            </>
                          ) : (
                            <p className="products-page__list-value">{product.sku || '—'}</p>
                          )}
                        </div>
                      )}

                      <div className="products-page__list-field products-page__photo-section">
                        <label className="field__label">Product photos</label>
                        {isEditing ? (
                          <>
                            <div className="products-page__photo-grid">
                              {([editImageUrlInput, editImageUrlInput2, editImageUrlInput3]
                                .map(url => normalizeImageUrl(url))
                                .filter((url): url is string => Boolean(url)).length ? (
                                [editImageUrlInput, editImageUrlInput2, editImageUrlInput3]
                                  .map(url => normalizeImageUrl(url))
                                  .filter((url): url is string => Boolean(url))
                                  .map((url, index) => (
                                    <article key={`${url}-${index}`} className="products-page__photo-preview">
                                      <SafeFirebaseImage src={url} alt={index === 0 ? 'Main image preview' : `Image ${index + 1} preview`} />
                                      <p>{index === 0 ? 'Main image' : `Image ${index + 1}`}</p>
                                    </article>
                                  ))
                              ) : (
                                <article className="products-page__photo-placeholder">No image yet</article>
                              ))}
                            </div>
                            <div className="products-page__upload-actions">
                              <input
                                type="file"
                                accept="image/*"
                                onChange={event => {
                                  setEditImageFileInput(event.target.files?.[0] ?? null)
                                  setEditImageUploadError(null)
                                }}
                              />
                              <button
                                type="button"
                                className="button button--secondary"
                                onClick={() => void handleEditImageUpload(product)}
                                disabled={isUploadingEditImage}
                              >
                                {isUploadingEditImage ? 'Uploading…' : 'Upload and use URL'}
                              </button>
                            </div>
                            {editImageUploadError ? (
                              <p className="products-page__upload-error">{editImageUploadError}</p>
                            ) : null}
                            <p className="field__hint">
                              Upload up to 3 images. Each upload auto-fills the next URL slot so you can save and share
                              image links by email before publishing.
                            </p>
                            <input
                              type="url"
                              value={editImageUrlInput}
                              onChange={event => setEditImageUrlInput(event.target.value)}
                              placeholder="https://example.com/image.jpg"
                            />
                            <button
                              type="button"
                              className="button button--ghost"
                              onClick={() => setEditImageUrlInput('')}
                            >
                              Clear URL 1
                            </button>
                            <input
                              type="url"
                              value={editImageUrlInput2}
                              onChange={event => setEditImageUrlInput2(event.target.value)}
                              placeholder="https://example.com/image-side.jpg"
                            />
                            <button
                              type="button"
                              className="button button--ghost"
                              onClick={() => setEditImageUrlInput2('')}
                            >
                              Clear URL 2
                            </button>
                            <input
                              type="url"
                              value={editImageUrlInput3}
                              onChange={event => setEditImageUrlInput3(event.target.value)}
                              placeholder="https://example.com/image-back.jpg"
                            />
                            <button
                              type="button"
                              className="button button--ghost"
                              onClick={() => setEditImageUrlInput3('')}
                            >
                              Clear URL 3
                            </button>
                          </>
                        ) : (
                          <p className="products-page__list-value">
                            {product.imageUrls?.length
                              ? product.imageUrls.slice(0, 3).join(', ')
                              : product.imageUrl || '—'}
                          </p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">Image alt text</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editImageAltInput}
                            onChange={event => setEditImageAltInput(event.target.value)}
                          />
                        ) : (
                          <p className="products-page__list-value">
                            {product.imageAlt || product.name}
                          </p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">Category</label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editCategoryInput}
                            onChange={event => setEditCategoryInput(event.target.value)}
                            onBlur={event => setEditCategoryInput(normalizeProductCategory(event.target.value))}
                            list="category-options-edit"
                            placeholder="Select or type a category"
                          />
                        ) : (
                          <p className="products-page__list-value">{product.category || '—'}</p>
                        )}
                        {isEditing && (
                          <datalist id="category-options-edit">
                            {categoryOptions.map(category => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </datalist>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">Product description</label>
                        {isEditing ? (
                          <>
                            <div className="products-page__description-tools">
                              <select
                                value={editDescriptionTemplate}
                                onChange={event =>
                                  setEditDescriptionTemplate(
                                    event.target.value as DescriptionTemplate,
                                  )
                                }
                              >
                                {DESCRIPTION_TEMPLATE_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="button button--ghost"
                                onClick={() => handleGenerateEditDescription(product)}
                                disabled={isGeneratingEditDescription}
                              >
                                {isGeneratingEditDescription
                                  ? 'Generating…'
                                  : 'Generate full description with A.I'}
                              </button>
                            </div>
                            <textarea
                              value={editDescriptionInput}
                              onChange={event => setEditDescriptionInput(event.target.value)}
                              rows={6}
                            />
                            <p className="field__hint">
                              {countWords(editDescriptionInput)} / {MAX_DESCRIPTION_WORDS} words
                            </p>
                          </>
                        ) : (
                          <div className="products-page__list-value products-page__description-preview">
                            {product.description
                              ? renderProductDescription(product.description)
                              : '—'}
                          </div>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">VAT</label>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editTaxRateInput}
                            onChange={event => setEditTaxRateInput(event.target.value)}
                            placeholder="e.g. 15"
                          />
                        ) : (
                          <p className="products-page__list-value">{formatVat(product.taxRate)}</p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">
                          Price <span className="field__required">(required)</span>
                        </label>
                        {isEditing ? (
                          <>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editPriceInput}
                              onChange={event => setEditPriceInput(event.target.value)}
                              required
                            />
                            <p className="field__hint">
                              Price is required before you can save changes.
                            </p>
                          </>
                        ) : (
                          <p className="products-page__list-value">{formatCurrency(product.price)}</p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">Cost price</label>
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editCostPriceInput}
                            onChange={event => setEditCostPriceInput(event.target.value)}
                          />
                        ) : (
                          <p className="products-page__list-value">{formatCurrency(product.costPrice)}</p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">ABC class</label>
                        {isStockTracked ? (
                          (() => {
                            const abcInfo = getAbcInfo(product.id)
                            return (
                              <div className="products-page__abc">
                                <span
                                  className={`products-page__badge products-page__badge--abc-${abcInfo.bucket.toLowerCase()}`}
                                >
                                  {abcInfo.bucket}
                                </span>
                                <span className="products-page__abc-note">{abcInfo.note}</span>
                              </div>
                            )
                          })()
                        ) : (
                          <p className="products-page__list-value">—</p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">On hand</label>
                        {isStockTracked ? (
                          isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editStockInput}
                              onChange={event => setEditStockInput(event.target.value)}
                            />
                          ) : (
                            <p className="products-page__list-value">{product.stockCount ?? 0}</p>
                          )
                        ) : (
                          <p className="products-page__list-value">—</p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">Reorder point</label>
                        {isStockTracked ? (
                          isEditing ? (
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editReorderPointInput}
                              onChange={event => setEditReorderPointInput(event.target.value)}
                            />
                          ) : (
                            <p className="products-page__list-value">{product.reorderPoint ?? '—'}</p>
                          )
                        ) : (
                          <p className="products-page__list-value">—</p>
                        )}
                      </div>

                      <div className="products-page__list-field">
                        <label className="field__label">Expiry date</label>
                        {isStockTracked ? (
                          isEditing ? (
                            <input
                              type="date"
                              value={editExpiryDateInput}
                              onChange={event => setEditExpiryDateInput(event.target.value)}
                            />
                          ) : (
                            <p className="products-page__list-value">{formatExpiry(product.expiryDate)}</p>
                          )
                        ) : (
                          <p className="products-page__list-value">—</p>
                        )}
                      </div>

                      {isStockTracked && (
                        <>
                          <div className="products-page__list-field">
                            <label className="field__label">Production date</label>
                            {isEditing ? (
                              <input
                                type="date"
                                value={editProductionDateInput}
                                onChange={event =>
                                  setEditProductionDateInput(event.target.value)
                                }
                              />
                            ) : (
                              <p className="products-page__list-value">
                                {formatExpiry(product.productionDate)}
                              </p>
                            )}
                          </div>

                          <div className="products-page__list-field">
                            <label className="field__label">Manufacturer</label>
                            {isEditing ? (
                              <input
                                type="text"
                                value={editManufacturerInput}
                                onChange={event => setEditManufacturerInput(event.target.value)}
                              />
                            ) : (
                              <p className="products-page__list-value">
                                {product.manufacturerName || '—'}
                              </p>
                            )}
                          </div>

                          <div className="products-page__list-field">
                            <label className="field__label">Batch number</label>
                            {isEditing ? (
                              <input
                                type="text"
                                value={editBatchNumberInput}
                                onChange={event => setEditBatchNumberInput(event.target.value)}
                              />
                            ) : (
                              <p className="products-page__list-value">{product.batchNumber || '—'}</p>
                            )}
                          </div>
                        </>
                      )}
                        </div>

                        <div className="products-page__list-actions">
                          {!canManageProducts ? (
                            <span className="products-page__list-value">View only</span>
                          ) : isEditing ? (
                            <>
                              <button
                                type="button"
                                className="button button--primary"
                                onClick={() => handleSaveEdit(product)}
                              >
                                Save changes
                              </button>
                              <button
                                type="button"
                                className="button button--ghost"
                                onClick={cancelEditing}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="button button--danger"
                                onClick={() => handleDelete(product)}
                              >
                                Delete
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="button button--ghost"
                                onClick={() => startEditing(product)}
                              >
                                Edit details
                              </button>
                              <button
                                type="button"
                                className="button button--danger"
                                onClick={() => handleDelete(product)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
