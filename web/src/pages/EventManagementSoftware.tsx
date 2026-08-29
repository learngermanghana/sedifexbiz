import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'

import '../App.css'
import './InventorySystemGhana.css'

const PAGE_URL = 'https://sedifex.com/event-management-software'
const PAGE_TITLE = 'Event Management Software for Event Companies | Sedifex'
const PAGE_DESCRIPTION =
  'Event planning and management software for event companies, wedding planners and coordinators. Manage client portals, checklists, run sheets, programs, vendors, staff, contracts and finance in Sedifex.'

const FEATURES = [
  {
    title: 'One workspace for every event',
    description:
      'Keep the client brief, checklist, run sheet, program, event-specific details, vendors, staff, finance, documents and evaluation connected to the same event.',
  },
  {
    title: 'Secure client portal',
    description:
      'Share a private client link where clients can review their event brief, see the published program, complete shared tasks and follow event updates.',
  },
  {
    title: 'Client checklist completion',
    description:
      'Choose which checklist items clients can see. Clients can mark a task done, add an optional note and send it to the event team for confirmation.',
  },
  {
    title: 'Staff verification and return',
    description:
      'Submitted client tasks stay pending until your team verifies them. If something is missing, staff can return the task with a note for the client to correct.',
  },
  {
    title: 'Run sheets for event-day operations',
    description:
      'Build the internal event-day schedule with times, owners, vendors, locations and notes so coordinators and suppliers know what happens next.',
  },
  {
    title: 'Client-facing event programs',
    description:
      'Create a polished program, publish it to the client and optionally require client approval. Change requests remain separate from the operational run sheet.',
  },
  {
    title: 'Vendor and staff coordination',
    description:
      'Keep supplier and team information alongside the event instead of spreading important operational details across unrelated chats and spreadsheets.',
  },
  {
    title: 'Contracts, invoices and event finance',
    description:
      'Connect event agreements, invoices, receipts, expenses and financial records to the same business system used to manage the event.',
  },
  {
    title: 'Post-event evaluation',
    description:
      'Capture evaluation notes after the event so your company can review performance and improve future delivery.',
  },
]

const AUDIENCE = [
  'Wedding planning companies',
  'Traditional and white wedding coordinators',
  'Corporate event agencies',
  'Funeral and naming-ceremony planners',
  'Event production and coordination teams',
  'Growing event companies in Ghana and beyond',
]

const EVENT_TYPES = [
  'Traditional weddings',
  'White weddings',
  'Engagements',
  'Corporate events',
  'Funerals',
  'Naming ceremonies',
  'Charity and community events',
  'Custom event types',
]

const FAQS = [
  {
    question: 'Is Sedifex suitable for event planning companies?',
    answer:
      'Yes. Sedifex gives event companies a dedicated workspace for planning, client collaboration, event-day operations, vendors, staff, contracts, finance and post-event evaluation.',
  },
  {
    question: 'Can clients mark checklist tasks as completed?',
    answer:
      'Yes. Staff decide which checklist tasks are client-visible. The client can mark a shared task as done, add an optional note and send it to the event team for confirmation.',
  },
  {
    question: 'Does a client submission automatically mark the task complete?',
    answer:
      'No. Client submissions remain waiting for confirmation until the event team verifies them. Staff can also return a task to the client with a note if more information or work is needed.',
  },
  {
    question: 'What is the difference between the Run Sheet and Program?',
    answer:
      'The Run Sheet is the internal staff and vendor schedule for event-day operations. The Program is the client and guest-facing order of activities that can be published separately.',
  },
  {
    question: 'Can clients approve an event program?',
    answer:
      'Yes. Staff can publish a program for viewing only or turn on optional client approval. Clients can also request a program change when needed.',
  },
  {
    question: 'Can Sedifex be used for weddings and corporate events?',
    answer:
      'Yes. Sedifex supports wedding, engagement, funeral, corporate, naming, charity and other event workflows, with event-specific details where appropriate.',
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

export default function EventManagementSoftware() {
  useEffect(() => {
    document.title = PAGE_TITLE
    upsertMetaTag('name', 'description', PAGE_DESCRIPTION)
    upsertMetaTag('name', 'robots', 'index, follow, max-image-preview:large')
    upsertMetaTag(
      'name',
      'keywords',
      'event management software, event planning software, event company software, wedding planning software, event coordination software, event planner software Ghana, event management software Ghana, client portal for event planners, event checklist software, event run sheet software',
    )
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
          name: 'Sedifex Event Management Software',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web',
          url: PAGE_URL,
          description: PAGE_DESCRIPTION,
          publisher: {
            '@type': 'Organization',
            name: 'Sedifex',
            url: 'https://sedifex.com',
          },
          featureList: FEATURES.map(feature => feature.title),
        },
        {
          '@type': 'FAQPage',
          '@id': `${PAGE_URL}#faq`,
          mainEntity: FAQS.map(item => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.answer,
            },
          })),
        },
      ],
    }

    let script = document.head.querySelector<HTMLScriptElement>(
      "script[data-sedifex-seo='event-management-software']",
    )
    if (!script) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.dataset.sedifexSeo = 'event-management-software'
      document.head.appendChild(script)
    }
    script.text = JSON.stringify(structuredData)

    return () => {
      script?.remove()
    }
  }, [])

  return (
    <main className="seo-page">
      <header className="seo-page__hero">
        <div className="seo-page__hero-content">
          <span className="seo-page__eyebrow">Event management software for event companies</span>
          <h1>Plan events, work with clients and run event day from one system.</h1>
          <p>
            Sedifex is event planning and event management software for companies that need more
            than a basic checklist. Manage client collaboration, operational run sheets, programs,
            vendors, staff, contracts, invoices and event progress in one connected workspace.
          </p>
          <div className="seo-page__hero-actions">
            <Link className="seo-page__cta" to="/">
              Start with Sedifex
            </Link>
            <a className="seo-page__secondary" href="mailto:info@sedifex.com?subject=Event%20Management%20Software%20Demo">
              Book an event software demo
            </a>
          </div>
        </div>
      </header>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Event planning software that follows the real event workflow</h2>
          <p>
            Move from planning to client confirmation to event-day execution without rebuilding
            the same information in separate documents, messaging apps and spreadsheets.
          </p>
        </div>
        <div className="seo-page__grid">
          {FEATURES.map(feature => (
            <article key={feature.title} className="seo-page__card">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="seo-page__section seo-page__section--highlight">
        <div className="seo-page__section-header">
          <h2>Built for event planners, coordinators and event companies</h2>
          <p>
            Sedifex can support both small event businesses and teams managing several active
            events at the same time.
          </p>
        </div>
        <div className="seo-page__grid">
          {AUDIENCE.map(item => (
            <article key={item} className="seo-page__card">
              <h3>{item}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Use one event system across different event types</h2>
          <p>
            Keep a consistent workflow while still capturing event-specific information for each
            type of job your company handles.
          </p>
        </div>
        <div className="seo-page__grid">
          {EVENT_TYPES.map(item => (
            <article key={item} className="seo-page__card">
              <h3>{item}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="seo-page__section seo-page__section--highlight">
        <div className="seo-page__section-header">
          <h2>A clearer client checklist workflow</h2>
          <p>
            Share only the tasks a client needs to see. The client marks a task done and sends it
            to your team. Your staff verifies it or returns it with a note. This keeps internal
            planning private while giving the client a simple action list.
          </p>
        </div>
        <div className="seo-page__hero-actions">
          <Link className="seo-page__cta" to="/pricing">
            View Sedifex pricing
          </Link>
          <Link className="seo-page__secondary" to="/">
            Create an account
          </Link>
        </div>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Frequently asked questions about Sedifex for event companies</h2>
        </div>
        <div className="seo-page__faq">
          {FAQS.map(item => (
            <article key={item.question} className="seo-page__faq-item">
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
