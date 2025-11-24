// web/src/components/SubscriptionButton.tsx
import React, { useState } from 'react'
import { useSubscriptionCheckout } from '../api/paystack'

type Props = {
  label?: string
}

export function SubscriptionButton({ label = 'Subscribe for $10/month' }: Props) {
  const { start, activeStoreId } = useSubscriptionCheckout()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    setIsLoading(true)
    try {
      const returnUrl = window.location.origin + '/account' // or /billing if you have that route
      const url = await start(returnUrl)
      window.location.href = url
    } catch (err) {
      console.error('[billing] Failed to start subscription checkout', err)
      setError('Unable to start checkout right now. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!activeStoreId) {
    return (
      <p style={{ color: '#b91c1c', fontSize: 13 }}>
        Select or create a workspace before starting a subscription.
      </p>
    )
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="button button--primary"
        style={{
          padding: '10px 18px',
          borderRadius: 6,
          border: 'none',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontWeight: 600,
          backgroundColor: '#111827',
          color: '#fff',
        }}
      >
        {isLoading ? 'Redirecting…' : label}
      </button>
      {error ? (
        <span style={{ fontSize: 13, color: '#b91c1c' }}>{error}</span>
      ) : (
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          You’ll be redirected to Paystack to complete payment.
        </span>
      )}
    </div>
  )
}
