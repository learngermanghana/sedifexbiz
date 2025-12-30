import React, { useState } from 'react'
import { startPaystackCheckout } from '../lib/paystackClient'
import { usePwaContext } from '../context/PwaContext'

type Props = {
  storeId: string | null
  ownerEmail: string | null
  isOwner: boolean
  contractStatus?: string | null
  billingPlan?: string | null
  paymentProvider?: string | null
  contractEndDate?: string | null
}

type PlanOption = {
  id: string
  label: string
  amountGhs: number
}

const PLANS: PlanOption[] = [
  { id: 'starter-monthly', label: 'Starter – Monthly', amountGhs: 100 },
  { id: 'starter-yearly', label: 'Starter – Yearly', amountGhs: 1100 },
]

export const AccountBillingSection: React.FC<Props> = ({
  storeId,
  ownerEmail,
  isOwner,
  contractStatus,
  billingPlan,
  paymentProvider,
  contractEndDate,
}) => {
  const { isPwaApp } = usePwaContext()
  const defaultPlanId = PLANS[0]?.id ?? ''
  const [selectedPlanId, setSelectedPlanId] = useState<string>(defaultPlanId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const billingPlanDisplay =
    PLANS.find(plan => plan.id === billingPlan)?.label ?? billingPlan ?? null

  const hasPaidContract =
    (contractStatus && contractStatus !== 'trial' && contractStatus !== 'unpaid') ||
    (billingPlan && billingPlan !== 'trial')

  const startCheckoutForPlan = async (planId: string) => {
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

    const targetPlan = PLANS.find(plan => plan.id === planId)

    if (!targetPlan) {
      setError('No billing plans are available right now. Please try again later.')
      return
    }

    try {
      setLoading(true)

      const redirectUrl = `${window.location.origin}/billing/verify?storeId=${encodeURIComponent(storeId)}`

      const response = await startPaystackCheckout({
        email: ownerEmail,
        storeId,
        amount: targetPlan.amountGhs,
        plan: targetPlan.id,
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

  const handleStartCheckout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await startCheckoutForPlan(selectedPlanId)
  }

  const handleUpgradeToYearly = async () => {
    await startCheckoutForPlan('starter-yearly')
  }

  const isYearlyPlan = billingPlan?.toLowerCase().includes('year') ?? false

  if (isPwaApp) {
    return (
      <section id="account-overview-contract">
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

        <div className="account-overview__notice" role="note">
          <p className="text-sm text-gray-700">
            To start or renew your Sedifex subscription, please visit{' '}
            <strong>sedifex.com</strong> in your browser and log in there. Once your subscription is
            active, you can use this app to access your account.
          </p>
        </div>
      </section>
    )
  }

  if (!isOwner) {
    return (
      <section id="account-overview-contract">
        <h2>Contract &amp; billing</h2>
        <p className="text-sm text-gray-600">
          Only the workspace owner can manage billing. Ask your owner to start the subscription
          from their account.
        </p>
      </section>
    )
  }

  return (
    <section id="account-overview-contract">
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

      {hasPaidContract ? (
        <div className="account-overview__notice" role="status">
          <div className="space-y-2">
            <p className="text-sm text-gray-700">
              Your contract is active
              {billingPlanDisplay ? ` on the ${billingPlanDisplay} plan` : ''}. It will remain
              valid until <strong>{contractEndDate ?? '—'}</strong>. If you need to make changes,
              contact your Sedifex account manager.
            </p>

            {!isYearlyPlan && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleUpgradeToYearly}
                  disabled={loading}
                >
                  {loading ? 'Starting upgrade…' : 'Upgrade to yearly'}
                </button>
                <p className="text-xs text-gray-600">
                  Switch to annual billing to keep your contract active for a full year.
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600 mb-4">
            Choose a plan and start your subscription. You’ll be redirected to Paystack to complete
            the payment.
          </p>

          <form
            onSubmit={handleStartCheckout}
            className="account-overview__form max-w-md space-y-4"
          >
            <label className="block text-sm font-medium">
              <span>Plan</span>
              <select
                value={selectedPlanId}
                onChange={event => setSelectedPlanId(event.target.value)}
                className="border rounded px-3 py-2 w-full"
              >
                {PLANS.map(plan => (
                  <option key={plan.id} value={plan.id}>
                    {plan.label} – GHS {plan.amountGhs.toFixed(2)}
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
        </>
      )}
    </section>
  )
}
