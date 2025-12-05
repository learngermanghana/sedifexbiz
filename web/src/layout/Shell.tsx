import React, { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useConnectivityStatus } from '../hooks/useConnectivityStatus'
import { useStoreBilling } from '../hooks/useStoreBilling'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships } from '../hooks/useMemberships'
import SupportTicketLauncher from '../components/SupportTicketLauncher'
import { NAV_ITEMS, NavRole } from '../config/navigation'
import { useWorkspaceIdentity } from '../hooks/useWorkspaceIdentity'
import './Shell.css'
import './Workspace.css'

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

type BillingNotice = {
  tone: 'warning' | 'critical'
  title: string
  message: string
}

const CONTRACT_END_WARNING_DAYS = 14
const DISMISS_KEY_PREFIX = 'sedifex-billing-dismissed-'

function formatRequestCount(count: number) {
  if (count <= 0) return 'queued request'
  return count === 1 ? 'queued request' : 'queued requests'
}

function buildBannerMessage(queueStatus: ReturnType<typeof useConnectivityStatus>['queue']) {
  const pendingCount = queueStatus.pending
  if (queueStatus.status === 'error') {
    const baseMessage =
      pendingCount > 0
        ? `We couldn’t sync ${pendingCount} ${formatRequestCount(
            pendingCount,
          )}. We’ll retry automatically.`
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
    return `Waiting to sync ${pendingCount} ${formatRequestCount(
      pendingCount,
    )}. We’ll send them once the connection stabilizes.`
  }

  return null
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { storeId } = useActiveStore()
  const { memberships, loading: membershipsLoading } = useMemberships()
  const user = useAuthUser()
  const userEmail = user?.email ?? 'Account'
  const connectivity = useConnectivityStatus()
  const { billing } = useStoreBilling()
  const location = useLocation()
  const navigate = useNavigate()

  const { isOnline, isReachable, queue } = connectivity
  const { name: workspaceName, loading: workspaceLoading } = useWorkspaceIdentity()

  const [dismissedOn, setDismissedOn] = useState<string | null>(null)

  const activeMembership = useMemo(
    () =>
      storeId
        ? memberships.find(membership => membership.storeId === storeId) ?? null
        : null,
    [memberships, storeId],
  )

  const isStaff = activeMembership?.role === 'staff'
  const role: NavRole = isStaff ? 'staff' : 'owner'
  const navItems = useMemo(
    () => NAV_ITEMS.filter(item => item.roles.includes(role)),
    [role],
  )

  const billingNotice = useMemo<BillingNotice | null>(() => {
    if (!billing) return null

    if (billing.paymentStatus === 'past_due') {
      return {
        tone: 'critical',
        title: 'Billing past due',
        message:
          'Your Sedifex billing is past due. Update your payment method to avoid workspace interruptions.',
      }
    }

    const contractEndDate = billing.contractEnd?.toDate?.()
    if (contractEndDate) {
      const today = new Date()
      const timeRemainingMs = contractEndDate.getTime() - today.getTime()
      const daysRemaining = Math.floor(timeRemainingMs / (1000 * 60 * 60 * 24))

      if (daysRemaining <= CONTRACT_END_WARNING_DAYS) {
        const formattedDate = contractEndDate.toLocaleDateString()
        return {
          tone: 'warning',
          title: 'Contract ending soon',
          message: `Your workspace contract ends on ${formattedDate}. Confirm billing to avoid service interruptions.`,
        }
      }
    }

    return null
  }, [billing])

  useEffect(() => {
    if (!storeId) {
      setDismissedOn(null)
      return
    }

    const key = `${DISMISS_KEY_PREFIX}${storeId}`
    const stored =
      typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    setDismissedOn(stored)
  }, [storeId])

  const todayStamp = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  )
  const isBillingNoticeDismissed = dismissedOn === todayStamp

  const showBillingNotice = Boolean(
    billingNotice && !isBillingNoticeDismissed && !isStaff,
  )

  const [isMenuOpen, setIsMenuOpen] = useState(false)

  useEffect(() => {
    setIsMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (membershipsLoading || !isStaff) return

    const isAllowed = navItems.some(
      item =>
        location.pathname === item.to ||
        location.pathname.startsWith(`${item.to}/`),
    )

    if (!isAllowed) {
      navigate('/sell', { replace: true })
    }
  }, [isStaff, location.pathname, membershipsLoading, navigate, navItems])

  function handleDismissBillingNotice() {
    setDismissedOn(todayStamp)

    if (storeId) {
      try {
        localStorage.setItem(`${DISMISS_KEY_PREFIX}${storeId}`, todayStamp)
      } catch (error) {
        console.warn('[shell] Unable to persist billing notice dismissal', error)
      }
    }
  }

  const banner = useMemo<BannerState>(() => {
    if (!isOnline) {
      return {
        variant: 'offline',
        message:
          'You appear to be offline. We’ll sync pending work when the connection returns.',
      }
    }

    if (!isReachable) {
      return {
        variant: 'degraded',
        message:
          'We’re having trouble reaching the network. We’ll keep retrying and sync queued work automatically.',
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

  const workspaceStatus = billing?.planKey ?? 'Workspace ready'
  const workspaceLabel = workspaceName || workspaceStatus

  return (
    <div className="shell">
      {isMenuOpen && (
        <div
          className="shell__backdrop"
          onClick={() => setIsMenuOpen(false)}
        />
      )}
      <header className="shell__header">
        <div className="shell__container">
          <div className="shell__header-inner">
            <div className="shell__brand">
              <div className="shell__logo">Sedifex</div>
              <span className="shell__tagline">Sell faster. Count smarter.</span>
            </div>

            <button
              type="button"
              className="shell__menu-toggle"
              aria-expanded={isMenuOpen}
              aria-controls="primary-nav"
              onClick={() => setIsMenuOpen(open => !open)}
            >
              <span className="shell__menu-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="shell__menu-label">
                {isMenuOpen ? 'Close' : 'Menu'}
              </span>
              <span className="shell__sr-only">Toggle navigation</span>
            </button>
          </div>

          <div
            className={`shell__toolbar${
              isMenuOpen ? ' is-open' : ''
            }`}
          >
            <div className="shell__nav-group">
              <div
                className="shell__workspace-pill"
                role="status"
                aria-live="polite"
              >
                <span className="shell__workspace-label">Workspace</span>
                <span className="shell__workspace-name">
                  {workspaceLoading && !workspaceLabel
                    ? 'Loading…'
                    : workspaceLabel}
                </span>
              </div>

              <nav
                className="shell__nav"
                aria-label="Primary"
                id="primary-nav"
              >
                {navItems.map(item => (
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
            </div>

            <div className="shell__controls">
              <div
                className="shell__store-switcher"
                role="status"
                aria-live="polite"
              >
                <span className="shell__store-label">Workspace</span>
                <span
                  className="shell__store-select"
                  data-readonly
                >
                  {workspaceStatus}
                </span>
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
                    className={`shell__status-dot${
                      banner.pulse ? ' is-pulsing' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span className="shell__status-label">
                    {BADGE_LABELS[banner.variant]}
                  </span>
                  <span className="shell__sr-only">
                    {banner.message}
                  </span>
                </div>
              )}

              <SupportTicketLauncher />

              <div className="shell__account">
                <span className="shell__account-email">
                  {userEmail}
                </span>
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
        </div>

        {showBillingNotice && billingNotice && (
          <div
            className="shell__billing-banner-wrapper"
            data-tone={billingNotice.tone}
          >
            <div
              className="shell__billing-banner shell__container"
              role="status"
              aria-live="polite"
            >
              <div>
                <p className="shell__billing-title">
                  {billingNotice.title}
                </p>
                <p className="shell__billing-message">
                  {billingNotice.message}
                </p>
              </div>
              <div className="shell__billing-actions">
                <Link
                  className="button button--primary button--small"
                  to="/account"
                >
                  Update payment
                </Link>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={handleDismissBillingNotice}
                >
                  Dismiss reminder
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="shell__main">
        <div className="shell__container">{children}</div>
      </main>
    </div>
  )
}
