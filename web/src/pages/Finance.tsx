import React from 'react'
import { Link } from 'react-router-dom'

export default function Finance() {
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Finance</h2>
          <p className="page__subtitle">
            Track cash, expenses, and billing for your Sedifex workspace.
          </p>
        </div>
      </header>

      <div className="card" style={{ display: 'grid', gap: 16 }}>
        <h3 className="card__title">Quick links</h3>
        <ul className="link-list">
          <li>
            <Link to="/close-day">Close Day &amp; cash counts</Link>
          </li>
          <li>
            <Link to="/account">Billing &amp; subscription</Link>
          </li>
          {/* later you can add: <li><Link to="/expenses">Expenses</Link></li> */}
        </ul>
      </div>
    </div>
  )
}
