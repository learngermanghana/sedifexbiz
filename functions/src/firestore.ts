import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SupabaseFunctionError } from './supabaseError'

export type Database = Record<string, never>

const defaultHeaders = {
  'X-Client-Info': 'sedifex-functions/edge-migration',
}

function createServiceRoleClient(): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new SupabaseFunctionError('internal', 'Missing SUPABASE_URL environment variable')
  }

  if (!key) {
    throw new SupabaseFunctionError(
      'internal',
      'Missing SUPABASE_SERVICE_ROLE_KEY environment variable',
    )
  }

  return createClient<Database>(url, key, {
    auth: { persistSession: false },
    global: { headers: defaultHeaders },
  })
}

export const supabaseAdmin = createServiceRoleClient()

const SUPPORTED_ROLES = new Set<'owner' | 'staff'>(['owner', 'staff'])

export type StoreContext = {
  storeId: string
  role: 'owner' | 'staff'
}

export async function getStoreContext(authUid: string): Promise<StoreContext> {
  if (!authUid) {
    throw new SupabaseFunctionError('unauthorized', 'Login required')
  }

  const { data, error } = await supabaseAdmin
    .from('store_memberships')
    .select('store_id, role')
    .eq('user_id', authUid)
    .eq('active', true)
    .maybeSingle()

  if (error) {
    throw new SupabaseFunctionError('internal', 'Failed to load workspace membership', {
      cause: error,
    })
  }

  if (!data) {
    throw new SupabaseFunctionError(
      'forbidden',
      'Workspace membership required to access this resource.',
    )
  }

  const storeIdRaw = typeof data.store_id === 'string' ? data.store_id.trim() : ''
  if (!storeIdRaw) {
    throw new SupabaseFunctionError(
      'failed-precondition',
      'Workspace membership is missing a store assignment.',
    )
  }

  const roleRaw = typeof data.role === 'string' ? data.role.trim().toLowerCase() : ''
  if (!SUPPORTED_ROLES.has(roleRaw as 'owner' | 'staff')) {
    throw new SupabaseFunctionError(
      'forbidden',
      'Workspace membership role is not permitted for this operation.',
    )
  }

  return { storeId: storeIdRaw, role: roleRaw as 'owner' | 'staff' }
}
