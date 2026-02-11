import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import '../App.css'
import './InventorySystemGhana.css'

const PAGE_TITLE = 'Inventory System Ghana | Sedifex'
const PAGE_DESCRIPTION =
  'Sedifex is the AI-powered inventory system built for Ghana businesses. Track stock, sales, and finance in one place with smart count accuracy, easy Excel/CSV sharing, real-time alerts, and insights.'

const FEATURE_LIST = [
  {
    title: 'Real-time stock control',
    description:
      'Track inventory across locations, warehouses, and shelves with live updates every time you sell or receive stock.',
  },
  {
    title: 'Fast barcode sales',
    description:
      'Sell faster with quick search, barcode scanning, and mobile-friendly checkout built for busy Ghanaian shops and retail stores in Accra.',
  },
  {
    title: 'Low stock alerts',
    description:
      'Never run out of best sellers. Get smart notifications and reorder insights before products run low.',
  },
  {
    title: 'Easy Excel & CSV sharing',
    description:
      'Share data between Excel and Sedifex in minutes so teams can forecast, budget, and move over from spreadsheets with confidence.',
  },
  {
    title: 'Smart count',
    description:
      'Count inventory without freezing your whole warehouse. We track sales and stock receipts that land during the count so you can reconcile accurately.',
  },
  {
    title: 'Profit & cashflow visibility',
    description:
      'See revenue, profit, and expenses in one dashboard so you know what to restock and what to retire.',
  },
  {
    title: 'Multi-store insights',
    description:
      'Manage multiple branches with one view. Compare performance and transfer stock without confusion.',
  },
  {
    title: 'Trusted by growing teams',
    description:
      'Assign staff roles, track activity, and keep accountability for every sale and inventory change.',
  },
]

const USE_CASES = [
  {
    title: 'Retail & mini-mart owners',
    detail: 'Stay ahead of fast-moving goods, track expiry dates, and reduce shrinkage.',
  },
  {
    title: 'Pharmacies & beauty stores',
    detail: 'Monitor batch numbers, expiry dates, and high-value SKUs with confidence.',
  },
  {
    title: 'Wholesale & distribution',
    detail: 'Manage bulk orders, deliveries, and customer credit without spreadsheets.',
  },
  {
    title: 'Restaurants & hospitality',
    detail: 'Track ingredients, menu sales, and inventory costs in one workflow.',
  },
]

const FAQS = [
  {
    question: 'Is Sedifex an inventory system made for Ghana?',
    answer:
      'Yes. Sedifex is built with Ghanaian businesses in mind, including mobile-friendly workflows, multi-store support, and fast sales tools that work in Accra, Kumasi, Takoradi, and beyond.',
  },
  {
    question: 'Can I track inventory and sales together?',
    answer:
      'Absolutely. Every sale automatically updates your stock counts, so you always know what is available and what needs restocking.',
  },
  {
    question: 'Does Sedifex support multiple branches?',
    answer:
      'Yes. You can manage multiple locations, transfer stock between branches, and see each store’s performance in one dashboard.',
  },
  {
    question: 'How fast can I start?',
    answer:
      'You can set up your Sedifex inventory system within minutes. Import products, add staff, and begin selling the same day.',
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

export default function InventorySystemGhana() {
  useEffect(() => {
    document.title = PAGE_TITLE

    upsertMetaTag('name', 'description', PAGE_DESCRIPTION)
    upsertMetaTag('property', 'og:title', PAGE_TITLE)
    upsertMetaTag('property', 'og:description', PAGE_DESCRIPTION)
    upsertMetaTag('property', 'og:type', 'website')
    upsertMetaTag('property', 'og:url', window.location.href)
  }, [])

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: 'https://sedifex.com/inventory-system-ghana/',
    about: {
      '@type': 'SoftwareApplication',
      name: 'Sedifex',
      operatingSystem: 'Web',
      applicationCategory: 'BusinessApplication',
    },
  }
  const faqStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is the best inventory system in Ghana?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Sedifex is a modern inventory system in Ghana designed for shops, pharmacies, supermarkets, and small businesses.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can Sedifex be used on phones and tablets?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Sedifex works on computers, tablets, and smartphones.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does Sedifex support POS and checkout?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Sedifex includes a POS system with barcode scanning, payments, and digital receipts.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is Sedifex suitable for small businesses in Ghana?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Sedifex was built to support small and growing businesses in Ghana.',
        },
      },
    ],
  }

  return (
    <main className="seo-page">
      <header className="seo-page__hero">
        <div className="seo-page__hero-content">
          <span className="seo-page__eyebrow">Inventory System Ghana</span>
          <h1>Grow faster with the #1 AI inventory system for Ghana businesses.</h1>
          <p>
            Sedifex helps Ghanaian retailers, wholesalers, and service businesses track stock,
            sales, and finance in one smart workspace. Know what to reorder, prevent stock
            losses, share data with Excel for better projections, and keep every branch aligned.
          </p>
          <p>
            Sedifex is used by shops in Accra and across Ghana to manage inventory, sales,
            and customer communication efficiently.
          </p>
          <div className="seo-page__hero-actions">
            <Link className="seo-page__cta" to="/">
              Start free demo
            </Link>
            <a className="seo-page__secondary" href="mailto:sedifexbiz@gmail.com">
              Talk to sales
            </a>
          </div>
          <div className="seo-page__hero-metrics">
            <div>
              <strong>Real-time</strong>
              <span>Inventory updates</span>
            </div>
            <div>
              <strong>Multi-store</strong>
              <span>Branch visibility</span>
            </div>
            <div>
              <strong>AI insights</strong>
              <span>Predictive restocking</span>
            </div>
          </div>
        </div>
      </header>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Why Sedifex is the best inventory system in Ghana</h2>
          <p>
            Ghana businesses need speed, clarity, and flexibility. Sedifex delivers an
            inventory system that unifies your stock, sales, and finance so you can make
            confident decisions every day.
          </p>
        </div>
        <div className="seo-page__grid">
          {FEATURE_LIST.map(feature => (
            <article key={feature.title} className="seo-page__card">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
        <div className="seo-page__grid">
          <article className="seo-page__card">
            <h3>Shareable sell screen</h3>
            <p>
              Share the customer display so shoppers can confirm items and download
              receipts instantly on their phones.
            </p>
          </article>
          <article className="seo-page__card">
            <h3>Bulk SMS outreach</h3>
            <p>
              Send targeted SMS updates to customers about offers, new arrivals, or
              outstanding balances.
            </p>
          </article>
          <article className="seo-page__card">
            <h3>Invoice generator</h3>
            <p>
              Create branded invoices and share them with customers in seconds—no extra
              tools needed.
            </p>
          </article>
          <article className="seo-page__card">
            <h3>Live activity updates</h3>
            <p>
              See real-time activity across sales, inventory, and staff so every branch
              stays aligned.
            </p>
          </article>
        </div>
      </section>

      <section className="seo-page__section seo-page__section--highlight">
        <div className="seo-page__section-header">
          <h2>Built for Ghana’s fast-moving inventory challenges</h2>
          <p>
            From fast-moving consumer goods to high-value electronics, Sedifex gives you
            visibility across every product and every store. Track stock levels, get alerts,
            and see profit trends in real time.
          </p>
        </div>
        <div className="seo-page__highlight-grid">
          <div>
            <h3>Accurate counts</h3>
            <p>
              Scan, search, or bulk upload inventory so your records are always accurate.
              Cut stock losses and reconcile faster.
            </p>
          </div>
          <div>
            <h3>Smarter reorders</h3>
            <p>
              Use sales trends and low-stock alerts to reorder the right items at the right
              time, reducing capital tied up in slow stock.
            </p>
          </div>
          <div>
            <h3>Trusted reporting</h3>
            <p>
              Get daily sales, inventory valuation, and profit reports for smarter planning
              with your team or investors.
            </p>
          </div>
        </div>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Who Sedifex helps</h2>
          <p>
            Sedifex supports every industry that needs reliable inventory tracking in Ghana,
            from shops in Ghana to small businesses in Ghana growing beyond a single location.
          </p>
        </div>
        <div className="seo-page__grid seo-page__grid--compact">
          {USE_CASES.map(item => (
            <article key={item.title} className="seo-page__card">
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="seo-page__section seo-page__section--steps">
        <div className="seo-page__section-header">
          <h2>How to set up your inventory system in Ghana</h2>
          <p>Get started in minutes and grow from day one.</p>
        </div>
        <ol className="seo-page__steps">
          <li>
            <strong>Add your products.</strong> Import or upload your items, prices, and
            stock levels.
          </li>
          <li>
            <strong>Connect your team.</strong> Add staff accounts and assign roles for
            accountability.
          </li>
          <li>
            <strong>Start selling.</strong> Every sale updates inventory automatically and
            powers smarter restocking.
          </li>
        </ol>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Frequently asked questions</h2>
        </div>
        <div className="seo-page__faq">
          {FAQS.map(item => (
            <article key={item.question}>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="seo-page__cta-section">
        <div>
          <h2>Ready to upgrade your inventory system in Ghana?</h2>
          <p>
            Join teams across Ghana who trust Sedifex to keep inventory accurate, sales
            flowing, and profits visible.
          </p>
        </div>
        <div className="seo-page__cta-actions">
          <Link className="seo-page__cta" to="/">
            Book a free walkthrough
          </Link>
          <a className="seo-page__secondary" href="mailto:sedifexbiz@gmail.com">
            Contact the team
          </a>
        </div>
      </section>

      <section className="seo-page__section">
        <div className="seo-page__section-header">
          <h2>Frequently Asked Questions</h2>
        </div>
        <div className="seo-page__faq">
          <article>
            <h3>What is the best inventory system in Ghana?</h3>
            <p>
              Sedifex is a modern inventory system in Ghana designed for shops, pharmacies,
              supermarkets, and small businesses to manage stock, sales, receipts, and
              customer communication.
            </p>
          </article>
          <article>
            <h3>Can Sedifex be used on phones and tablets?</h3>
            <p>
              Yes. Sedifex works on computers, tablets, and smartphones, allowing businesses
              in Ghana to manage inventory and sales from any device.
            </p>
          </article>
          <article>
            <h3>Does Sedifex support POS and checkout?</h3>
            <p>
              Yes. Sedifex includes a full POS system with barcode scanning, payment
              tracking, digital receipts, and customer display features.
            </p>
          </article>
          <article>
            <h3>Is Sedifex suitable for small businesses in Ghana?</h3>
            <p>
              Yes. Sedifex was built specifically to make inventory and sales management
              affordable and practical for small and growing businesses in Ghana.
            </p>
          </article>
        </div>
      </section>

      <script type="application/ld+json">
        {JSON.stringify(structuredData)}
      </script>
      <script type="application/ld+json">
        {JSON.stringify(faqStructuredData)}
      </script>
    </main>
  )
}
