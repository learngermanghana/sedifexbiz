// functions/src/plans.ts

// The IDs you’ll store in Firestore and send to Paystack
export type PlanId =
  | 'starter-monthly'
  | 'starter-yearly'
  | 'business-yearly'

export type Plan = {
  id: PlanId
  label: string
  months: number
  monthlyPriceGhs: number
  totalPriceGhs: number
  discountPercent: number | null
  isDefault?: boolean
}

// 👉 Default plan used when nothing is specified
export const DEFAULT_PLAN_ID: PlanId = 'starter-monthly'

// 👉 Central plan catalog (adjust prices/labels as you like)
const PLAN_CATALOG: Record<PlanId, Plan> = {
  'starter-monthly': {
    id: 'starter-monthly',
    label: 'Starter Monthly',
    months: 1,
    monthlyPriceGhs: 100,
    totalPriceGhs: 100,
    discountPercent: null,
    isDefault: true,
  },
  'starter-yearly': {
    id: 'starter-yearly',
    label: 'Starter Yearly',
    months: 12,
    monthlyPriceGhs: 92,
    totalPriceGhs: 1100,
    discountPercent: 17,
  },
  'business-yearly': {
    id: 'business-yearly',
    label: 'Business Yearly',
    months: 12,
    monthlyPriceGhs: 208,
    totalPriceGhs: 2500,
    discountPercent: null,
  },
}

// 👉 What your other code expects from getBillingConfig()
export function getBillingConfig() {
  return {
    // Free trial length in days (used in index.ts initializeStoreImpl)
    trialDays: 14,
    defaultPlanId: DEFAULT_PLAN_ID,
    plans: PLAN_CATALOG,
  }
}

// 👉 Map various string values to a canonical PlanId
const PLAN_ALIAS_MAP: Record<string, PlanId> = {
  // Starter
  starter: 'starter-monthly',
  'starter-monthly': 'starter-monthly',
  'starter-yearly': 'starter-yearly',
  'starter-annual': 'starter-yearly',
  yearly: 'starter-yearly',
  annual: 'starter-yearly',

  // Business
  business: 'business-yearly',
  'business-yearly': 'business-yearly',
  'business-annual': 'business-yearly',
}

/**
 * Normalize any incoming plan string (from frontend/metadata) into a PlanId.
 * Returns null if we don’t recognize it.
 */
export function normalizePlanId(raw: unknown): PlanId | null {
  if (!raw || typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase()
  return PLAN_ALIAS_MAP[key] ?? null
}

/**
 * Safely get a plan config by id.
 * If planId is missing or unknown, it falls back to DEFAULT_PLAN_ID.
 */
export function getPlanById(planId?: PlanId | null): Plan | null {
  const id = planId ?? DEFAULT_PLAN_ID
  return PLAN_CATALOG[id] ?? PLAN_CATALOG[DEFAULT_PLAN_ID]
}

/**
 * Upsert plan catalog into Firestore or another storage.
 * For now we keep it as a NO-OP so callers in paystack.ts can await it safely.
 * You can later implement real syncing if you want.
 */
export async function upsertPlanCatalog(): Promise<void> {
  // No-op: safe to remove or expand later.
  return
}
