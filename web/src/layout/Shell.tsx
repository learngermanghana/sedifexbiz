import React, { ChangeEvent, useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useConnectivityStatus } from '../hooks/useConnectivityStatus'
import { useActiveStore } from '../hooks/useActiveStore'
import './Shell.css'
import './Workspace.css'

type NavItem = { to: string; label: string; end?: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/products', label: 'Products' },
  { to: '/sell', label: 'Sell' },
  { to: '/receive', label: 'Receive' },
  { to: '/customers', label: 'Customers' },
  { to: '/close-day', label: 'Close Day' },
  { to: '/account', label: 'Account' },
]

function navLinkClass(isActive: boolean) {
  return `shell__nav-link${isActive ? ' is-active' : ''}`
}

type BannerVariant = 'offline' | 'degraded' | 'pending' | 'processing' | 'error'

const BADGE_LABELS: Record<BannerVariant, string> = {
  offline: 'Offline',
  degraded: 'Connection issues',
  pending: 'Sync pending',
  processing: 'Syncing…',
  error: 'Sync error',
}

type BannerState =
  | { variant: BannerVariant; message: string; pulse?: boolean }
  | null

function formatRequestCount(count: number) {
  if (count <= 0) return 'queued request'
  return count === 1 ? 'queued request' : 'queued requests'
}

function buildBannerMessage(queueStatus: ReturnType<typeof useConnectivityStatus>['queue']) {
  const pendingCount = queueStatus.pending
  if (queueStatus.status === 'error') {
    const baseMessage = pendingCount > 0
      ? `We couldn’t sync ${pendingCount} ${formatRequestCount(pendingCount)}. We’ll retry automatically.`
      : 'We hit a snag syncing recent work. We’ll retry automatically.'

    if (queueStatus.lastError) {
      return `${baseMessage} (${queueStatus.lastError})`
    }

    return baseMessage
  }

  if (queueStatus.status === 'processing' && pendingCount > 0) {
    return `Syncing ${pendingCount} ${formatRequestCount(pendingCount)}…`
  }

  if (queueStatus.status === 'pending' && pendingCount > 0) {
    return `Waiting to sync ${pendingCount} ${formatRequestCount(pendingCount)}. We’ll send them once the connection stabilizes.`
  }

  return null
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const user = useAuthUser()
  const userEmail = user?.email ?? 'Account'
  const connectivity = useConnectivityStatus()
  const {
    storeId: activeStoreId,
    isLoading: storeLoading,
    error: storeError,
    memberships,
    setActiveStoreId,
  } = useActiveStore()

  const { isOnline, isReachable, queue } = connectivity

  const banner = useMemo<BannerState>(() => {
    if (!isOnline) {
      return {
        variant: 'offline',
        message: 'You appear to be offline. We’ll sync pending work when the connection returns.',
      }
    }

    if (!isReachable) {
      return {
        variant: 'degraded',
        message: 'We’re having trouble reaching the network. We’ll keep retrying and sync queued work automatically.',
        pulse: true,
      }
    }

    const queueMessage = buildBannerMessage(queue)
    if (queueMessage) {
      const variant: BannerVariant =
        queue.status === 'processing'
          ? 'processing'
          : queue.status === 'error'
            ? 'error'
            : 'pending'
      return {
        variant,
        message: queueMessage,
        pulse: queue.status === 'processing',
      }
    }

    return null
  }, [isOnline, isReachable, queue.lastError, queue.pending, queue.status])


  const workspaceOptions = useMemo(() => {
    const seen = new Set<string>()

    return memberships.reduce<{ value: string; label: string }[]>((options, membership) => {
      const { storeId, role } = membership
      if (!storeId || seen.has(storeId)) {
        return options
      }

      seen.add(storeId)
      const label = role === 'owner' ? `${storeId} • Owner` : storeId
      options.push({ value: storeId, label })
      return options
    }, [])
  }, [memberships])

  const workspaceSelectId = 'shell-workspace-select'

  const handleWorkspaceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value.trim()
    setActiveStoreId(value ? value : null)
  }


  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__header-inner">
          <div className="shell__brand">
            <div className="shell__logo">Sedifex</div>
            <span className="shell__tagline">Sell faster. Count smarter.</span>
          </div>

          <nav className="shell__nav" aria-label="Primary">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => navLinkClass(isActive)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="shell__controls">

            <div className="shell__store-switcher">
              <label className="shell__store-label" htmlFor={workspaceSelectId}>
                Workspace
              </label>

              {storeLoading ? (
                <span className="shell__store-status" role="status">
                  Loading…
                </span>
              ) : workspaceOptions.length > 0 ? (
                <select
                  id={workspaceSelectId}
                  className="shell__store-select"
                  value={activeStoreId ?? workspaceOptions[0]?.value ?? ''}
                  onChange={handleWorkspaceChange}
                >
                  {workspaceOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="shell__store-status" role="status">
                  No workspace assigned
                </span>
              )}

              {storeError ? (
                <span className="shell__store-hint" role="alert">
                  {storeError}
                </span>
              ) : null}
            </div>


            {banner && (
              <div
                className="shell__status-badge"
                data-variant={banner.variant}
                role="status"
                aria-live="polite"
                title={banner.message}
              >
                <span
                  className={`shell__status-dot${banner.pulse ? ' is-pulsing' : ''}`}
                  aria-hidden="true"
                />
                <span className="shell__status-label">{BADGE_LABELS[banner.variant]}</span>
                <span className="shell__sr-only">{banner.message}</span>
              </div>
            )}

            <div className="shell__account">
              <span className="shell__account-email">{userEmail}</span>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => signOut(auth)}
              >
                Sign out
              </button>
            </div>

            </div>

        </div>
      </header>

      <main className="shell__main">{children}</main>
    </div>
  )
}
