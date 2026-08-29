import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'

import '../App.css'
import './InventorySystemGhana.css'

const PAGE_URL = 'https://sedifex.com/wedding-planning-software'
const PAGE_TITLE = 'Wedding Planning Software for Wedding Planners | Sedifex'
const PAGE_DESCRIPTION =
  'Wedding planning software for planners and coordination teams. Manage couples, client tasks, run sheets, wedding programs, vendors, staff, contracts and event finance with Sedifex.'

const FEATURES = [
  ['Couple and client portal', 'Share one secure client portal for the event brief, published program, client-visible tasks and updates.'],
  ['Wedding checklist collaboration', 'Choose the checklist items the couple should see. Clients can mark a task done, add an optional note and send it to your team for confirmation.'],
  ['Wedding-day run sheet', 'Build the internal schedule for coordinators, bridal party support, vendors, locations and hand-offs throughout the day.'],
  ['Guest-facing wedding program', 'Create and publish the order of activities separately from the operational run sheet, with optional client approval and change requests.'],
  ['Wedding details in one workspace', 'Keep wedding party, seating, ceremony details and other event-specific information connected to the same event.'],
  ['Vendor and team coordination', 'Manage supplier information and staff responsibilities without scattering critical details across unrelated chats and spreadsheets.'],
  ['Contracts and event finance', 'Keep contracts, invoices, receipts and event-related financial records connected to the wedding workspace.'],
  ['Post-event evaluation', 'Capture what worked, what changed and what your team should improve for the next wedding.'],
] as const

const FAQS = [
  {
    question: 'Can Sedifex be used by wedding planning companies?',
    answer: 'Yes. Sedifex supports wedding planners and coordination teams with client collaboration, checklists, run sheets, programs, vendors, staff, contracts, finance and evaluation.',
  },
  {
    question: 'Can a couple mark wedding checklist items as completed?',
    answer: 'Yes. Staff choose which checklist items are shared. The client can mark a shared task done and send it to the event team for verification.',
  },
  {
    question: 'Can we manage both the wedding program and the internal schedule?',
    answer: 'Yes. Sedifex keeps the guest-facing Program separate from the internal Run Sheet used by coordinators, staff and vendors.',
  },
  {
    question: 'Does Sedifex support traditional and white weddings?',
    answer: 'Yes. Sedifex supports Traditional weddings, White weddings, Engagements and other event types, with wedding-specific detail sections where appropriate.',
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

export default function WeddingPlanningSoftware() {
  useEffect(() => {
    document.title = PAGE_TITLE
    upsertMetaTag('name', 'description', PAGE_DESCRIPTION)
    upsertMetaTag('name', 'robots', 'index, follow, max-image-preview:large')
    upsertMetaTag('name', 'keywords', 'wedding planning software, wedding planner software, wedding management software, wedding coordination software, wedding planner software Ghana, client portal for wedding planners, wedding checklist software, wedding run sheet software')
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
          name: 'Sedifex Wedding Planning Software',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: PAGE_URL,
          description: PAGE_DESCRIPTION,
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
    script.dataset.sedifexSeo = 'wedding-planning-software'
    script.text = JSON.stringify(structuredData)
    document.head.appendChild(script)
    return () => script.remove()
  }, [])

  return (
    <main className="seo-page">
      <header className="seo-page__hero">
        <div className="seo-page__hero-content">
          <span className="seo-page__eyebrow">Wedding planning software</span>
          <h1>Wedding planning software for planners who manage the whole event.</h1>
          <p>
            Sedifex gives wedding planning companies one connected workspace for the couple,
            checklist, wedding-day run sheet, program, vendors, staff, contracts and event finance.
          </p>
          <div className="seo-page__hero-actions">
            <Link className="seo-page__cta" to="/">Start with Sedifex</Link>
            <a className="seo-page__secondary" href="mailto:info@sedifex.com?subject=Wedding%20Planning%20Software%20Demo">Book a demo</a>
          </div>
        </div>
      </header>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Manage wedding planning and client collaboration together</h2>
          <p>Keep the couple informed without exposing your internal planning work.</p>
        </div>
        <div className="seo-page__grid">
          {FEATURES.map(([title, description]) => (
            <article key={title} className="seo-page__card"><h3>{title}</h3><p>{description}</p></article>
          ))}
        </div>
      </section>

      <section className="seo-page__section seo-page__section--highlight">
        <div className="seo-page__section-header">
          <h2>Built for traditional weddings, white weddings and engagements</h2>
          <p>
            Use a consistent planning workflow while keeping wedding-specific details, client tasks,
            programs and event-day coordination in the same system.
          </p>
        </div>
        <div className="seo-page__hero-actions">
          <Link className="seo-page__cta" to="/event-management-software">Explore all event management features</Link>
          <Link className="seo-page__secondary" to="/event-management-software-ghana">Event management software in Ghana</Link>
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
