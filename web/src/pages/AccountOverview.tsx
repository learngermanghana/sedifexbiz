// web/src/components/AccountBillingSection.tsx
import React from 'react'

type Props = {
  storeId: string
  ownerEmail: string | null
  isOwner: boolean
  contractStatus: string | null
  billingPlan: string | null
  paymentProvider: string | null
  contractEndDate: string | null // ✅ new prop
}

export const AccountBillingSection: React.FC<Props> = ({
  storeId,
  ownerEmail,
  isOwner,
  contractStatus,
  billingPlan,
  paymentProvider,
  contractEndDate, // ✅ destructured here
}) => {
  const isTrial = contractStatus === 'trial' || billingPlan === 'trial'
  const hasPlan = !!billingPlan && billingPlan !== 'trial'

  return (
    <section aria-labelledby="account-overview-billing">
      <div className="account-overview__section-header">
        <h2 id="account-overview-billing">Billing</h2>
      </div>

      <dl className="account-overview__grid">
        <div>
          <dt>Plan</dt>
          <dd>
            {isTrial
              ? 'Trial'
              : hasPlan
              ? billingPlan
              : 'No active plan'}
          </dd>
        </div>

        <div>
          <dt>Status</dt>
          <dd>{contractStatus ?? '—'}</dd>
        </div>

        <div>
          <dt>Payment provider</dt>
          <dd>{paymentProvider ?? '—'}</dd>
        </div>

        <div>
          <dt>Renews / ends</dt>
          <dd>{contractEndDate ?? '—'}</dd>
        </div>

        {isOwner && (
          <div>
            <dt>Manage billing</dt>
            <dd>
              {/* Replace this with your real “manage billing” link / button */}
              <button
                type="button"
                className="button button--secondary"
                data-testid="account-manage-billing"
                onClick={() => {
                  // e.g. open a billing portal
                  // openBillingPortal({ storeId, ownerEmail })
                  console.log('Open billing portal for', storeId, ownerEmail)
                }}
              >
                Manage billing
              </button>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
