// web/src/controllers/accessController.ts
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

type RawSeededDocument = {
  id?: unknown
  data?: unknown
}

type RawResolveStoreAccessResponse = {
  ok?: unknown
  storeId?: unknown
  role?: unknown
  claims?: unknown
  teamMember?: RawSeededDocument
  store?: RawSeededDocument
  products?: RawSeededDocument[] | unknown
  customers?: RawSeededDocument[] | unknown
}

export type SeededDocument = {
  id: string
  data: Record<string, unknown>
}

export type ResolveStoreAccessResult = {
  ok: boolean
  storeId: string
  role: 'owner' | 'staff'
  claims?: unknown
  teamMember: SeededDocument | null
  store: SeededDocument | null
  products: SeededDocument[]
  customers: SeededDocument[]
}

function normalizeRole(value: unknown): 'owner' | 'staff' {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'owner') return 'owner'
  }
  return 'staff'
}

function normalizeSeededDocument(input: RawSeededDocument | unknown): SeededDocument | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const candidate = input as RawSeededDocument
  const rawId = candidate.id
  if (typeof rawId !== 'string') {
    return null
  }

  const id = rawId.trim()
  if (!id) {
    return null
  }

  const rawData = candidate.data
  if (!rawData || typeof rawData !== 'object') {
    return { id, data: {} }
  }

  return { id, data: { ...(rawData as Record<string, unknown>) } }
}

function normalizeSeededCollection(value: RawSeededDocument[] | unknown): SeededDocument[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(item => normalizeSeededDocument(item))
    .filter((item): item is SeededDocument => item !== null)
}

const resolveStoreAccessCallable = httpsCallable<void, RawResolveStoreAccessResponse>(
  functions,
  'resolveStoreAccess',
)

export async function resolveStoreAccess(): Promise<ResolveStoreAccessResult> {
  const response = await resolveStoreAccessCallable()
  const payload = response.data ?? {}

  const ok = payload.ok === true
  const storeId = typeof payload.storeId === 'string' ? payload.storeId.trim() : ''

  if (!ok || !storeId) {
    throw new Error('Unable to resolve store access for this account.')
  }

  return {
    ok,
    storeId,
    role: normalizeRole(payload.role),
    claims: payload.claims,
    teamMember: normalizeSeededDocument(payload.teamMember ?? null),
    store: normalizeSeededDocument(payload.store ?? null),
    products: normalizeSeededCollection(payload.products),
    customers: normalizeSeededCollection(payload.customers),
  }
}
