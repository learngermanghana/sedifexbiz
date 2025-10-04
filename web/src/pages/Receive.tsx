import type { ReactElement } from 'react'
import PageSection from '../layout/PageSection'

export default function Receive(): ReactElement {
  return (
    <PageSection
      title="Receive Stock"
      subtitle="Log incoming shipments and update inventory levels."
    >
      <div className="empty-state" role="status" aria-live="polite">
        <h3 className="empty-state__title">Receiving workflow coming soon</h3>
        <p>
          Track purchase orders, reconcile deliveries, and update counts without leaving this screen.
        </p>
      </div>
    </PageSection>
  )
}
