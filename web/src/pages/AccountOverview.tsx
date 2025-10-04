import type { ReactElement } from 'react'
import PageSection from '../layout/PageSection'

export default function AccountOverview(): ReactElement {
  return (
    <PageSection
      title="Account Overview"
      subtitle="Review your business settings and subscription details."
    >
      <div className="empty-state" role="status" aria-live="polite">
        <h3 className="empty-state__title">Account controls are being crafted</h3>
        <p>
          Manage billing, team access, and locations from here once configuration panels are ready.
        </p>
      </div>
    </PageSection>
  )
}
