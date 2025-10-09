// functions/src/plans.ts
import * as functions from "firebase-functions";

export type PlanId = "starter" | "pro" | "enterprise";

export const PLANS: Record<PlanId, {
  name: string;
  monthlyGhs: number;
  features: string[];
}> = {
  starter: {
    name: "Starter",
    monthlyGhs: 99,
    features: [
      "Up to 1,000 SKUs",
      "Single location",
      "Email support",
    ],
  },
  pro: {
    name: "Pro",
    monthlyGhs: 249,
    features: [
      "Up to 10,000 SKUs",
      "Multi-location",
      "Priority email + chat support",
    ],
  },
  enterprise: {
    name: "Enterprise",
    monthlyGhs: 499,
    features: [
      "Unlimited SKUs",
      "Multi-location + advanced roles",
      "Dedicated success manager",
    ],
  },
};

// Read Paystack plan codes and trial length from functions config
//   firebase functions:config:set \
//     billing.trial_days=14 \
//     billing.plan_starter=PLN_xxx \
//     billing.plan_pro=PLN_xxx \
//     billing.plan_enterprise=PLN_xxx
export function getBillingConfig() {
  const cfg = functions.config();
  const billing = (cfg?.billing ?? {}) as Record<string, unknown>;
  const trialDays = Number(billing.trial_days ?? 14);

  const starter = String(billing.plan_starter ?? "");
  const pro = String(billing.plan_pro ?? "");
  const enterprise = String(billing.plan_enterprise ?? "");

  if (!starter || !pro || !enterprise) {
    functions.logger.warn(
      "[billing] Missing one or more Paystack plan codes in functions config " +
      "(billing.plan_starter / billing.plan_pro / billing.plan_enterprise)."
    );
  }

  return {
    trialDays,
    planCodes: {
      starter,
      pro,
      enterprise,
    },
  };
}

// Helper to invert map: paystackCode -> planId
export function mapPaystackPlanCodeToPlanId(code: string): PlanId | null {
  const { planCodes } = getBillingConfig();
  const pairs: Array<[PlanId, string]> = [
    ["starter", planCodes.starter],
    ["pro", planCodes.pro],
    ["enterprise", planCodes.enterprise],
  ];
  const hit = pairs.find(([, c]) => c && c === code);
  return hit ? hit[0] : null;
}
