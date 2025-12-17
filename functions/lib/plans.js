"use strict";
// functions/src/plans.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PLAN_ID = void 0;
exports.getBillingConfig = getBillingConfig;
exports.normalizePlanId = normalizePlanId;
exports.getPlanById = getPlanById;
exports.upsertPlanCatalog = upsertPlanCatalog;
// 👉 Default plan used when nothing is specified
exports.DEFAULT_PLAN_ID = 'starter-monthly';
// 👉 Central plan catalog (adjust prices/labels as you like)
const PLAN_CATALOG = {
    'starter-monthly': {
        id: 'starter-monthly',
        label: 'Starter Monthly',
        months: 1,
        monthlyPriceUsd: 9,
        totalPriceUsd: 9,
        discountPercent: null,
        isDefault: true,
    },
    'starter-annual': {
        id: 'starter-annual',
        label: 'Starter Annual',
        months: 12,
        monthlyPriceUsd: 8,
        totalPriceUsd: 96,
        discountPercent: 11, // example: (9-8)/9 ≈ 11%
    },
    'pro-monthly': {
        id: 'pro-monthly',
        label: 'Pro Monthly',
        months: 1,
        monthlyPriceUsd: 19,
        totalPriceUsd: 19,
        discountPercent: null,
    },
    'pro-annual': {
        id: 'pro-annual',
        label: 'Pro Annual',
        months: 12,
        monthlyPriceUsd: 16,
        totalPriceUsd: 192,
        discountPercent: 16, // example
    },
};
// 👉 What your other code expects from getBillingConfig()
function getBillingConfig() {
    return {
        // Free trial length in days (used in index.ts initializeStoreImpl)
        trialDays: 14,
        defaultPlanId: exports.DEFAULT_PLAN_ID,
        plans: PLAN_CATALOG,
    };
}
// 👉 Map various string values to a canonical PlanId
const PLAN_ALIAS_MAP = {
    // Starter
    starter: 'starter-monthly',
    'starter-monthly': 'starter-monthly',
    'starter-annual': 'starter-annual',
    // Pro
    pro: 'pro-monthly',
    'pro-monthly': 'pro-monthly',
    'pro-annual': 'pro-annual',
};
/**
 * Normalize any incoming plan string (from frontend/metadata) into a PlanId.
 * Returns null if we don’t recognize it.
 */
function normalizePlanId(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    const key = raw.trim().toLowerCase();
    return PLAN_ALIAS_MAP[key] ?? null;
}
/**
 * Safely get a plan config by id.
 * If planId is missing or unknown, it falls back to DEFAULT_PLAN_ID.
 */
function getPlanById(planId) {
    const id = planId ?? exports.DEFAULT_PLAN_ID;
    return PLAN_CATALOG[id] ?? PLAN_CATALOG[exports.DEFAULT_PLAN_ID];
}
/**
 * Upsert plan catalog into Firestore or another storage.
 * For now we keep it as a NO-OP so callers in paystack.ts can await it safely.
 * You can later implement real syncing if you want.
 */
async function upsertPlanCatalog() {
    // No-op: safe to remove or expand later.
    return;
}
