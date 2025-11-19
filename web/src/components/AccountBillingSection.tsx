import React, { useState } from 'react'
import { startPaystackCheckout } from '../lib/paystackClient'

type Props = {
  storeId: string | null
  ownerEmail: string | null
  isOwner: boolean
  contractStatus?: string | null
  billingPlan?: string | null
  paymentProvider?: string | null
}

type PlanOption = {
  id: string
  label: string
  amountUsd: number
}

const PLANS: PlanOption[] = [
  { id: 'starter-monthly', label: 'Starter – Monthly', amountUsd: 10 },
  { id: 'starter-yearly', label: 'Starter – Yearly', amountUsd: 100 },
]

export const AccountBillingSection: React.FC<Props> = ({
  storeId,
  ownerEmail,
  isOwner,
  contractStatus,
  billingPlan,
  paymentProvider,
}) => {
  const defaultPlanId = PLANS[0]?.id ?? ''
  const [selectedPlanId, setSelectedPlanId] = useState<string>(defaultPlanId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activePlan = PLANS.find(plan => plan.id === selectedPlanId) ?? PLANS[0]

  const handleStartCheckout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!isOwner) {
      setError('Only the owner can start a subscription.')
      return
    }

    if (!storeId) {
      setError('Missing store ID. Please refresh and try again.')
      return
    }

    if (!ownerEmail) {
      setError('Missing owner email. Please log in again.')
      return
    }

    if (!activePlan) {
      setError('No billing plans are available right now. Please try again later.')
      return
    }

    try {
      setLoading(true)

      const redirectUrl = `${window.location.origin}/billing/verify?storeId=${encodeURIComponent(storeId)}`

      const response = await startPaystackCheckout({
        email: ownerEmail,
        storeId,
        amount: activePlan.amountUsd,
        plan: activePlan.id,
        redirectUrl,
        metadata: {
          source: 'account-contract-billing',
        },
      })

      if (!response.ok || !response.authorizationUrl) {
        setError('Unable to start checkout. Please try again.')
        return
      }

      window.location.assign(response.authorizationUrl)
    } catch (err) {
      console.error('Checkout error', err)
      const message =
        err instanceof Error ? err.message : 'Something went wrong starting checkout.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (!isOwner) {
    return (
      <section>
        <h2>Contract &amp; billing</h2>
        <p className="text-sm text-gray-600">
          Only the workspace owner can manage billing. Ask your owner to start the subscription
          from their account.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h2>Contract &amp; billing</h2>

      <dl className="account-overview__grid">
        <div>
          <dt>Contract status</dt>
          <dd>{contractStatus ?? '—'}</dd>
        </div>
        <div>
          <dt>Billing plan</dt>
          <dd>{billingPlan ?? '—'}</dd>
        </div>
        <div>
          <dt>Payment provider</dt>
          <dd>{paymentProvider ?? '—'}</dd>
        </div>
      </dl>

      <p className="text-sm text-gray-600 mb-4">
        Choose a plan and start your subscription. You’ll be redirected to Paystack to complete the
        payment.
      </p>

      <form onSubmit={handleStartCheckout} className="account-overview__form max-w-md space-y-4">
        <label className="block text-sm font-medium">
          <span>Plan</span>
          <select
            value={selectedPlanId}
            onChange={event => setSelectedPlanId(event.target.value)}
            className="border rounded px-3 py-2 w-full"
          >
            {PLANS.map(plan => (
              <option key={plan.id} value={plan.id}>
                {plan.label} – ${plan.amountUsd.toFixed(2)}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="button button--primary"
        >
          {loading ? 'Starting checkout…' : 'Pay with Paystack'}
        </button>

        <p className="text-xs text-gray-500">
          You will be redirected to Paystack’s secure page to complete your subscription.
        </p>
      </form>
    </section>
  )
}
