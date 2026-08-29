import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'

import '../App.css'
import './InventorySystemGhana.css'

const PAGE_TITLE =
  'Sedifex Pricing | Inventory, Bulk SMS, Google Ads Automation & Free Store Page'
const PAGE_DESCRIPTION =
  'Choose a Sedifex plan for inventory management, branded Bulk SMS, Google Ads automation, free public store page, social video integration, and connected business communication in Ghana.'

const CORE_FEATURES = [
  'Real-time inventory tracking',
  'Product and stock movement records',
  'Branded Bulk SMS capabilities',
  'Google Ads automation for campaign performance',
  'SEO-friendly landing page content',
  'Free public store page',
  'TikTok and YouTube display on website',
  'Website updates reflected from Sedifex',
  'Unified communication across operations',
]

const PLANS = [
  {
    name: 'Starter',
    subtitle: 'For small businesses getting started',
    points: [
      'Price: GHS 20/month (GHS 240/year billed upfront)',
      'Core inventory management',
      'Basic reporting',
      'Free public store page',
      '1 business location',
      'Email support',
    ],
    cta: 'Start Starter Plan',
    to: '/',
  },
  {
    name: 'Growth',
    subtitle: 'For businesses scaling communication and operations',
    points: [
      'Price: GHS 50/month (GHS 600/year billed upfront)',
      'Everything in Starter',
      'Branded Bulk SMS features',
      'Google Ads automation',
      'Advanced inventory insights',
      'More team access',
      'Priority support',
    ],
    cta: 'Start Growth Plan',
    to: '/',
  },
  {
    name: 'Scale',
    subtitle: 'For multi-branch and high-volume operations',
    points: [
      'Price: GHS 100/month (GHS 1200/year billed upfront)',
      'Everything in Growth',
      'Multi-branch support',
      'Higher SMS and usage capacity',
      'Advanced Google Ads automation and optimization',
      'Advanced analytics and controls',
      'Dedicated onboarding support',
    ],
    cta: 'Talk to Sales',
    to: 'mailto:info@sedifex.com',
  },
  {
    name: 'Scale Plus',
    subtitle: 'For businesses that need unlimited uploads and website creation',
    points: [
      'Everything in Scale',
      'Unlimited uploads',
      'Website creation support',
      'Enterprise onboarding and account management',
      'Price: GHS 2000/year (GHS 166.67/month billed yearly)',
    ],
    cta: 'Talk to Sales',
    to: 'mailto:info@sedifex.com',
  },
]

const FAQS = [
  {
    question: 'Can I change plans later?',
    answer: 'Yes. You can upgrade your plan as your business grows.',
  },
  {
    question: 'Do all plans include a free public store page?',
    answer: 'Yes. Every plan includes a free public page for your business profile and products.',
  },
  {
    question: 'Which plan is best for branded Bulk SMS?',
    answer:
      'Growth and Scale are ideal for businesses that want stronger branded communication at scale.',
  },
  {
    question: 'Do you support Google Ads automation?',
    answer:
      'Yes. Growth, Scale, and Scale Plus include Google Ads automation to help businesses launch and optimize campaigns faster.',
  },
  {
    question: 'Is Sedifex suitable for SMEs in Ghana?',
    answer: 'Yes. Sedifex is built for Ghana SMEs and teams expanding across locations.',
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

export default function PricingPage() {
  useEffect(() => {
    document.title = PAGE_TITLE
    upsertMetaTag('name', 'description', PAGE_DESCRIPTION)
    upsertMetaTag('property', 'og:title', PAGE_TITLE)
    upsertMetaTag('property', 'og:description', PAGE_DESCRIPTION)
    upsertMetaTag('property', 'og:type', 'website')
    upsertMetaTag('property', 'og:url', window.location.href)
    upsertMetaTag(
      'name',
      'keywords',
      'Sedifex pricing, Google Ads automation, SEO, inventory system Ghana, bulk SMS Ghana, retail software Ghana, event management software, event planning software',
    )
  }, [])

  return (
    <main className="seo-page">
      <header className="seo-page__hero">
        <div className="seo-page__hero-content">
          <span className="seo-page__eyebrow">Sedifex Pricing</span>
          <h1>Simple, affordable pricing for growing businesses.</h1>
          <p>
            Choose a plan that fits your business. Sedifex combines inventory control, branded
            Bulk SMS, Google Ads automation, free public store pages, and social video
            integration in one platform.
          </p>
          <div className="seo-page__hero-actions">
            <Link className="seo-page__cta" to="/">
              Start free trial
            </Link>
            <a className="seo-page__secondary" href="mailto:info@sedifex.com">
              Book demo
            </a>
          </div>
        </div>
      </header>

      <section className="seo-page__section seo-page__section--highlight">
        <div className="seo-page__section-header">
          <h2>Run an event planning or coordination company?</h2>
          <p>
            Explore Sedifex event management software for client portals, shared checklists, run
            sheets, programs, vendors, staff, contracts and event finance.
          </p>
        </div>
        <div className="seo-page__hero-actions">
          <Link className="seo-page__cta" to="/event-management-software">
            Explore event management software
          </Link>
        </div>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Included in every Sedifex plan</h2>
        </div>
        <div className="seo-page__grid">
          {CORE_FEATURES.map(item => (
            <article key={item} className="seo-page__card">
              <h3>{item}</h3>
            </article>
          ))}
        </div>
      </section>

      <section className="seo-page__section seo-page__section--highlight">
        <div className="seo-page__section-header">
          <h2>Choose your plan</h2>
        </div>
        <div className="seo-page__grid">
          {PLANS.map(plan => (
            <article key={plan.name} className="seo-page__card">
              <h3>{plan.name}</h3>
              <p>{plan.subtitle}</p>
              <ul>
                {plan.points.map(point => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              {plan.to.startsWith('mailto:') ? (
                <a className="seo-page__cta" href={plan.to}>
                  {plan.cta}
                </a>
              ) : (
                <Link className="seo-page__cta" to={plan.to}>
                  {plan.cta}
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Frequently asked questions</h2>
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
