export type NavRole = 'owner' | 'staff'

export type NavItem = {
  to: string
  label: string
  end?: boolean
  roles: NavRole[]
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', end: true, roles: ['owner'] },
  { to: '/products', label: 'Items', roles: ['owner'] },
  { to: '/sell', label: 'Sell', roles: ['owner', 'staff'] },
  { to: '/receive', label: 'Receive', roles: ['owner'] },
  { to: '/customers', label: 'Customers', roles: ['owner', 'staff'] },
  { to: '/data-transfer', label: 'Data transfer', roles: ['owner'] },
  { to: '/bulk-messaging', label: 'Bulk messaging', roles: ['owner'] },
  { to: '/finance', label: 'Finance', roles: ['owner'] },
  { to: '/close-day', label: 'Close day', roles: ['owner', 'staff'] },
  { to: '/account', label: 'Account', roles: ['owner'] },
]
