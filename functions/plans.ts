// functions/src/plans.ts

import { admin, defaultDb } from './src/firestore'

export type PlanId =
  | 'space-monthly'
  | 'space-quarterly'
  | 'space-semiannual'
  | 'space-annual'
  | 'trial'

export const PLAN_IDS: PlanId[] = [
  'space-monthly',
  'space-quarterly',
  'space-semiannual',
  'space-annual',
  'trial',
]

export const DEFAULT_PLAN_ID: PlanId = 'space-monthly'

export type PlanVariant = {
  id: PlanId
  label: string
  product: 'space'
  months: number
  monthlyPriceUsd: number
  discountPercent: number
  totalPriceUsd: number
}

const BASE_MONTHLY_PRICE_USD = 20

export const SPACE_PLAN_VARIANTS: PlanVariant[] = [
  {
    id: 'space-monthly',
    label: 'Space (1 month)',
    product: 'space',
    months: 1,
    monthlyPriceUsd: BASE_MONTHLY_PRICE_USD,
    discountPercent: 0,
    totalPriceUsd: BASE_MONTHLY_PRICE_USD,
  },
  {
    id: 'space-quarterly',
    label: 'Space (3 months)',
    product: 'space',
    months: 3,
    monthlyPriceUsd: BASE_MONTHLY_PRICE_USD,
    discountPercent: 0.05,
    totalPriceUsd: +(BASE_MONTHLY_PRICE_USD * 3 * 0.95).toFixed(2),
  },
  {
    id: 'space-semiannual',
    label: 'Space (6 months)',
    product: 'space',
    months: 6,
    monthlyPriceUsd: BASE_MONTHLY_PRICE_USD,
    discountPercent: 0.1,
    totalPriceUsd: +(BASE_MONTHLY_PRICE_USD * 6 * 0.9).toFixed(2),
  },
  {
    id: 'space-annual',
    label: 'Space (12 months)',
    product: 'space',
    months: 12,
    monthlyPriceUsd: BASE_MONTHLY_PRICE_USD,
    discountPercent: 0.15,
    totalPriceUsd: +(BASE_MONTHLY_PRICE_USD * 12 * 0.85).toFixed(2),
  },
]

const VALID_PLAN_IDS = new Set<PlanId>(PLAN_IDS as PlanId[])

export function normalizePlanId(value: unknown): PlanId | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  return VALID_PLAN_IDS.has(trimmed as PlanId) ? (trimmed as PlanId) : null
}

export function getPlanById(planId: PlanId | null | undefined): PlanVariant | null {
  if (!planId || planId === 'trial') return null
  return SPACE_PLAN_VARIANTS.find(plan => plan.id === planId) ?? null
}

export async function upsertPlanCatalog() {
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  await Promise.all(
    SPACE_PLAN_VARIANTS.map(async plan => {
      const ref = defaultDb.collection('plans').doc(plan.id)

      await defaultDb.runTransaction(async tx => {
        const snap = await tx.get(ref)
        const payload: admin.firestore.DocumentData = {
          product: plan.product,
          label: plan.label,
          months: plan.months,
          monthlyPriceUsd: plan.monthlyPriceUsd,
          discountPercent: plan.discountPercent,
          totalPriceUsd: plan.totalPriceUsd,
          updatedAt: timestamp,
        }

        if (!snap.exists) {
          payload.createdAt = timestamp
        }

        tx.set(ref, payload, { merge: true })
      })
    }),
  )
}

/**
 * Billing configuration used for trial length etc.
 */
export function getBillingConfig() {
  return {
    trialDays: 14, // 14-day trial; adjust if you like
  }
}
