import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { checkSignupUnlockStatus } from '../lib/paystackClient'
import { usePwaContext } from '../context/PwaContext'

function useQuery() {
  const { search } = useLocation()
  return React.useMemo(() => new URLSearchParams(search), [search])
}

export const BillingVerifyPage: React.FC = () => {
  const query = useQuery()
  const navigate = useNavigate()
  const { isPwaApp } = usePwaContext()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  const [plan, setPlan] = useState<string | null>(null)

  useEffect(() => {
    if (isPwaApp) {
      return
    }

    const storeId = query.get('storeId')

    if (!storeId) {
      setError('Missing storeId in URL.')
      setLoading(false)
      return
    }

    let cancelled = false

    async function run() {
      try {
        setLoading(true)
        const res = await checkSignupUnlockStatus(storeId)
        if (cancelled) return

        setStatus(res.status)
        setUnlocked(res.unlocked)
        setPlan(res.plan)

        if (res.unlocked) {
          // Optional: here you could mark onboarding/billing as complete in Firestore
          // then redirect to dashboard after a short delay.
          setTimeout(() => {
            navigate('/dashboard', { replace: true })
          }, 2000)
        }
      } catch (err: any) {
        if (cancelled) return
        console.error('checkSignupUnlock error', err)
        setError(err?.message || 'Unable to verify subscription.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [query, navigate, isPwaApp])

  if (isPwaApp) {
    return (
      <main className="p-4">
        <h1 className="text-lg font-semibold mb-2">Manage subscription in your browser</h1>
        <p className="text-sm text-gray-700 mb-2">
          To start or renew your Sedifex subscription, please visit <strong>sedifex.com</strong> in
          your browser and log in there.
        </p>
        <p className="text-sm text-gray-700">
          Once your subscription is active, you can use this app to access your account.
        </p>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="p-4">
        <h1 className="text-lg font-semibold mb-2">Verifying your subscription…</h1>
        <p className="text-sm text-gray-600">
          We’re checking with Paystack and updating your workspace access.
        </p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="p-4">
        <h1 className="text-lg font-semibold mb-2">Verification failed</h1>
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button
          onClick={() => navigate('/account', { replace: true })}
          className="px-4 py-2 bg-black text-white rounded"
        >
          Back to Account
        </button>
      </main>
    )
  }

  if (unlocked) {
    return (
      <main className="p-4">
        <h1 className="text-lg font-semibold mb-2">Subscription active ✅</h1>
        <p className="text-sm text-gray-700 mb-2">
          Your subscription{plan ? ` (${plan})` : ''} is now active. Redirecting you to your
          dashboard…
        </p>
        <button
          onClick={() => navigate('/dashboard', { replace: true })}
          className="px-4 py-2 bg-black text-white rounded"
        >
          Go to dashboard now
        </button>
      </main>
    )
  }

  return (
    <main className="p-4">
      <h1 className="text-lg font-semibold mb-2">Payment not confirmed yet</h1>
      <p className="text-sm text-gray-700 mb-2">
        We couldn’t confirm your Paystack subscription yet. Status: <b>{status}</b>.
      </p>
      <p className="text-xs text-gray-500 mb-4">
        If you just completed payment, wait a few seconds and refresh this page. If the issue
        persists, check your Paystack receipt or contact support.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-black text-white rounded mr-2"
      >
        Retry
      </button>
      <button
        onClick={() => navigate('/account', { replace: true })}
        className="px-4 py-2 border rounded"
      >
        Back to Account
      </button>
    </main>
  )
}
