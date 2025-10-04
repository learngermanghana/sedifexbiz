import type { ReactElement } from 'react'
import PageSection from '../layout/PageSection'

export default function Products(): ReactElement {
  return (
    <PageSection
      title="Products"
      subtitle="Manage your product catalog from here."
    >
      <div className="empty-state" role="status" aria-live="polite">
        <h3 className="empty-state__title">Product manager under construction</h3>
        <p>
          We&rsquo;re polishing tools to add items, adjust pricing, and sync inventory with your registers.
        </p>
      </div>
    </PageSection>
  )
}
