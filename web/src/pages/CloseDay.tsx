import type { ReactElement } from 'react'
import PageSection from '../layout/PageSection'

export default function CloseDay(): ReactElement {
  return (
    <PageSection
      title="Close Day"
      subtitle="Review the day’s activity before closing the books."
    >
      <div className="empty-state" role="status" aria-live="polite">
        <h3 className="empty-state__title">Closing checklist is in progress</h3>
        <p>
          We&rsquo;re building a guided checklist to reconcile drawers, verify deposits, and finalize end-of-day
          reporting.
        </p>
      </div>
    </PageSection>
  )
}
