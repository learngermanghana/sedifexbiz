import React, { useState } from 'react'
import { cancelPaystackSubscription, startPaystackCheckout } from '../lib/paystackClient'
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
  months: number
}

const PLANS: PlanOption[] = [
  { id: 'starter-monthly', label: 'Starter – Monthly', amountGhs: 100, months: 1 },
  { id: 'starter-biannual', label: 'Starter – Biannual', amountGhs: 600, months: 6 },
  { id: 'starter-yearly', label: 'Starter – Yearly', amountGhs: 1100, months: 12 },
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
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelConfirming, setCancelConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelSuccess, setCancelSuccess] = useState(false)

  const selectedPlan = PLANS.find(plan => plan.id === selectedPlanId) ?? null
  const selectedCadenceLabel = (() => {
    if (selectedPlan?.months === 12) return 'Yearly'
    if (selectedPlan?.months === 6) return 'Biannual'
    return 'Monthly'
  })()
  const selectedCadenceDescription = (() => {
    if (selectedPlan?.months === 12) return 'Billed once per year.'
    if (selectedPlan?.months === 6) return 'Billed every 6 months.'
    return 'Billed every month.'
  })()
  const renewalIntervalMonths = selectedPlan?.months ?? 1
  const renewalCadenceLabel = (() => {
    if (selectedPlan?.months === 12) return 'year'
    if (selectedPlan?.months === 6) return '6 months'
    return 'month'
  })()
  const nextChargeDate = (() => {
    const base = new Date()
    const nextDate = new Date(base)
    nextDate.setMonth(base.getMonth() + renewalIntervalMonths)
    return nextDate
  })()
  const nextChargeDisplay = nextChargeDate.toLocaleDateString(undefined, {
    dateStyle: 'medium',
  })

  const billingPlanDisplay =
    PLANS.find(plan => plan.id === billingPlan)?.label ?? billingPlan ?? null
  const monthlyPlan = PLANS.find(plan => plan.id.includes('monthly')) ?? null
  const yearlyPlan = PLANS.find(plan => plan.id.includes('year')) ?? null
  const yearlySavings =
    monthlyPlan && yearlyPlan ? monthlyPlan.amountGhs * 12 - yearlyPlan.amountGhs : null

  const normalizedContractStatus = contractStatus?.toLowerCase() ?? null
  const hasPaidContract = normalizedContractStatus === 'active'
  const isPendingContract = normalizedContractStatus === 'pending'
  const isFailedContract = normalizedContractStatus === 'failed'

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
    setError(null)
    setUpgradeLoading(true)
    try {
      await startCheckoutForPlan('starter-yearly')
    } finally {
      setUpgradeLoading(false)
    }
  }

  const beginCancelSubscription = () => {
    setError(null)
    setCancelSuccess(false)

    if (!storeId) {
      setError('Missing store ID. Please refresh and try again.')
      return
    }

    setCancelConfirming(true)
  }

  const handleCancelSubscription = async () => {
    setError(null)

    try {
      setCancelLoading(true)
      const response = await cancelPaystackSubscription(storeId)
      if (!response.ok) {
        setError('Unable to cancel your subscription. Please try again.')
        return
      }
      setCancelSuccess(true)
      setCancelConfirming(false)
    } catch (err) {
      console.error('Cancel subscription error', err)
      const message =
        err instanceof Error ? err.message : 'Something went wrong canceling the subscription.'
      setError(message)
    } finally {
      setCancelLoading(false)
    }
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

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4" role="alert">
          {error}
        </div>
      )}

      {hasPaidContract ? (
        <div className="account-overview__notice" role="status">
          <div className="space-y-2">
            <p className="text-sm text-gray-700">
              Your contract is active
              {billingPlanDisplay ? ` on the ${billingPlanDisplay} plan` : ''}. It will remain
              valid until <strong>{contractEndDate ?? '—'}</strong>. If you need to make changes,
              contact your Sedifex account manager.
            </p>
            <p className="text-sm text-gray-600">
              Next renewal: <strong>{contractEndDate ?? '—'}</strong>
            </p>

            {!isYearlyPlan && (
              <div className="rounded border border-gray-200 bg-white p-3 space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-900">Upgrade to yearly billing</p>
                  <p className="text-xs text-gray-600">
                    Current plan: {billingPlanDisplay ?? 'Monthly plan'}
                    {monthlyPlan ? ` at GHS ${monthlyPlan.amountGhs.toFixed(2)} / month.` : '.'}
                  </p>
                  {yearlyPlan && (
                    <p className="text-xs text-gray-600">
                      Yearly plan: GHS {yearlyPlan.amountGhs.toFixed(2)} billed once per year.
                      {yearlySavings !== null && yearlySavings > 0
                        ? ` Save GHS ${yearlySavings.toFixed(2)} compared to monthly.`
                        : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={handleUpgradeToYearly}
                  disabled={loading || upgradeLoading}
                >
                  {upgradeLoading ? 'Starting upgrade…' : 'Upgrade to yearly'}
                </button>
                <p className="text-xs text-gray-600">
                  Extends your contract term for 12 months and simplifies renewals.
                </p>
                </div>
              </div>
            )}
            <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
              <p className="text-sm font-medium text-gray-900">Cancel your subscription</p>
              <p className="text-xs text-gray-600">
                Cancelling stops future Paystack charges for this workspace.
              </p>
              {!cancelConfirming ? (
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={beginCancelSubscription}
                  disabled={cancelLoading}
                >
                  {cancelLoading ? 'Canceling…' : 'Cancel subscription'}
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={handleCancelSubscription}
                    disabled={cancelLoading}
                  >
                    {cancelLoading ? 'Canceling…' : 'Yes, cancel now'}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setCancelConfirming(false)}
                    disabled={cancelLoading}
                  >
                    Keep subscription
                  </button>
                </div>
              )}
              {cancelSuccess && (
                <p className="text-xs text-green-700">
                  Subscription canceled. Paystack will not charge you again.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {(isPendingContract || isFailedContract) && (
            <div
              className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4"
              role="status"
            >
              {isPendingContract
                ? 'Your last payment was not completed yet. If you already paid, refresh in a few minutes. Otherwise, start a new checkout below.'
                : 'Your last payment attempt did not go through. Please start a new checkout below.'}
            </div>
          )}
          <p className="text-sm text-gray-600 mb-4">
            Choose a plan and start your subscription. You’ll be redirected to Paystack to complete
            the payment.
          </p>

          <form
            onSubmit={handleStartCheckout}
            className="account-overview__form max-w-md space-y-4"
          >
            <fieldset
              disabled={loading}
              className={loading ? 'opacity-70 pointer-events-none' : undefined}
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

              <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
                <p className="font-medium">Plan summary</p>
                <p>
                  Price:{' '}
                  <strong>
                    GHS {selectedPlan?.amountGhs.toFixed(2) ?? '—'}
                  </strong>{' '}
                  ({selectedCadenceLabel})
                </p>
                <p>Billing cadence: {selectedCadenceDescription}</p>
                <p>
                  Renews automatically every {renewalCadenceLabel}.
                </p>
                <p>
                  Estimated next charge:{' '}
                  <strong>{nextChargeDisplay}</strong> (once your subscription starts).
                </p>
              </div>

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
            </fieldset>
          </form>
        </>
      )}
    </section>
  )
}
