// web/src/controllers/accessController.ts
import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

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
  storeId?: string | null
}

type RawInitializeStoreResponse = {
  ok?: unknown
  storeId?: unknown
  claims?: unknown
  role?: unknown
}

type RawResolveStoreAccessResponse = {
  ok?: unknown
  storeId?: unknown
  workspaceSlug?: unknown
  role?: unknown
  claims?: unknown
}

export type ResolveStoreAccessResult = {
  ok: boolean
  storeId: string
  workspaceSlug: string
  role: 'owner' | 'staff'
  claims?: unknown
}

function normalizeRole(value: unknown): 'owner' | 'staff' {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'owner') return 'owner'
  }
  return 'staff'
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

const AFTER_SIGNUP_BOOTSTRAP_TIMEOUT_MS = 1000 * 12 // 12 seconds

export const INACTIVE_WORKSPACE_MESSAGE =
  'Your Sedifex workspace is inactive. Please contact the workspace owner or Sedifex support to reactivate it.'

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

export async function initializeStore(
  contact?: InitializeStoreContactPayload,
  storeId?: string | null,
) {
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

  if (storeId !== undefined) {
    payload = { ...(payload ?? {}), storeId: storeId ?? null }
  }

  const response = await initializeStoreCallable(payload)
  const data = response.data ?? {}

  const ok = data.ok === true
  const resolvedStoreId = typeof data.storeId === 'string' ? data.storeId.trim() : ''
  const role = normalizeSignupRoleInput((data as any).role) ?? 'owner'

  if (!ok || !resolvedStoreId) {
    throw new Error('Unable to initialize the Sedifex workspace.')
  }

  return {
    storeId: resolvedStoreId,
    claims: data.claims,
    role,
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
  const workspaceSlug =
    typeof payload.workspaceSlug === 'string' ? payload.workspaceSlug.trim() : ''

  if (!ok || !resolvedStoreId || !workspaceSlug) {
    throw new Error('Unable to resolve store access for this account.')
  }

  return {
    ok,
    storeId: resolvedStoreId,
    workspaceSlug,
    role: normalizeRole(payload.role),
    claims: payload.claims,
  }
}

/**
 * Bootstraps a new workspace after signup while avoiding an indefinite loading state.
 */
export async function afterSignupBootstrap(options?: {
  contact?: InitializeStoreContactPayload
  storeId?: string | null
}) {
  const controller = new AbortController()

  const timeout = setTimeout(() => {
    controller.abort()
  }, AFTER_SIGNUP_BOOTSTRAP_TIMEOUT_MS)

  try {
    const bootstrap = initializeStore(options?.contact, options?.storeId)
    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () =>
        reject(new Error('Workspace setup is taking longer than expected.')),
      )
    })

    return await Promise.race([bootstrap, abortPromise])
  } finally {
    clearTimeout(timeout)
  }
}
