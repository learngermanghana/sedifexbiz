// web/src/pages/Expenses.tsx
import React from 'react'

export default function Expenses() {
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Expenses</h2>
          <p className="page__subtitle">
            Record rent, salaries, utilities, and other store costs so you can see real profit.
          </p>
        </div>
      </header>

      <div className="card">
        <h3 className="card__title">Coming soon</h3>
        <p className="card__subtitle">
          You can already close your day and manage billing. The full expense tracker will live here.
        </p>
      </div>
    </div>
  )
}
