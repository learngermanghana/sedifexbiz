// web/src/controllers/accessController.ts
import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

type RawSeededDocument = {
  id?: unknown
  data?: unknown
}

export type SignupRoleOption = 'owner' | 'team-member'

export type InitializeStoreContactPayload = {
  phone?: string | null
  firstSignupEmail?: string | null
  ownerName?: string | null
  businessName?: string | null
  country?: string | null
  town?: string | null
  signupRole?: SignupRoleOption | null
}

function normalizeSignupRoleInput(value: SignupRoleOption | null | undefined): SignupRoleOption | null {
  if (value === 'team-member') {
    return 'team-member'
  }
  if (value === 'owner') {
    return 'owner'
  }
  return null
}

type InitializeStorePayload = {
  contact?: InitializeStoreContactPayload
}

type RawInitializeStoreResponse = {
  ok?: unknown
  storeId?: unknown
  claims?: unknown
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

type ResolveStoreAccessPayload = {
  storeId?: string
}

const initializeStoreCallable = httpsCallable<
  InitializeStorePayload,
  RawInitializeStoreResponse
>(functions, 'initializeStore')

const resolveStoreAccessCallable = httpsCallable<
  ResolveStoreAccessPayload,
  RawResolveStoreAccessResponse
>(
  functions,
  'resolveStoreAccess',
)

export const INACTIVE_WORKSPACE_MESSAGE =
  'Your Sedifex workspace contract is not active. Reach out to your Sedifex administrator to restore access.'

type FirebaseCallableError = FirebaseError & {
  customData?: {
    body?: {
      error?: { message?: unknown }
    }
  }
}

export function extractCallableErrorMessage(error: FirebaseError): string | null {
  const callableError = error as FirebaseCallableError
  const bodyMessage = callableError.customData?.body?.error?.message
  if (typeof bodyMessage === 'string') {
    const trimmed = bodyMessage.trim()
    if (trimmed) {
      return trimmed
    }
  }

  const raw = typeof error.message === 'string' ? error.message : ''
  const withoutFirebasePrefix = raw.replace(/^Firebase:\s*/i, '')
  const colonIndex = withoutFirebasePrefix.indexOf(':')
  const normalized =
    colonIndex >= 0
      ? withoutFirebasePrefix.slice(colonIndex + 1).trim()
      : withoutFirebasePrefix.trim()
  return normalized || null
}

export async function initializeStore(contact?: InitializeStoreContactPayload) {
  let payload: InitializeStorePayload | undefined

  if (contact) {
    const payloadContact: InitializeStoreContactPayload = {}
    let hasContactField = false

    if (contact.phone !== undefined) {
      payloadContact.phone = contact.phone ?? null
      hasContactField = true
    }
    if (contact.firstSignupEmail !== undefined) {
      payloadContact.firstSignupEmail = contact.firstSignupEmail ?? null
      hasContactField = true
    }
    if (contact.ownerName !== undefined) {
      payloadContact.ownerName = contact.ownerName ?? null
      hasContactField = true
    }
    if (contact.businessName !== undefined) {
      payloadContact.businessName = contact.businessName ?? null
      hasContactField = true
    }
    if (contact.country !== undefined) {
      payloadContact.country = contact.country ?? null
      hasContactField = true
    }
    if (contact.town !== undefined) {
      payloadContact.town = contact.town ?? null
      hasContactField = true
    }
    if (contact.signupRole !== undefined) {
      payloadContact.signupRole = normalizeSignupRoleInput(contact.signupRole)
      hasContactField = true
    }

    if (hasContactField) {
      payload = { contact: payloadContact }
    }
  }

  const response = await initializeStoreCallable(payload)
  const data = response.data ?? {}

  const ok = data.ok === true
  const storeId = typeof data.storeId === 'string' ? data.storeId.trim() : ''

  if (!ok || !storeId) {
    throw new Error('Unable to initialize the Sedifex workspace.')
  }

  return {
    storeId,
    claims: data.claims,
  }
}

export async function resolveStoreAccess(storeId?: string): Promise<ResolveStoreAccessResult> {
  let response
  try {
    const trimmedStoreId = typeof storeId === 'string' ? storeId.trim() : ''
    const payload = trimmedStoreId ? { storeId: trimmedStoreId } : undefined
    response = await resolveStoreAccessCallable(payload)
  } catch (error) {
    if (error instanceof FirebaseError && error.code === 'functions/permission-denied') {
      const message = extractCallableErrorMessage(error) ?? INACTIVE_WORKSPACE_MESSAGE
      throw new Error(message)
    }
    throw error
  }
  const payload = response.data ?? {}

  const ok = payload.ok === true
  const resolvedStoreId = typeof payload.storeId === 'string' ? payload.storeId.trim() : ''

  if (!ok || !resolvedStoreId) {
    throw new Error('Unable to resolve store access for this account.')
  }

  return {
    ok,
    storeId: resolvedStoreId,
    role: normalizeRole(payload.role),
    claims: payload.claims,
    teamMember: normalizeSeededDocument(payload.teamMember ?? null),
    store: normalizeSeededDocument(payload.store ?? null),
    products: normalizeSeededCollection(payload.products),
    customers: normalizeSeededCollection(payload.customers),
  }
}
