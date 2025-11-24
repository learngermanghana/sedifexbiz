// src/components/SubscriptionBanner.tsx
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useStoreBilling } from '../hooks/useStoreBilling'

function formatDaysRemaining(trialEndsAt: any): string | null {
  try {
    if (!trialEndsAt) return null
    const end =
      typeof trialEndsAt.toDate === 'function' ? trialEndsAt.toDate() : new Date(trialEndsAt)
    const now = new Date()
    const diffMs = end.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (!Number.isFinite(diffDays) || diffDays < 0) return null
    return `${diffDays} day${diffDays === 1 ? '' : 's'} remaining`
  } catch {
    return null
  }
}

export function SubscriptionBanner() {
  const navigate = useNavigate()
  const { loading, billing } = useStoreBilling()

  if (loading) return null

  const status = billing?.status ?? 'unknown'
  const trialEndsAt = billing?.trialEndsAt ?? null

  // Only show banner when NOT active
  if (status === 'active') return null

  const daysText = formatDaysRemaining(trialEndsAt)

  let message: string
  if (status === 'trial') {
    message = daysText
      ? `You're on a free trial — ${daysText}.`
      : `You're on a free trial.`
  } else if (status === 'past_due') {
    message = 'Your subscription payment is past due. Some actions may be disabled.'
  } else if (status === 'inactive') {
    message = 'Your subscription is inactive. Some actions are disabled.'
  } else {
    // unknown or not set: treat like trial/free
    message = 'You are on a free Sedifex plan. Subscribe to unlock full features.'
  }

  return (
    <div className={`subscription-banner subscription-banner--${status}`} role="status">
      <div className="subscription-banner__inner">
        <div className="subscription-banner__text">
          <strong>Subscription:</strong> {message} Subscribe for <strong>$10/month</strong> to
          keep unlimited sales and inventory.
        </div>
        <button
          type="button"
          className="subscription-banner__button"
          onClick={() => navigate('/account')}
        >
          Manage subscription
        </button>
      </div>
    </div>
  )
}
