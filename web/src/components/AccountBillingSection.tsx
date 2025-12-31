import React, { useEffect, useMemo, useState } from 'react'
import { startExtraWorkspaceCheckout, startPaystackCheckout } from '../lib/paystackClient'
import { usePwaContext } from '../context/PwaContext'

type Props = {
  storeId: string | null
  ownerEmail: string | null
  isOwner: boolean
  contractStatus?: string | null
  billingPlan?: string | null
  paymentProvider?: string | null
  contractEndDate?: string | null
  trialEndDate?: string | null
  trialDaysRemaining?: string | null
  graceEndDate?: string | null
  graceDaysRemaining?: string | null
  lastCheckoutUrl?: string | null
  lastCheckoutAt?: string | null
}

type PlanOption = {
  id: 'starter-monthly' | 'starter-yearly' | 'business-yearly'
  label: string
  amountGhs: number
  description?: string
  badge?: string
  highlights: string[]
}

const PLANS: PlanOption[] = [
  {
    id: 'starter-monthly',
    label: 'Starter',
    amountGhs: 100,
    description: 'Monthly billing',
    badge: 'Recommended',
    highlights: ['1 workspace', 'Sell + Inventory + Reports', 'Add extra workspace anytime'],
  },
  {
    id: 'starter-yearly',
    label: 'Starter',
    amountGhs: 1100,
    description: 'Yearly billing (2 months free)',
    highlights: ['1 workspace', 'Best value for 12 months', 'Add extra workspace anytime'],
  },
  {
    id: 'business-yearly',
    label: 'Business (Multi-store)',
    amountGhs: 2500,
    description: 'Yearly billing',
    highlights: ['Up to 5 workspaces included', 'Ideal for multi-branch shops', 'Priority support (optional)'],
  },
]

function normalizePlanKey(value: string | null | undefined) {
  if (!value) return null
  return value.trim().toLowerCase()
}

export const AccountBillingSection: React.FC<Props> = ({
  storeId,
  ownerEmail,
  isOwner,
  contractStatus,
  billingPlan,
  paymentProvider,
  contractEndDate,
  trialEndDate,
  trialDaysRemaining,
  graceEndDate,
  graceDaysRemaining,
  lastCheckoutUrl,
  lastCheckoutAt,
}) => {
  const { isPwaApp } = usePwaContext()

  const currentPlanKey = normalizePlanKey(billingPlan)
  const [selectedPlanId, setSelectedPlanId] = useState<PlanOption['id']>('starter-monthly')

  const [loading, setLoading] = useState(false)
  const [addonLoading, setAddonLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isTrial = normalizePlanKey(contractStatus) === 'trial' || currentPlanKey === 'trial'
  const isUnpaid = normalizePlanKey(contractStatus) === 'unpaid'

  const isBusiness = currentPlanKey?.includes('business') ?? false
  const isYearlyPlan = currentPlanKey?.includes('year') ?? false

  // Default add-on interval follows current plan (yearly vs monthly)
  const [addonInterval, setAddonInterval] = useState<'monthly' | 'yearly'>(
    isYearlyPlan ? 'yearly' : 'monthly',
  )

  useEffect(() => {
    setAddonInterval(isYearlyPlan ? 'yearly' : 'monthly')
  }, [isYearlyPlan])

  const hasPaidContract = useMemo(() => {
    // Anything not trial/unpaid is treated as active for UI purposes.
    if (isTrial) return false
    if (isUnpaid) return false
    if (!contractStatus && !billingPlan) return false
    return true
  }, [isTrial, isUnpaid, contractStatus, billingPlan])

  const billingPlanDisplay = useMemo(() => {
    // Try to map known keys
    const match = PLANS.find(p => p.id === currentPlanKey)
    if (match) return match.label + (match.description ? ` – ${match.description}` : '')

    // Fallback human label
    if (!billingPlan) return '—'
    if (billingPlan === 'trial') return 'Trial'
    return billingPlan
  }, [billingPlan, currentPlanKey])

  const trialDetail = useMemo(() => {
    if (!trialEndDate || trialEndDate === '—') return '—'
    return trialDaysRemaining ? `${trialEndDate} (${trialDaysRemaining})` : trialEndDate
  }, [trialEndDate, trialDaysRemaining])

  const graceDetail = useMemo(() => {
    if (!graceEndDate || graceEndDate === '—') return '—'
    return graceDaysRemaining ? `${graceEndDate} (${graceDaysRemaining})` : graceEndDate
  }, [graceEndDate, graceDaysRemaining])

  const startCheckoutForPlan = async (planId: PlanOption['id']) => {
    setError(null)

    if (!isOwner) {
      setError('Only the owner can manage billing.')
      return
    }
    if (!storeId) {
      setError('Missing workspace ID. Please refresh and try again.')
      return
    }
    if (!ownerEmail) {
      setError('Missing billing email. Please log in again.')
      return
    }

    const targetPlan = PLANS.find(plan => plan.id === planId)
    if (!targetPlan) {
      setError('No billing plans are available right now. Please try again later.')
      return
    }

    try {
      setLoading(true)
      const redirectUrl = `${window.location.origin}/billing/verify?storeId=${encodeURIComponent(
        storeId,
      )}`

      const response = await startPaystackCheckout({
        email: ownerEmail,
        storeId,
        amount: targetPlan.amountGhs,
        plan: targetPlan.id,
        redirectUrl,
        metadata: { source: 'account-contract-billing' },
      })

      if (!response.ok || !response.authorizationUrl) {
        setError('Unable to start checkout. Please try again.')
        return
      }

      window.location.assign(response.authorizationUrl)
    } catch (err) {
      console.error('Checkout error', err)
      setError(err instanceof Error ? err.message : 'Something went wrong starting checkout.')
    } finally {
      setLoading(false)
    }
  }

  const handleBuyExtraWorkspace = async () => {
    setError(null)

    if (!isOwner) {
      setError('Only the owner can add extra workspaces.')
      return
    }
    if (!storeId) {
      setError('Missing workspace ID. Please refresh and try again.')
      return
    }
    if (!ownerEmail) {
      setError('Missing billing email. Please log in again.')
      return
    }

    try {
      setAddonLoading(true)
      const redirectUrl = `${window.location.origin}/account`

      const response = await startExtraWorkspaceCheckout({
        storeId,
        interval: addonInterval,
        add: 1,
        redirectUrl,
        metadata: { source: 'account-extra-workspace' },
      })

      if (!response.ok || !response.authorizationUrl) {
        setError('Unable to start checkout. Please try again.')
        return
      }

      window.location.assign(response.authorizationUrl)
    } catch (err) {
      console.error('Extra workspace checkout error', err)
      setError(err instanceof Error ? err.message : 'Something went wrong starting checkout.')
    } finally {
      setAddonLoading(false)
    }
  }

  if (isPwaApp) {
    return (
      <section id="account-overview-contract">
        <h2>Billing</h2>
        <p className="text-sm text-gray-700">
          Billing is managed on <strong>sedifex.com</strong>. Open Sedifex in your browser to pay
          and renew. (Payments are not supported inside the installed app.)
        </p>
        <dl className="account-overview__grid">
          <div>
            <dt>Status</dt>
            <dd>{contractStatus ?? '—'}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{billingPlanDisplay}</dd>
          </div>
          <div>
            <dt>Trial ends</dt>
            <dd>{trialDetail}</dd>
          </div>
          <div>
            <dt>Grace period ends</dt>
            <dd>{graceDetail}</dd>
          </div>
          <div>
            <dt>Last checkout</dt>
            <dd>{lastCheckoutAt ?? '—'}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{paymentProvider ?? 'Paystack'}</dd>
          </div>
        </dl>
        {lastCheckoutUrl && (
          <p className="text-sm text-gray-600">
            Resume payment in your browser:{' '}
            <a href={lastCheckoutUrl} target="_blank" rel="noreferrer noopener">
              Open Paystack checkout
            </a>
            .
          </p>
        )}
      </section>
    )
  }

  if (!isOwner) {
    return (
      <section id="account-overview-contract">
        <h2>Billing</h2>
        <p className="text-sm text-gray-600">
          Only the workspace owner can manage billing. Ask the owner to subscribe on their account.
        </p>
      </section>
    )
  }

  return (
    <section id="account-overview-contract">
      <h2>Billing</h2>

      <dl className="account-overview__grid">
        <div>
          <dt>Status</dt>
          <dd>{contractStatus ?? '—'}</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>{billingPlanDisplay}</dd>
        </div>
        <div>
          <dt>Trial ends</dt>
          <dd>{trialDetail}</dd>
        </div>
        <div>
          <dt>Grace period ends</dt>
          <dd>{graceDetail}</dd>
        </div>
        <div>
          <dt>Last checkout</dt>
          <dd>{lastCheckoutAt ?? '—'}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{paymentProvider ?? 'Paystack'}</dd>
        </div>
      </dl>

      {hasPaidContract ? (
        <div className="account-overview__notice" role="status">
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              ✅ Your subscription is active{contractEndDate ? (
                <>
                  {' '}
                  until <strong>{contractEndDate}</strong>.
                </>
              ) : null}
            </p>

            {/* Extra workspace only makes sense for Starter; Business already includes 5 */}
            {!isBusiness && (
              <div className="border-t border-gray-200 pt-4 space-y-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Add another workspace</p>
                  <p className="text-xs text-gray-600">
                    For 2 stores, stay on Starter and pay once to unlock one more workspace.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={addonInterval}
                    onChange={event => setAddonInterval(event.target.value as 'monthly' | 'yearly')}
                    className="border rounded px-2 py-1 text-sm"
                    disabled={addonLoading || loading}
                  >
                    <option value="monthly">Monthly add-on · GHS 50</option>
                    <option value="yearly">Yearly add-on · GHS 500</option>
                  </select>

                  <button
                    type="button"
                    className="button button--primary"
                    onClick={handleBuyExtraWorkspace}
                    disabled={addonLoading || loading}
                  >
                    {addonLoading ? 'Starting checkout…' : 'Buy extra workspace'}
                  </button>
                </div>
              </div>
            )}

            {/* Upgrade CTA */}
            {!isBusiness && !isYearlyPlan && (
              <div className="border-t border-gray-200 pt-4">
                <p className="text-sm font-medium text-gray-900">Want to pay yearly?</p>
                <p className="text-xs text-gray-600">
                  Pay once and stay active for 12 months (2 months free).
                </p>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => startCheckoutForPlan('starter-yearly')}
                  disabled={loading || addonLoading}
                  style={{ marginTop: 8 }}
                >
                  {loading ? 'Starting…' : 'Switch to yearly'}
                </button>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {isTrial && (
              <p className="text-sm text-gray-700">
                You’re on a <strong>trial</strong>. Choose a plan to keep your workspace active.
              </p>
            )}
            {isUnpaid && (
              <p className="text-sm text-gray-700">
                Your workspace is <strong>unpaid</strong>. Pay to unlock full access.
              </p>
            )}
            <p className="text-sm text-gray-700">
              To pay, select a plan below and click <strong>Pay with Paystack</strong>. You’ll be
              redirected to Paystack’s secure checkout to complete payment.
            </p>
          </div>

          <div className="mt-4 grid gap-3" style={{ maxWidth: 720 }}>
            {PLANS.map(plan => {
              const selected = plan.id === selectedPlanId
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlanId(plan.id)}
                  className="button"
                  style={{
                    textAlign: 'left',
                    padding: 14,
                    borderRadius: 12,
                    border: selected ? '2px solid #111827' : '1px solid #E5E7EB',
                    background: selected ? '#F9FAFB' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{plan.label}</strong>
                        {plan.badge ? (
                          <span
                            style={{
                              fontSize: 12,
                              padding: '2px 8px',
                              borderRadius: 999,
                              border: '1px solid #E5E7EB',
                            }}
                          >
                            {plan.badge}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-600">{plan.description}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>GHS {plan.amountGhs.toFixed(2)}</div>
                    </div>
                  </div>

                  <ul style={{ marginTop: 10, marginLeft: 18, fontSize: 12, color: '#374151' }}>
                    {plan.highlights.map(h => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </button>
              )
            })}
          </div>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="button button--primary"
              disabled={loading}
              onClick={() => startCheckoutForPlan(selectedPlanId)}
            >
              {loading ? 'Starting checkout…' : 'Pay with Paystack'}
            </button>
            {lastCheckoutUrl && (
              <p className="text-xs text-gray-500" style={{ marginTop: 8 }}>
                Already started?{' '}
                <a href={lastCheckoutUrl} target="_blank" rel="noreferrer noopener">
                  Resume your Paystack checkout
                </a>
                .
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
