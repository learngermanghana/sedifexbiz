const STORAGE_KEY = 'sedifex:pending-product-ops'

let cachedStorageAvailability: boolean | null = null

type BasePendingProductOperation = {
  storeId: string
  createdAt: number
}

export type PendingProductCreateOperation = BasePendingProductOperation & {
  kind: 'create'
  clientId: string
  name: string
  sku: string
  price: number | null
  reorderThreshold: number | null
  stockCount: number | null
}

export type PendingProductUpdateOperation = BasePendingProductOperation & {
  kind: 'update'
  productId: string
  name: string
  sku: string
  price: number | null
  reorderThreshold: number | null
  previous: {
    name: string
    sku: string
    price: number | null
    reorderThreshold: number | null
  }
}

export type PendingProductOperation = PendingProductCreateOperation | PendingProductUpdateOperation

function isStorageAvailable(): boolean {
  if (cachedStorageAvailability !== null) {
    return cachedStorageAvailability
  }
  if (typeof window === 'undefined') {
    cachedStorageAvailability = false
    return false
  }
  try {
    const testKey = `${STORAGE_KEY}-test`
    window.localStorage.setItem(testKey, testKey)
    window.localStorage.removeItem(testKey)
    cachedStorageAvailability = true
    return true
  } catch (error) {
    console.warn('[pending-product-queue] Local storage unavailable', error)
    cachedStorageAvailability = false
    return false
  }
}

function readQueue(): PendingProductOperation[] {
  if (!isStorageAvailable()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidOperation).map(normalizeOperation)
  } catch (error) {
    console.warn('[pending-product-queue] Failed to read queue', error)
    return []
  }
}

function writeQueue(queue: PendingProductOperation[]) {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch (error) {
    console.warn('[pending-product-queue] Failed to write queue', error)
  }
}

function isValidNumber(value: unknown): value is number | null {
  if (value === null) return true
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidOperation(value: unknown): value is PendingProductOperation {
  if (!value || typeof value !== 'object') return false
  const op = value as Partial<PendingProductOperation>
  if (typeof op?.storeId !== 'string' || op.storeId.trim().length === 0) {
    return false
  }
  if (typeof op?.createdAt !== 'number' || !Number.isFinite(op.createdAt)) {
    return false
  }
  if (op.kind === 'create') {
    const createOp = op as Partial<PendingProductCreateOperation>
    if (typeof createOp.clientId !== 'string' || createOp.clientId.trim().length === 0) {
      return false
    }
    if (typeof createOp.name !== 'string') return false
    if (typeof createOp.sku !== 'string') return false
    if (!isValidNumber(createOp.price)) return false
    if (!isValidNumber(createOp.reorderThreshold)) return false
    if (!isValidNumber(createOp.stockCount)) return false
    return true
  }
  if (op.kind === 'update') {
    const updateOp = op as Partial<PendingProductUpdateOperation>
    if (typeof updateOp.productId !== 'string' || updateOp.productId.trim().length === 0) {
      return false
    }
    if (typeof updateOp.name !== 'string') return false
    if (typeof updateOp.sku !== 'string') return false
    if (!isValidNumber(updateOp.price)) return false
    if (!isValidNumber(updateOp.reorderThreshold)) return false
    if (!updateOp.previous || typeof updateOp.previous !== 'object') return false
    const { previous } = updateOp
    if (typeof previous.name !== 'string') return false
    if (typeof previous.sku !== 'string') return false
    if (!isValidNumber(previous.price)) return false
    if (!isValidNumber(previous.reorderThreshold)) return false
    return true
  }
  return false
}

function normalizeOperation(operation: PendingProductOperation): PendingProductOperation {
  if (operation.kind === 'create') {
    return {
      ...operation,
      name: operation.name ?? '',
      sku: operation.sku ?? '',
      price: typeof operation.price === 'number' && Number.isFinite(operation.price) ? operation.price : null,
      reorderThreshold:
        typeof operation.reorderThreshold === 'number' && Number.isFinite(operation.reorderThreshold)
          ? operation.reorderThreshold
          : null,
      stockCount:
        typeof operation.stockCount === 'number' && Number.isFinite(operation.stockCount)
          ? operation.stockCount
          : null,
    }
  }

  return {
    ...operation,
    name: operation.name ?? '',
    sku: operation.sku ?? '',
    price: typeof operation.price === 'number' && Number.isFinite(operation.price) ? operation.price : null,
    reorderThreshold:
      typeof operation.reorderThreshold === 'number' && Number.isFinite(operation.reorderThreshold)
        ? operation.reorderThreshold
        : null,
    previous: {
      name: operation.previous.name ?? '',
      sku: operation.previous.sku ?? '',
      price:
        typeof operation.previous.price === 'number' && Number.isFinite(operation.previous.price)
          ? operation.previous.price
          : null,
      reorderThreshold:
        typeof operation.previous.reorderThreshold === 'number' && Number.isFinite(operation.previous.reorderThreshold)
          ? operation.previous.reorderThreshold
          : null,
    },
  }
}

export async function queuePendingProductCreate(input: {
  clientId: string
  storeId: string
  name: string
  sku: string
  price: number | null
  reorderThreshold: number | null
  stockCount: number | null
}): Promise<void> {
  const queue = readQueue().filter(
    item => !(item.kind === 'create' && item.clientId === input.clientId && item.storeId === input.storeId),
  )
  queue.push({
    kind: 'create',
    clientId: input.clientId,
    storeId: input.storeId,
    name: input.name,
    sku: input.sku,
    price: input.price,
    reorderThreshold: input.reorderThreshold,
    stockCount: input.stockCount,
    createdAt: Date.now(),
  })
  writeQueue(queue)
}

export async function queuePendingProductUpdate(input: {
  productId: string
  storeId: string
  name: string
  sku: string
  price: number | null
  reorderThreshold: number | null
  previous: {
    name: string
    sku: string
    price: number | null
    reorderThreshold: number | null
  }
}): Promise<void> {
  const queue = readQueue().filter(
    item => !(item.kind === 'update' && item.productId === input.productId && item.storeId === input.storeId),
  )
  queue.push({
    kind: 'update',
    productId: input.productId,
    storeId: input.storeId,
    name: input.name,
    sku: input.sku,
    price: input.price,
    reorderThreshold: input.reorderThreshold,
    previous: { ...input.previous },
    createdAt: Date.now(),
  })
  writeQueue(queue)
}

export async function listPendingProductOperations(storeId?: string): Promise<PendingProductOperation[]> {
  const queue = readQueue()
  if (!storeId) {
    return queue.slice()
  }
  return queue.filter(item => item.storeId === storeId)
}

export async function removePendingProductCreate(clientId: string, storeId: string): Promise<void> {
  const queue = readQueue().filter(
    item => !(item.kind === 'create' && item.clientId === clientId && item.storeId === storeId),
  )
  writeQueue(queue)
}

export async function removePendingProductUpdate(productId: string, storeId: string): Promise<void> {
  const queue = readQueue().filter(
    item => !(item.kind === 'update' && item.productId === productId && item.storeId === storeId),
  )
  writeQueue(queue)
}

export async function replacePendingProductUpdateId(
  clientId: string,
  productId: string,
  storeId: string,
): Promise<void> {
  const queue = readQueue()
  let didUpdate = false
  const updated = queue.map(operation => {
    if (
      operation.kind === 'update' &&
      operation.storeId === storeId &&
      operation.productId === clientId
    ) {
      didUpdate = true
      return { ...operation, productId }
    }
    return operation
  })

  if (!didUpdate) {
    return
  }

  const deduped = updated.filter((operation, index) => {
    if (operation.kind !== 'update' || operation.storeId !== storeId) {
      return true
    }
    const firstIndex = updated.findIndex(
      other =>
        other.kind === 'update' &&
        other.storeId === storeId &&
        other.productId === operation.productId,
    )
    return firstIndex === index
  })

  writeQueue(deduped)
}

export async function clearPendingProductOperationsForStore(storeId: string): Promise<void> {
  const queue = readQueue().filter(item => item.storeId !== storeId)
  writeQueue(queue)
}
