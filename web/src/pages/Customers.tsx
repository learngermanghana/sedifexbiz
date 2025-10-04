import type { ReactElement } from 'react'
import PageSection from '../layout/PageSection'

export default function Customers(): ReactElement {
  return (
    <PageSection
      title="Customers"
      subtitle="Look up customer profiles and manage loyalty information."
    >
      <div className="empty-state" role="status" aria-live="polite">
        <h3 className="empty-state__title">Customer directory not yet available</h3>
        <p>
          Soon you&rsquo;ll be able to search customers, review visit history, and update loyalty rewards in
          one place.
        </p>
      </div>
    </PageSection>
  )
}
