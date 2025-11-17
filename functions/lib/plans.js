"use strict";
// functions/src/plans.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_IDS = void 0;
exports.getBillingConfig = getBillingConfig;
exports.PLAN_IDS = ['starter', 'pro', 'trial'];
/**
 * Billing configuration used for trial length etc.
 */
function getBillingConfig() {
    return {
        trialDays: 14, // 14-day trial; adjust if you like
    };
}
