/**
 * Supabase migration manifest for legacy Firebase Functions.
 *
 * This module inventories every callable/HTTPS function that previously lived in
 * `functions/src/index.ts` and documents the Supabase Edge Function (or
 * equivalent server runtime) that will replace it.  Each entry describes the
 * responsibility of the Firebase implementation, the new trigger that should be
 * configured in Supabase, and any implementation notes that developers should
 * keep in mind while porting the business logic.
 */

export type HttpTrigger = {
  type: 'http'
  method: 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  auth: 'service-role' | 'user-jwt' | 'public'
}

export type CronTrigger = {
  type: 'cron'
  schedule: string
  description?: string
}

export type AuthTrigger = {
  type: 'auth'
  event: 'user.created' | 'user.deleted' | 'user.updated'
}

export type PostgresTrigger = {
  type: 'postgres'
  table: string
  events: Array<'INSERT' | 'UPDATE' | 'DELETE'>
  filter?: string
}

export type SupabaseTrigger = HttpTrigger | CronTrigger | AuthTrigger | PostgresTrigger

export type CallableInventoryEntry = {
  legacyName:
    | 'backfillMyStore'
    | 'initializeStore'
    | 'afterSignupBootstrap'
    | 'resolveStoreAccess'
    | 'manageStaffAccount'
    | 'revokeStaffAccess'
    | 'updateStoreProfile'
    | 'receiveStock'
  summary: string
  supabaseFunction: string
  trigger: SupabaseTrigger
  notes?: string[]
}

export const callableInventory: CallableInventoryEntry[] = [
  {
    legacyName: 'backfillMyStore',
    summary:
      'Ensures that the authenticated user has an owner membership and creates a default workspace record when necessary.',
    supabaseFunction: 'backfill-my-store',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/backfill-my-store',
      auth: 'user-jwt',
    },
    notes: [
      'Invoked immediately after sign-up to synchronise the roster entry with Supabase Postgres.',
      'Requires a service-role helper to upsert rows in `store_memberships` and `stores` tables.',
    ],
  },
  {
    legacyName: 'initializeStore',
    summary:
      'Bootstraps workspace metadata (name, owner details, contact information) and propagates role claims.',
    supabaseFunction: 'initialize-store',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/initialize-store',
      auth: 'user-jwt',
    },
    notes: [
      'Persists workspace profile rows in Postgres and updates Auth app_metadata via the Supabase Admin API.',
      'Should run inside a transactional RPC that touches `stores`, `store_memberships`, and audit tables.',
    ],
  },
  {
    legacyName: 'afterSignupBootstrap',
    summary:
      'Collects optional onboarding contact fields and enriches the primary workspace + member profile.',
    supabaseFunction: 'after-signup-bootstrap',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/after-signup-bootstrap',
      auth: 'user-jwt',
    },
    notes: [
      'Writes to shared onboarding tables (e.g. `store_contacts`) and emits telemetry events.',
      'Should reuse the initialize-store RPC helpers to avoid drift between onboarding flows.',
    ],
  },
  {
    legacyName: 'resolveStoreAccess',
    summary:
      'Returns the active workspace membership for the signed-in user (owner or staff).',
    supabaseFunction: 'resolve-store-access',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/resolve-store-access',
      auth: 'user-jwt',
    },
    notes: [
      'Reads from the `store_memberships` table using RLS policies scoped to the current user.',
      'Falls back to the Supabase Auth session when membership metadata is missing.',
    ],
  },
  {
    legacyName: 'manageStaffAccount',
    summary:
      'Creates or updates staff memberships, invites users, and applies store-level role claims.',
    supabaseFunction: 'manage-staff-account',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/manage-staff-account',
      auth: 'user-jwt',
    },
    notes: [
      'Requires service-role access to `store_memberships`, `staff_invitations`, and Supabase Auth Admin APIs.',
      'Edge Function should validate ownership before mutating Postgres rows.',
    ],
  },
  {
    legacyName: 'revokeStaffAccess',
    summary:
      'Revokes staff memberships, cleans up invitations, and removes elevated claims.',
    supabaseFunction: 'revoke-staff-access',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/revoke-staff-access',
      auth: 'user-jwt',
    },
    notes: [
      'Edge Function should delete membership rows and call `auth.admin.updateUserById` to reset metadata.',
      'Soft deletes can be handled by toggling an `active` column instead of removing rows outright.',
    ],
  },
  {
    legacyName: 'updateStoreProfile',
    summary:
      'Allows workspace owners to update name, timezone, and currency metadata.',
    supabaseFunction: 'update-store-profile',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/update-store-profile',
      auth: 'user-jwt',
    },
    notes: [
      'Supabase RPC should validate timezone + currency fields and persist them in the `stores` table.',
      'Consider caching store timezones in Redis/Edge KV for daily summary jobs.',
    ],
  },
  {
    legacyName: 'receiveStock',
    summary:
      'Records inbound stock receipts, ledger entries, and per-product adjustments.',
    supabaseFunction: 'receive-stock',
    trigger: {
      type: 'http',
      method: 'POST',
      path: '/functions/v1/receive-stock',
      auth: 'user-jwt',
    },
    notes: [
      'Wrap mutations inside a `rpc_receive_stock` Postgres function to guarantee atomic inventory updates.',
      'Emit product summary increments via NOTIFY/LISTEN so background workers can refresh analytics.',
    ],
  },
]

export type EventInventoryEntry = {
  legacyExport:
    | 'handleUserCreate'
    | 'onSaleCreate'
    | 'onReceiptCreate'
    | 'onCustomerCreate'
    | 'onCloseoutCreate'
    | 'runNightlyDataHygiene'
  summary: string
  supabaseFunction: string
  trigger: SupabaseTrigger
  notes?: string[]
}

export const eventInventory: EventInventoryEntry[] = [
  {
    legacyExport: 'handleUserCreate',
    summary: 'Synchronises Auth user creation events into the roster membership table.',
    supabaseFunction: 'sync-user-profile',
    trigger: { type: 'auth', event: 'user.created' },
    notes: [
      'Use Supabase Auth Hooks with a service-role Edge Function to seed `store_memberships` records.',
      'Should normalise phone numbers and timestamps before inserting rows.',
    ],
  },
  {
    legacyExport: 'onSaleCreate',
    summary: 'Updates daily sales summaries when a sale document is inserted.',
    supabaseFunction: 'sale-created-trigger',
    trigger: { type: 'postgres', table: 'sales', events: ['INSERT'] },
    notes: [
      'Replace Firestore document triggers with Postgres triggers or `supabase.functions.invoke` from row-level triggers.',
      'Prefer transactional logic implemented inside Postgres functions for aggregation.',
    ],
  },
  {
    legacyExport: 'onReceiptCreate',
    summary: 'Maintains daily receipt summaries and product statistics.',
    supabaseFunction: 'receipt-created-trigger',
    trigger: { type: 'postgres', table: 'receipts', events: ['INSERT'] },
    notes: [
      'Can be converted into an AFTER INSERT trigger that enqueues work via NOTIFY for Supabase Edge Workers.',
    ],
  },
  {
    legacyExport: 'onCustomerCreate',
    summary: 'Increments customer analytics and ensures daily summary consistency.',
    supabaseFunction: 'customer-created-trigger',
    trigger: { type: 'postgres', table: 'customers', events: ['INSERT'] },
    notes: [
      'Attach to Postgres triggers that write into `daily_customer_stats` tables.',
    ],
  },
  {
    legacyExport: 'onCloseoutCreate',
    summary: 'Processes register close-out reports and updates daily aggregates.',
    supabaseFunction: 'closeout-created-trigger',
    trigger: { type: 'postgres', table: 'closeouts', events: ['INSERT'] },
    notes: [
      'Supabase background workers can subscribe to NOTIFY events emitted from the trigger function.',
    ],
  },
  {
    legacyExport: 'runNightlyDataHygiene',
    summary: 'Nightly cron that recomputes stale daily summaries and cleans activity logs.',
    supabaseFunction: 'run-nightly-data-hygiene',
    trigger: { type: 'cron', schedule: '0 4 * * *', description: 'Runs at 04:00 UTC daily' },
    notes: [
      'Use the Supabase Scheduler (or your deployment platform cron) to invoke an Edge Function with service-role credentials.',
      'Should call Postgres maintenance routines and refresh cached analytics materialized views.',
    ],
  },
]

export type MigrationManifest = {
  callables: CallableInventoryEntry[]
  events: EventInventoryEntry[]
}

export const migrationManifest: MigrationManifest = {
  callables: callableInventory,
  events: eventInventory,
}

export function describeSupabaseHttpRoutes(): HttpTrigger[] {
  return callableInventory
    .map(entry => entry.trigger)
    .filter((trigger): trigger is HttpTrigger => trigger.type === 'http')
}

export function describeSupabaseCronJobs(): CronTrigger[] {
  return eventInventory
    .map(entry => entry.trigger)
    .filter((trigger): trigger is CronTrigger => trigger.type === 'cron')
}

export function describeSupabasePostgresHooks(): PostgresTrigger[] {
  return eventInventory
    .map(entry => entry.trigger)
    .filter((trigger): trigger is PostgresTrigger => trigger.type === 'postgres')
}

export function describeSupabaseAuthHooks(): AuthTrigger[] {
  return eventInventory
    .map(entry => entry.trigger)
    .filter((trigger): trigger is AuthTrigger => trigger.type === 'auth')
}
