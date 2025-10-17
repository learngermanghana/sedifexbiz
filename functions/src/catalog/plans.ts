export type PlanId = 'starter' | 'pro' | 'enterprise'

export type PlanCatalogEntry = {
  id: PlanId
  name: string
  monthlyGhs: number
  billingFeatures: readonly string[]
  marketing: {
    badge?: string
    highlight?: boolean
    description: string
    features: readonly string[]
  }
}

export const PLAN_IDS: readonly PlanId[] = ['starter', 'pro', 'enterprise']

const PLAN_DETAILS: Record<PlanId, PlanCatalogEntry> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyGhs: 99,
    billingFeatures: [
      'Up to 1,000 SKUs',
      'Single location',
      'Email support',
    ],
    marketing: {
      badge: 'Best for single stores',
      description: 'Kick off with a lightweight workspace for owner-operators.',
      features: [
        'Up to 1,000 SKUs',
        'Single location',
        'Owner access + 2 staff accounts',
        'Core inventory workflows',
      ],
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyGhs: 249,
    billingFeatures: [
      'Up to 10,000 SKUs',
      'Multi-location',
      'Priority email + chat support',
    ],
    marketing: {
      badge: 'Most popular',
      highlight: true,
      description: 'Grow into multi-store ops with team workflows and support.',
      features: [
        'Up to 10,000 SKUs',
        'Multi-location',
        '10 staff accounts included',
        'Priority support',
      ],
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    monthlyGhs: 499,
    billingFeatures: [
      'Unlimited SKUs',
      'Multi-location + advanced roles',
      'Dedicated success manager',
    ],
    marketing: {
      description: 'Scale a nationwide fleet with advanced controls and limits.',
      features: [
        'Unlimited SKUs',
        'Unlimited stores & users',
        'Advanced roles & approvals',
        'Dedicated success manager',
      ],
    },
  },
}

export const PLAN_CATALOG: Readonly<Record<PlanId, PlanCatalogEntry>> = PLAN_DETAILS

export const PLAN_LIST: readonly PlanCatalogEntry[] = PLAN_IDS.map(
  id => PLAN_CATALOG[id],
)
