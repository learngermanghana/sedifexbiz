import React, { useState } from 'react'
import CloseDay from './CloseDay'
import ExpensesPage from './ExpensesPage' // we'll create this next

type FinanceTab = 'close-day' | 'expenses'

export default function Finance() {
  const [tab, setTab] = useState<FinanceTab>('close-day')

  return (
    <div className="page finance-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Finance</h2>
          <p className="page__subtitle">
            Tie out cash, record expenses, and keep your books aligned with daily sales.
          </p>
        </div>

        <div className="finance-page__tabs" role="tablist" aria-label="Finance sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'close-day'}
            className={`finance-page__tab${tab === 'close-day' ? ' is-active' : ''}`}
            onClick={() => setTab('close-day')}
          >
            Close day
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'expenses'}
            className={`finance-page__tab${tab === 'expenses' ? ' is-active' : ''}`}
            onClick={() => setTab('expenses')}
          >
            Expenses
          </button>
        </div>
      </header>

      <main>
        {tab === 'close-day' && (
          <section
            role="tabpanel"
            aria-label="Close day"
            className="finance-page__panel"
          >
            <CloseDay />
          </section>
        )}

        {tab === 'expenses' && (
          <section
            role="tabpanel"
            aria-label="Expenses"
            className="finance-page__panel"
          >
            <ExpensesPage />
          </section>
        )}
      </main>
    </div>
  )
}
