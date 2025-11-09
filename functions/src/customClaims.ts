import { supabaseAdmin } from './firestore'
import { SupabaseFunctionError } from './supabaseError'

export type RoleClaimPayload = {
  uid: string
  role: string
  storeId: string
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function resolveCompanyName(uid: string, storeId: string): Promise<string | null> {
  const [{ data: membership }, { data: store }] = await Promise.all([
    supabaseAdmin
      .from('store_memberships')
      .select('company')
      .eq('user_id', uid)
      .eq('store_id', storeId)
      .maybeSingle(),
    supabaseAdmin.from('stores').select('company').eq('id', storeId).maybeSingle(),
  ])

  const memberCompany = normalizeString(membership?.company)
  const storeCompany = normalizeString(store?.company)
  return storeCompany ?? memberCompany ?? null
}

export async function applyRoleClaims({ uid, role, storeId }: RoleClaimPayload) {
  if (!uid) {
    throw new SupabaseFunctionError('bad-request', 'A user id is required to apply role claims')
  }

  const metadata: Record<string, unknown> = {
    role,
    activeStoreId: storeId,
  }

  const company = await resolveCompanyName(uid, storeId).catch(() => null)
  if (company) {
    metadata.company = company
  }

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(uid, {
    app_metadata: metadata,
  })

  if (error) {
    throw new SupabaseFunctionError('internal', 'Failed to apply Supabase role metadata', {
      cause: error,
    })
  }

  return data?.user?.app_metadata ?? metadata
}
