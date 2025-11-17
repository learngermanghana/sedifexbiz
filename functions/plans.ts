// functions/src/plans.ts

export type PlanId = 'starter' | 'pro' | 'trial'

export const PLAN_IDS: PlanId[] = ['starter', 'pro', 'trial']

/**
 * Billing configuration used for trial length etc.
 */
export function getBillingConfig() {
  return {
    trialDays: 14, // 14-day trial; adjust if you like
  }
}
