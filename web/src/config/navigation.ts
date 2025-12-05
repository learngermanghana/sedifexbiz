export type NavRole = 'owner' | 'staff'

export type NavItem = {
  to: string
  label: string
  end?: boolean
  roles: NavRole[]
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true, roles: ['owner'] },
  { to: '/products', label: 'Products & Services', roles: ['owner'] },
  { to: '/sell', label: 'Sell', roles: ['owner', 'staff'] },
  { to: '/receive', label: 'Receive', roles: ['owner'] },
  { to: '/customers', label: 'Customers', roles: ['owner', 'staff'] },
  { to: '/activity', label: 'Activity', roles: ['owner'] },
  // 🔁 Replaced Close Day with Finance
  { to: '/finance', label: 'Finance', roles: ['owner'] },
  { to: '/advisor', label: 'AI advisor', roles: ['owner'] },
  { to: '/account', label: 'Account', roles: ['owner'] },
  { to: '/close-day', label: 'Close day', roles: ['staff'] },
]
