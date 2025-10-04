// web/src/controllers/storeController.ts
import { SUPABASE_FUNCTIONS, type SupabaseEndpointDefinition } from '@shared/firebaseCallables'

import { invokeSupabaseFunction } from '../supabaseFunctionsClient'

type ManageStaffAccountPayload = {
  storeId: string
  email: string
  role: string
  password?: string
}

type ManageStaffAccountResult = {
  ok: boolean
  storeId: string
  role: string
  email: string
  uid: string
  created: boolean
}

type UpdateStoreProfilePayload = {
  storeId: string
  name: string
  timezone: string
  currency: string
}

type UpdateStoreProfileResult = {
  ok: boolean
  storeId: string
}

type RevokeStaffAccessPayload = {
  storeId: string
  uid: string
}

type RevokeStaffAccessResult = {
  ok: boolean
  storeId: string
  uid: string
}

async function invokeSupabaseEdgeFunction<Payload, Result>(
  definition: SupabaseEndpointDefinition,
  payload: Payload,
): Promise<Result> {
  const { data, error } = await invokeSupabaseFunction<Payload, Result>(definition.name, {
    payload,
  })

  if (error) {
    throw error
  }

  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const details = (data as { error?: unknown }).error as unknown
    const message =
      typeof details === 'string'
        ? details
        : details && typeof details === 'object' && 'message' in (details as Record<string, unknown>)
          ? String((details as Record<string, unknown>).message)
          : 'Supabase function reported an error'
    throw new Error(message)
  }

  if (data === null || data === undefined) {
    throw new Error(`No response returned from ${definition.name}`)
  }

  return data as Result
}

export async function manageStaffAccount(payload: ManageStaffAccountPayload) {
  return invokeSupabaseEdgeFunction<ManageStaffAccountPayload, ManageStaffAccountResult>(
    SUPABASE_FUNCTIONS.MANAGE_STAFF_ACCOUNT,
    payload,
  )
}

export async function updateStoreProfile(payload: UpdateStoreProfilePayload) {
  return invokeSupabaseEdgeFunction<UpdateStoreProfilePayload, UpdateStoreProfileResult>(
    SUPABASE_FUNCTIONS.UPDATE_STORE_PROFILE,
    payload,
  )
}

export async function revokeStaffAccess(payload: RevokeStaffAccessPayload) {
  return invokeSupabaseEdgeFunction<RevokeStaffAccessPayload, RevokeStaffAccessResult>(
    SUPABASE_FUNCTIONS.REVOKE_STAFF_ACCESS,
    payload,
  )
}
