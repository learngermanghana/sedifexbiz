import React from 'react'
import { Link } from 'react-router-dom'

export default function Finance() {
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Document Generator</h2>
          <p className="page__subtitle">
            Create invoices and receipts from the dedicated generator page.
          </p>
        </div>
        <Link className="button button--primary button--small" to="/finance/documents">
          Open generator
        </Link>
      </header>

      <section className="card" aria-label="Generator overview">
        <h3 className="card__title">Generate professional invoices and receipts</h3>
        <p className="card__subtitle" style={{ marginTop: 10 }}>
          Build PDFs with company details, customer contacts, line items, totals, and taxes.
        </p>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <Link className="button button--primary" to="/finance/documents">
            Open generator
          </Link>
          <Link className="button button--ghost" to="/dashboard">
            Go to home dashboard
          </Link>
        </div>
      </section>
    </div>
  )
}
