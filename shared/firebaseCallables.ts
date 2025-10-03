
export type SupabaseEndpointDefinition = {
  type: 'edge-function'
  name: string
}

export const SUPABASE_FUNCTIONS = {
  BACKFILL_MY_STORE: { type: 'edge-function', name: 'backfill-my-store' },
  INITIALIZE_STORE: { type: 'edge-function', name: 'initialize-store' },
  AFTER_SIGNUP_BOOTSTRAP: { type: 'edge-function', name: 'after-signup-bootstrap' },
  RESOLVE_STORE_ACCESS: { type: 'edge-function', name: 'resolve-store-access' },
  MANAGE_STAFF_ACCOUNT: { type: 'edge-function', name: 'manage-staff-account' },
  REVOKE_STAFF_ACCESS: { type: 'edge-function', name: 'revoke-staff-access' },
  UPDATE_STORE_PROFILE: { type: 'edge-function', name: 'update-store-profile' },
  RECEIVE_STOCK: { type: 'edge-function', name: 'receive-stock' },
} as const satisfies Record<string, SupabaseEndpointDefinition>

export type SupabaseFunctionKey = keyof typeof SUPABASE_FUNCTIONS

export type SupabaseFunctionName = (typeof SUPABASE_FUNCTIONS)[SupabaseFunctionKey]['name']

// Temporary compatibility export for modules that still consume the legacy callable names.
// Each entry resolves to the edge function identifier that replaced the Firebase callable.
export const FIREBASE_CALLABLES: Record<SupabaseFunctionKey, SupabaseFunctionName> = Object.fromEntries(
  Object.entries(SUPABASE_FUNCTIONS).map(([key, definition]) => [key, definition.name]),
) as Record<SupabaseFunctionKey, SupabaseFunctionName>

