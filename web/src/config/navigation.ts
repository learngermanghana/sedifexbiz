export type NavRole = 'owner' | 'staff'
export type Industry = 'shop' | 'travel' | 'ngo' | 'school' | 'event'
export type NavigationLabelPolicy = 'shared' | 'industry_aliases'
export type NavItemType = 'module' | 'internal' | 'external'

export type NavItem = {
  id: string
  label: string
  type: NavItemType
  target: string
  sortOrder: number
  end?: boolean
  parentTarget?: string
  hideFromPrimaryNav?: boolean
  rolesAllowed: NavRole[]
  industries?: Industry[]
  requiredPermissions?: string[]
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', type: 'module', target: '/dashboard', end: true, rolesAllowed: ['owner'], sortOrder: 10 },
  { id: 'reports', label: 'Reports', type: 'module', target: '/reports', rolesAllowed: ['owner', 'staff'], sortOrder: 15 },
  { id: 'products', label: 'Items', type: 'module', target: '/products', rolesAllowed: ['owner'], sortOrder: 20 },
  { id: 'sell', label: 'Sell', type: 'module', target: '/sell', rolesAllowed: ['owner', 'staff'], sortOrder: 30 },
  { id: 'marketplace-orders', label: 'Marketplace Orders', type: 'module', target: '/marketplace-orders', rolesAllowed: ['owner', 'staff'], sortOrder: 31 },
  { id: 'quick-pay', label: 'Quick Pay', type: 'module', target: '/quick-pay', rolesAllowed: ['owner', 'staff'], sortOrder: 32 },
  { id: 'invoices', label: 'Invoices', type: 'module', target: '/invoices', rolesAllowed: ['owner', 'staff'], sortOrder: 33 },
  { id: 'receipts', label: 'Receipts', type: 'module', target: '/receipts', rolesAllowed: ['owner', 'staff'], sortOrder: 34 },
  { id: 'expenses', label: 'Expenses', type: 'module', target: '/expenses', rolesAllowed: ['owner', 'staff'], sortOrder: 36 },
  { id: 'customers', label: 'Customers', type: 'module', target: '/customers', rolesAllowed: ['owner', 'staff'], sortOrder: 40 },
  { id: 'students', label: 'Students', type: 'module', target: '/students', rolesAllowed: ['owner', 'staff'], industries: ['school'], sortOrder: 45 },
  { id: 'bookings', label: 'Bookings', type: 'module', target: '/bookings', rolesAllowed: ['owner', 'staff'], sortOrder: 50 },
  { id: 'events', label: 'Event Planning', type: 'module', target: '/event-planning', rolesAllowed: ['owner', 'staff'], sortOrder: 51 },
  { id: 'upcoming-events', label: 'Upcoming events', type: 'module', target: '/upcoming-events', rolesAllowed: ['owner', 'staff'], sortOrder: 53 },
  { id: 'student-registration', label: 'Student registration', type: 'module', target: '/student-registration', rolesAllowed: ['owner', 'staff'], sortOrder: 55 },
  { id: 'volunteers', label: 'Volunteers', type: 'module', target: '/volunteers', rolesAllowed: ['owner', 'staff'], industries: ['ngo'], sortOrder: 56 },
  { id: 'support-requests', label: 'Support requests', type: 'module', target: '/support-requests', rolesAllowed: ['owner', 'staff'], industries: ['ngo'], sortOrder: 57 },
  { id: 'settlement', label: 'Payments / Settlement', type: 'module', target: '/settlement', rolesAllowed: ['owner'], sortOrder: 58 },
  { id: 'integrations', label: 'Integrations', type: 'module', target: '/settings/integrations/website', rolesAllowed: ['owner'], sortOrder: 59 },
  { id: 'automations', label: 'Automations', type: 'module', target: '/settings/automations', rolesAllowed: ['owner'], sortOrder: 59.5 },
  { id: 'blog', label: 'Blog', type: 'module', target: '/blog', rolesAllowed: ['owner', 'staff'], sortOrder: 60 },
  { id: 'website-builder', label: 'Website Builder', type: 'module', target: '/website-builder', rolesAllowed: ['owner', 'staff'], sortOrder: 61 },
  { id: 'promo', label: 'Promo', type: 'module', target: '/promo', parentTarget: '/website-builder', hideFromPrimaryNav: true, rolesAllowed: ['owner', 'staff'], sortOrder: 61.1 },
  { id: 'gallery', label: 'Gallery', type: 'module', target: '/gallery', parentTarget: '/website-builder', hideFromPrimaryNav: true, rolesAllowed: ['owner', 'staff'], sortOrder: 61.2 },
  { id: 'website-hero-slides', label: 'Website Hero Slides', type: 'module', target: '/website-hero-slides', parentTarget: '/website-builder', hideFromPrimaryNav: true, rolesAllowed: ['owner', 'staff'], sortOrder: 61.3 },
  { id: 'social-links', label: 'Social links', type: 'module', target: '/social-links', parentTarget: '/website-builder', hideFromPrimaryNav: true, rolesAllowed: ['owner', 'staff'], sortOrder: 61.4 },
  { id: 'bulk-messaging', label: 'SMS', type: 'module', target: '/bulk-messaging', rolesAllowed: ['owner'], sortOrder: 70 },
  { id: 'bulk-email', label: 'Bulk email', type: 'module', target: '/bulk-email', rolesAllowed: ['owner'], sortOrder: 80 },
  { id: 'donor-management', label: 'Donor management', type: 'module', target: '/donor-management', rolesAllowed: ['owner', 'staff'], sortOrder: 90 },
  { id: 'funds-ledger', label: 'Funds ledger', type: 'module', target: '/funds-ledger', rolesAllowed: ['owner', 'staff'], sortOrder: 105 },
  { id: 'account', label: 'Account', type: 'module', target: '/account', rolesAllowed: ['owner'], sortOrder: 110 },
]

const INDUSTRY_LABELS: Record<Industry, Partial<Record<string, string>>> = {
  shop: {},
  travel: { '/customers': 'Customers', '/bookings': 'Booking', '/upcoming-events': 'Upcoming events', '/marketplace-orders': 'Online Orders', '/website-builder': 'Website Builder', '/promo': 'Trip promos', '/gallery': 'Trip gallery', '/social-links': 'Contact links' },
  ngo: { '/customers': 'Donors', '/bookings': 'Campaigns', '/upcoming-events': 'Upcoming campaigns', '/marketplace-orders': 'Online Orders', '/website-builder': 'Website Builder', '/promo': 'Campaign promo', '/gallery': 'Impact gallery', '/social-links': 'Contact links', '/expenses': 'Petty expenses' },
  school: { '/customers': 'Contacts', '/students': 'Students', '/bookings': 'Classes', '/upcoming-events': 'Upcoming classes', '/marketplace-orders': 'Registrations & Orders', '/website-builder': 'Website Builder', '/promo': 'Admissions promo', '/gallery': 'School gallery', '/social-links': 'Contact links' },
  event: { '/event-planning': 'Event Management', '/bulk-email': 'Email' },
}

const INDUSTRY_SORT_ORDERS: Partial<Record<Industry, Partial<Record<string, number>>>> = {
  event: { dashboard: 10, events: 20, customers: 30, invoices: 40, reports: 50, 'bulk-email': 60 },
}

export type CustomNavItem = {
  id: string
  label: string
  type: 'module' | 'internal' | 'external'
  target: string
  roles_allowed: NavRole[]
  sort_order: number
  required_permissions?: string[]
}

export type NavigationSettings = {
  industry: Industry
  labelPolicy: NavigationLabelPolicy
  customLabels?: Partial<Record<string, string>>
  enabledModules?: string[]
  customNavItems?: CustomNavItem[]
}

export const WEBSITE_BUILDER_SECTION_IDS = ['promo', 'gallery', 'website-hero-slides', 'social-links'] as const

export const INDUSTRY_ENABLED_MODULE_PRESETS: Record<Industry, string[]> = {
  shop: ['dashboard', 'products', 'sell', 'marketplace-orders', 'invoices', 'receipts', 'customers'],
  travel: ['dashboard', 'customers', 'bookings', 'upcoming-events', 'invoices', 'receipts'],
  ngo: ['dashboard', 'customers', 'bookings', 'upcoming-events', 'donor-management', 'funds-ledger', 'volunteers'],
  school: ['dashboard', 'students', 'customers', 'bookings', 'upcoming-events', 'student-registration', 'invoices'],
  event: ['dashboard', 'events', 'customers', 'invoices', 'reports', 'bulk-email'],
}

const LEGACY_EVENT_PRESET = ['events', 'customers', 'invoices', 'bulk-email']

export type NavigationResolverInput = { role: NavRole; workspaceProfile: NavigationSettings; permissions?: string[] }

function toShellNavItem(item: NavItem): NavItem { return { ...item, label: item.label.trim() } }
function hasPermissions(requiredPermissions: string[] | undefined, grantedPermissions: Set<string> | null) {
  if (!requiredPermissions || requiredPermissions.length === 0) return true
  if (!grantedPermissions) return false
  return requiredPermissions.every(permission => grantedPermissions.has(permission))
}

function isLegacyEventPreset(industry: Industry, configuredModules: string[] | undefined) {
  if (industry !== 'event' || !configuredModules || configuredModules.length !== LEGACY_EVENT_PRESET.length) return false
  const configured = new Set(configuredModules)
  return LEGACY_EVENT_PRESET.every(moduleId => configured.has(moduleId))
}

export function resolveNavigation(input: NavigationResolverInput): NavItem[] {
  const { role, workspaceProfile } = input
  const aliasLabels = workspaceProfile.labelPolicy === 'industry_aliases' ? INDUSTRY_LABELS[workspaceProfile.industry] : {}
  const configuredModules = workspaceProfile.enabledModules && workspaceProfile.enabledModules.length > 0
    ? workspaceProfile.enabledModules
    : undefined
  const enabledModules = new Set(
    configuredModules
      ? configuredModules
      : INDUSTRY_ENABLED_MODULE_PRESETS[workspaceProfile.industry],
  )
  if (isLegacyEventPreset(workspaceProfile.industry, configuredModules)) {
    enabledModules.add('dashboard')
    enabledModules.add('reports')
  }
  if (enabledModules && WEBSITE_BUILDER_SECTION_IDS.some(id => enabledModules.has(id))) {
    enabledModules.add('website-builder')
  }
  const grantedPermissions = input.permissions && input.permissions.length > 0 ? new Set(input.permissions) : null
  const baseItems = NAV_ITEMS.filter(item => {
    if (!item.rolesAllowed.includes(role)) return false
    if (item.industries && !item.industries.includes(workspaceProfile.industry)) return false
    if (item.hideFromPrimaryNav) return false
    if (item.id !== 'account' && !enabledModules.has(item.id)) return false
    return hasPermissions(item.requiredPermissions, grantedPermissions)
  }).map(item => {
    const customLabel = workspaceProfile.customLabels?.[item.target]?.trim()
    const aliasLabel = aliasLabels[item.target]
    const industrySortOrder = INDUSTRY_SORT_ORDERS[workspaceProfile.industry]?.[item.id]
    return toShellNavItem({ ...item, label: customLabel || aliasLabel || item.label, sortOrder: industrySortOrder ?? item.sortOrder })
  })
  const customItems = (workspaceProfile.customNavItems ?? []).filter(item => {
    if (!item.roles_allowed.includes(role)) return false
    if (!item.label.trim() || !item.target.trim()) return false
    if (!['module', 'internal', 'external'].includes(item.type)) return false
    return hasPermissions(item.required_permissions, grantedPermissions)
  }).map<NavItem>(item => ({ id: item.id, label: item.label.trim(), type: item.type, target: item.target.trim(), rolesAllowed: item.roles_allowed, sortOrder: item.sort_order, requiredPermissions: item.required_permissions, end: false }))
  return [...baseItems, ...customItems].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function resolveNavItems(role: NavRole, settings: NavigationSettings): NavItem[] {
  return resolveNavigation({ role, workspaceProfile: settings })
}
