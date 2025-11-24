import type { ReactElement } from 'react'
import DailySummary from './DailySummary'
import PageSection from '../layout/PageSection'

export default function Reports(): ReactElement {
  return (
    <div className="reports-page">
      <DailySummary />

      <PageSection
        title="Today"
        subtitle="Track today’s performance and quick actions."
      >
        <div className="empty-state" role="status" aria-live="polite">
          <h3 className="empty-state__title">Today’s snapshot is coming soon</h3>
          <p>
            Soon you&rsquo;ll see live sales, top products, and urgent follow-ups for the day in one convenient
            spot.
          </p>
        </div>
      </PageSection>
    </div>
  )
}
