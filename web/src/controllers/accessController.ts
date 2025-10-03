import { doc, getDoc } from 'firebase/firestore'

// web/src/controllers/accessController.ts
import { SUPABASE_FUNCTIONS, type SupabaseEndpointDefinition } from '@shared/firebaseCallables'

import { auth, db } from '../firebase'

import { supabase } from '../supabaseClient'

export type ResolveStoreAccessSuccess = {
  ok: true
  storeId: string
  role: 'owner' | 'staff'
}

export type ResolveStoreAccessError = {
  ok: false
  error: 'NO_MEMBERSHIP'
}

export type ResolveStoreAccessResult =
  | ResolveStoreAccessSuccess
  | ResolveStoreAccessError

type ContactPayload = {
  phone?: string | null
  phoneCountryCode?: string | null
  phoneLocalNumber?: string | null
  firstSignupEmail?: string | null
  company?: string | null
  ownerName?: string | null
  country?: string | null
  city?: string | null
}

type AfterSignupBootstrapPayload = {
  storeId?: string
  contact?: ContactPayload
}

async function invokeSupabaseEdgeFunction<Payload>(
  definition: SupabaseEndpointDefinition,
  payload: Payload | undefined,
): Promise<void> {
  const body = payload === undefined ? undefined : payload
  const { data, error } = await supabase.functions.invoke<unknown>(definition.name, { body })

  if (error) {
    throw error
  }

  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const details = (data as { error?: unknown }).error
    const message =
      typeof details === 'string'
        ? details
        : details && typeof details === 'object' && 'message' in (details as Record<string, unknown>)
          ? String((details as Record<string, unknown>).message)
          : 'Supabase function reported an error'
    throw new Error(message)
  }
}

export async function resolveStoreAccess(): Promise<ResolveStoreAccessResult> {
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user?.id) {
    return { ok: false, error: 'NO_MEMBERSHIP' }
  }

  try {
    const memberSnapshot = await getDoc(doc(db, 'teamMembers', user.id))
    if (!memberSnapshot.exists()) {
      return { ok: false, error: 'NO_MEMBERSHIP' }
    }

    const data = memberSnapshot.data() ?? {}
    const rawStoreId = typeof data.storeId === 'string' ? data.storeId.trim() : ''
    const rawRole = typeof data.role === 'string' ? data.role.trim().toLowerCase() : ''

    if (!rawStoreId || (rawRole !== 'owner' && rawRole !== 'staff')) {
      return { ok: false, error: 'NO_MEMBERSHIP' }
    }

    return {
      ok: true,
      storeId: rawStoreId,
      role: rawRole,
    }
  } catch (error) {
    console.warn('[access] Failed to resolve store access', error)
    return { ok: false, error: 'NO_MEMBERSHIP' }
  }
}

export async function afterSignupBootstrap(payload?: AfterSignupBootstrapPayload): Promise<void> {
  if (!payload) {
    await invokeSupabaseEdgeFunction(SUPABASE_FUNCTIONS.AFTER_SIGNUP_BOOTSTRAP, undefined)
    return
  }

  const normalized: AfterSignupBootstrapPayload = {}

  if (typeof payload.storeId === 'string') {
    const trimmed = payload.storeId.trim()
    if (trimmed) {
      normalized.storeId = trimmed
    }
  }

  if (payload.contact && typeof payload.contact === 'object') {
    const contact: NonNullable<AfterSignupBootstrapPayload['contact']> = {}

    if (payload.contact.phone !== undefined) {
      contact.phone = payload.contact.phone
    }

    if (payload.contact.phoneCountryCode !== undefined) {
      contact.phoneCountryCode = payload.contact.phoneCountryCode
    }

    if (payload.contact.phoneLocalNumber !== undefined) {
      contact.phoneLocalNumber = payload.contact.phoneLocalNumber
    }

    if (payload.contact.firstSignupEmail !== undefined) {
      contact.firstSignupEmail = payload.contact.firstSignupEmail
    }

    if (payload.contact.company !== undefined) {
      contact.company = payload.contact.company
    }

    if (payload.contact.ownerName !== undefined) {
      contact.ownerName = payload.contact.ownerName
    }

    if (payload.contact.country !== undefined) {
      contact.country = payload.contact.country
    }

    if (payload.contact.city !== undefined) {
      contact.city = payload.contact.city
    }

    if (Object.keys(contact).length > 0) {
      normalized.contact = contact
    }
  }

  const callablePayload = Object.keys(normalized).length > 0 ? normalized : undefined
  await invokeSupabaseEdgeFunction(SUPABASE_FUNCTIONS.AFTER_SIGNUP_BOOTSTRAP, callablePayload)
}
