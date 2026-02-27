import React from 'react'
import { Link } from 'react-router-dom'

export default function Finance() {
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Finance</h2>
          <p className="page__subtitle">Choose what you want to generate.</p>
        </div>
      </header>

      <section className="card" aria-label="Finance tools">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="button button--primary" to="/finance/documents?type=receipt">
            Generate Receipt
          </Link>
          <Link className="button button--ghost" to="/finance/documents?type=invoice">
            Generate Invoice
          </Link>
        </div>
      </section>
    </div>
  )
}
