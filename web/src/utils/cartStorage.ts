const STORAGE_KEY = 'sell-carts'
const DB_NAME = 'sell-cart-store'
const DB_VERSION = 1
const STORE_NAME = 'carts'
const STORAGE_VERSION = 1

export type StoredCartLine = {
  productId: string
  name: string
  price: number
  qty: number
  taxRate?: number
}

export type CartTotals = {
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  totalQty: number
}

export type StoredCart = {
  id: string
  name: string
  lines: StoredCartLine[]
  totals: CartTotals
  updatedAt: number
}

export type CartStore = {
  version: number
  activeCartId: string | null
  carts: StoredCart[]
}

export type CartStoreSnapshot = {
  store: CartStore
  canPersist: boolean
}

const defaultStore: CartStore = {
  version: STORAGE_VERSION,
  activeCartId: null,
  carts: [],
}

function isLocalStorageAvailable() {
  if (typeof localStorage === 'undefined') return false
  try {
    const probeKey = '__sell_cart_probe__'
    localStorage.setItem(probeKey, '1')
    localStorage.removeItem(probeKey)
    return true
  } catch {
    return false
  }
}

function isIndexedDbAvailable() {
  return typeof indexedDB !== 'undefined'
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open cart database'))
    }

    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}

function sanitizeNumber(value: unknown, fallback: number) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function sanitizeCartLine(candidate: unknown): StoredCartLine | null {
  if (!candidate || typeof candidate !== 'object') return null
  const line = candidate as Partial<StoredCartLine>
  if (!line.productId || !line.name) return null
  const price = sanitizeNumber(line.price, NaN)
  const qty = sanitizeNumber(line.qty, NaN)
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return null
  const taxRate =
    typeof line.taxRate === 'number' && Number.isFinite(line.taxRate)
      ? line.taxRate
      : undefined
  return { productId: String(line.productId), name: String(line.name), price, qty, taxRate }
}

export function computeCartTotals(lines: StoredCartLine[]): CartTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0)
  const taxTotal = lines.reduce(
    (sum, line) => sum + (line.taxRate ?? 0) * line.price * line.qty,
    0,
  )
  const discountTotal = 0
  const total = subtotal - discountTotal + taxTotal
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0)
  return { subtotal, taxTotal, discountTotal, total, totalQty }
}

function sanitizeCart(candidate: unknown): StoredCart | null {
  if (!candidate || typeof candidate !== 'object') return null
  const cart = candidate as Partial<StoredCart>
  if (!cart.id) return null
  const lines = Array.isArray(cart.lines)
    ? cart.lines
        .map(sanitizeCartLine)
        .filter((line): line is StoredCartLine => Boolean(line))
    : []
  const totals = computeCartTotals(lines)
  const name = typeof cart.name === 'string' && cart.name.trim() ? cart.name.trim() : 'Untitled cart'
  const updatedAt = sanitizeNumber(cart.updatedAt, Date.now())
  return { id: String(cart.id), name, lines, totals, updatedAt }
}

function sanitizeStore(candidate: unknown): CartStore {
  if (!candidate || typeof candidate !== 'object') return { ...defaultStore }
  const raw = candidate as Partial<CartStore>
  const carts = Array.isArray(raw.carts)
    ? raw.carts
        .map(sanitizeCart)
        .filter((cart): cart is StoredCart => Boolean(cart))
        .map(cart => ({ ...cart, totals: computeCartTotals(cart.lines) }))
    : []
  const activeCartId = carts.some(cart => cart.id === raw.activeCartId)
    ? (raw.activeCartId as string)
    : null
  return {
    version: STORAGE_VERSION,
    activeCartId,
    carts,
  }
}

async function readFromLocalStorage(): Promise<CartStoreSnapshot> {
  if (!isLocalStorageAvailable()) return { store: { ...defaultStore }, canPersist: false }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const store = sanitizeStore(parsed)
    return { store, canPersist: true }
  } catch {
    return { store: { ...defaultStore }, canPersist: true }
  }
}

async function readFromIndexedDb(): Promise<CartStoreSnapshot> {
  if (!isIndexedDbAvailable()) return { store: { ...defaultStore }, canPersist: false }
  try {
    const db = await openDatabase()
    const store = await new Promise<CartStore>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const objectStore = tx.objectStore(STORE_NAME)
      const request = objectStore.get(STORAGE_KEY)
      request.onerror = () => reject(request.error ?? new Error('Failed to read cart store'))
      request.onsuccess = () => {
        const record = request.result as { key: string; value: CartStore } | undefined
        resolve(record?.value ?? { ...defaultStore })
      }
    })
    return { store: sanitizeStore(store), canPersist: true }
  } catch {
    return { store: { ...defaultStore }, canPersist: false }
  }
}

export async function loadCartStore(): Promise<CartStoreSnapshot> {
  const localResult = await readFromLocalStorage()
  if (localResult.canPersist) return localResult
  return readFromIndexedDb()
}

export async function persistCartStore(store: CartStore): Promise<void> {
  const sanitized = sanitizeStore(store)
  const stringified = JSON.stringify(sanitized)
  if (isLocalStorageAvailable()) {
    try {
      localStorage.setItem(STORAGE_KEY, stringified)
    } catch (error) {
      console.warn('[cartStorage] Failed to persist to localStorage', error)
    }
  }

  if (isIndexedDbAvailable()) {
    try {
      const db = await openDatabase()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const objectStore = tx.objectStore(STORE_NAME)
        const request = objectStore.put({ key: STORAGE_KEY, value: sanitized })
        request.onerror = () => reject(request.error ?? new Error('Failed to save cart store'))
        request.onsuccess = () => resolve()
      })
    } catch (error) {
      console.warn('[cartStorage] Failed to persist to IndexedDB', error)
    }
  }
}

export function buildCartEntry(
  id: string,
  name: string,
  lines: StoredCartLine[],
  updatedAt = Date.now(),
): StoredCart {
  const safeName = name.trim() || 'Untitled cart'
  const sanitizedLines = lines
    .map(sanitizeCartLine)
    .filter((line): line is StoredCartLine => Boolean(line))
  return {
    id,
    name: safeName,
    lines: sanitizedLines,
    totals: computeCartTotals(sanitizedLines),
    updatedAt,
  }
}
