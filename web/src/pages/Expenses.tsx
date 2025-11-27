// web/src/pages/Expenses.tsx
import React from 'react'

export default function Expenses() {
  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Expenses</h2>
          <p className="page__subtitle">
            Record rent, salaries, utilities, and other costs so your profit numbers stay accurate.
          </p>
        </div>
      </header>

      <div className="card">
        <p className="card__subtitle">
          This is a starter Expenses page. We can later hook it into Firestore so it becomes a full
          accounting view.
        </p>
      </div>
    </div>
  )
}
