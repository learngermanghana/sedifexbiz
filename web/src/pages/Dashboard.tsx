import type { ReactElement } from 'react'
import PageSection from '../layout/PageSection'

export default function Dashboard(): ReactElement {
  return (
    <PageSection
      title="Dashboard"
      subtitle="Welcome back! Choose an option from the navigation to get started."
    >
      <div className="empty-state" role="status" aria-live="polite">
        <h3 className="empty-state__title">Insights are on the way</h3>
        <p>
          We&rsquo;re preparing daily sales summaries and quick metrics to help you monitor performance at a
          glance.
        </p>
      </div>
    </PageSection>
  )
}
