import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'

import '../App.css'
import './InventorySystemGhana.css'

const PAGE_URL = 'https://sedifex.com/event-management-software-ghana'
const PAGE_TITLE = 'Event Management Software in Ghana for Event Companies | Sedifex'
const PAGE_DESCRIPTION =
  'Event management software in Ghana for event companies, wedding planners and coordinators. Manage client portals, checklists, run sheets, programs, vendors, staff, contracts and finance with Sedifex.'

const FEATURES = [
  ['Client portal for event companies', 'Give clients one secure place to review their event brief, published program, shared tasks and updates.'],
  ['Client-visible checklist tasks', 'Share only the checklist items clients need. They can mark tasks done and send them to your team for verification.'],
  ['Event-day run sheets', 'Plan internal staff and vendor timing, locations, ownership and hand-offs for the event day.'],
  ['Programs and client approvals', 'Publish client-facing programs separately from operational schedules and optionally request client approval.'],
  ['Wedding and event-specific details', 'Support Traditional weddings, White weddings, Engagements, Corporate events, Funerals, Naming ceremonies and other event workflows.'],
  ['Vendor and staff coordination', 'Keep suppliers, staff assignments and event operations connected to the same event workspace.'],
  ['Contracts, invoices and finance', 'Keep event agreements, invoices, receipts, expenses and financial records in the same business system.'],
  ['Built for growing Ghana teams', 'Use one event workflow as your company handles more clients, more staff and more active events.'],
] as const

const FAQS = [
  {
    question: 'Is Sedifex an event management software for companies in Ghana?',
    answer: 'Yes. Sedifex provides event planning and management tools for Ghana-based event companies, planners and coordinators, while also supporting teams operating beyond Ghana.',
  },
  {
    question: 'Can Ghana event companies use Sedifex for weddings?',
    answer: 'Yes. Sedifex supports Traditional weddings, White weddings, Engagements and other event types with client collaboration, run sheets, programs and event-specific details.',
  },
  {
    question: 'Can clients complete tasks from their phone?',
    answer: 'Yes. Clients can open their secure portal, view shared tasks, mark a task done, add an optional note and send it to the event team for confirmation.',
  },
  {
    question: 'Can Sedifex manage more than event planning?',
    answer: 'Yes. Sedifex also connects business operations such as customers, invoices, receipts, staff, reporting and other company workflows around the event operation.',
  },
]

function upsertMetaTag(attrName: 'name' | 'property', attrValue: string, content: string) {
  const selector = `meta[${attrName}='${attrValue}']`
  let tag = document.head.querySelector(selector)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attrName, attrValue)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

export default function EventManagementSoftwareGhana() {
  useEffect(() => {
    document.title = PAGE_TITLE
    upsertMetaTag('name', 'description', PAGE_DESCRIPTION)
    upsertMetaTag('name', 'robots', 'index, follow, max-image-preview:large')
    upsertMetaTag('name', 'keywords', 'event management software Ghana, event planning software Ghana, event company software Ghana, wedding planning software Ghana, event planner software Ghana, event coordination software Ghana, client portal event planners Ghana, event checklist software Ghana')
    upsertMetaTag('property', 'og:title', PAGE_TITLE)
    upsertMetaTag('property', 'og:description', PAGE_DESCRIPTION)
    upsertMetaTag('property', 'og:type', 'website')
    upsertMetaTag('property', 'og:url', PAGE_URL)
    upsertMetaTag('name', 'twitter:card', 'summary')
    upsertMetaTag('name', 'twitter:title', PAGE_TITLE)
    upsertMetaTag('name', 'twitter:description', PAGE_DESCRIPTION)

    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          '@id': `${PAGE_URL}#software`,
          name: 'Sedifex Event Management Software Ghana',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: PAGE_URL,
          description: PAGE_DESCRIPTION,
          areaServed: { '@type': 'Country', name: 'Ghana' },
          publisher: { '@type': 'Organization', name: 'Sedifex', url: 'https://sedifex.com' },
          featureList: FEATURES.map(([title]) => title),
        },
        {
          '@type': 'FAQPage',
          '@id': `${PAGE_URL}#faq`,
          mainEntity: FAQS.map(item => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        },
      ],
    }

    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.dataset.sedifexSeo = 'event-management-software-ghana'
    script.text = JSON.stringify(structuredData)
    document.head.appendChild(script)
    return () => script.remove()
  }, [])

  return (
    <main className="seo-page">
      <header className="seo-page__hero">
        <div className="seo-page__hero-content">
          <span className="seo-page__eyebrow">Event management software Ghana</span>
          <h1>Event management software in Ghana for event companies and coordinators.</h1>
          <p>
            Sedifex helps Ghana event companies manage client collaboration, checklists, run sheets,
            programs, vendors, staff, contracts and event finance from one connected workspace.
          </p>
          <div className="seo-page__hero-actions">
            <Link className="seo-page__cta" to="/">Start with Sedifex</Link>
            <a className="seo-page__secondary" href="mailto:info@sedifex.com?subject=Event%20Management%20Software%20Ghana%20Demo">Book a demo</a>
          </div>
        </div>
      </header>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>A practical event operations system for Ghana event businesses</h2>
          <p>Replace fragmented spreadsheets, chats and separate documents with one event workspace.</p>
        </div>
        <div className="seo-page__grid">
          {FEATURES.map(([title, description]) => (
            <article key={title} className="seo-page__card"><h3>{title}</h3><p>{description}</p></article>
          ))}
        </div>
      </section>

      <section className="seo-page__section seo-page__section--highlight">
        <div className="seo-page__section-header">
          <h2>For wedding planners, corporate event teams and growing event companies</h2>
          <p>
            Sedifex supports local event workflows while keeping the same structured process your
            team can use as the business grows.
          </p>
        </div>
        <div className="seo-page__hero-actions">
          <Link className="seo-page__cta" to="/event-management-software">See the complete event management platform</Link>
          <Link className="seo-page__secondary" to="/wedding-planning-software">Wedding planning software</Link>
        </div>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header"><h2>Frequently asked questions</h2></div>
        <div className="seo-page__faq">
          {FAQS.map(item => <article key={item.question} className="seo-page__faq-item"><h3>{item.question}</h3><p>{item.answer}</p></article>)}
        </div>
      </section>
    </main>
  )
}
