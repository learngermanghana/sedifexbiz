/**
 * Legacy helper that now maps Firebase callable identifiers to Supabase Edge
 * Function names.  Web clients should migrate to the Supabase naming but the
 * constant is kept for backwards compatibility until the UI is updated.
 */

export const SUPABASE_EDGE_FUNCTIONS = {
  BACKFILL_MY_STORE: 'backfill-my-store',
  INITIALIZE_STORE: 'initialize-store',
  AFTER_SIGNUP_BOOTSTRAP: 'after-signup-bootstrap',
  RESOLVE_STORE_ACCESS: 'resolve-store-access',
  MANAGE_STAFF_ACCOUNT: 'manage-staff-account',
  REVOKE_STAFF_ACCESS: 'revoke-staff-access',
  UPDATE_STORE_PROFILE: 'update-store-profile',
  RECEIVE_STOCK: 'receive-stock',
} as const

export type SupabaseEdgeFunctionKey = keyof typeof SUPABASE_EDGE_FUNCTIONS
export type SupabaseEdgeFunctionName =
  (typeof SUPABASE_EDGE_FUNCTIONS)[SupabaseEdgeFunctionKey]

export const LEGACY_CALLABLE_TO_SUPABASE: Record<string, SupabaseEdgeFunctionName> = {
  backfillMyStore: SUPABASE_EDGE_FUNCTIONS.BACKFILL_MY_STORE,
  initializeStore: SUPABASE_EDGE_FUNCTIONS.INITIALIZE_STORE,
  afterSignupBootstrap: SUPABASE_EDGE_FUNCTIONS.AFTER_SIGNUP_BOOTSTRAP,
  resolveStoreAccess: SUPABASE_EDGE_FUNCTIONS.RESOLVE_STORE_ACCESS,
  manageStaffAccount: SUPABASE_EDGE_FUNCTIONS.MANAGE_STAFF_ACCOUNT,
  revokeStaffAccess: SUPABASE_EDGE_FUNCTIONS.REVOKE_STAFF_ACCESS,
  updateStoreProfile: SUPABASE_EDGE_FUNCTIONS.UPDATE_STORE_PROFILE,
  receiveStock: SUPABASE_EDGE_FUNCTIONS.RECEIVE_STOCK,
}

/** @deprecated Use {@link SUPABASE_EDGE_FUNCTIONS} instead. */
export const FIREBASE_CALLABLES = SUPABASE_EDGE_FUNCTIONS

export type FirebaseCallableName = SupabaseEdgeFunctionName
export type FirebaseCallableKey = SupabaseEdgeFunctionKey

export function getSupabaseEdgeUrl(name: SupabaseEdgeFunctionName): string {
  return `/functions/v1/${name}`
}
