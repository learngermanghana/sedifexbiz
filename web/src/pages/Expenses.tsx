import React, { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'
import './Workspace.css' // optional, reuse existing styles if you have them

type Expense = {
  id: string
  storeId: string
  amount: number
  category: string
  expenseDate: string // YYYY-MM-DD
  notes?: string
  createdAt?: unknown
}

export default function Expenses() {
  const { storeId } = useActiveStore()
  const user = useAuthUser()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load latest expenses for this store
  useEffect(() => {
    if (!storeId) {
      setExpenses([])
      return
    }

    const q = query(
      collection(db, 'expenses'),
      where('storeId', '==', storeId),
      orderBy('expenseDate', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(50),
    )

    const unsubscribe = onSnapshot(q, snapshot => {
      const rows: Expense[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Expense, 'id'>),
      }))
      setExpenses(rows)
    })

    return unsubscribe
  }, [storeId])

  const total = useMemo(
    () => expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [expenses],
  )

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (!storeId) {
      setError('Select or create a workspace before recording expenses.')
      return
    }

    if (!user) {
      setError('You must be signed in to record expenses.')
      return
    }

    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a valid amount greater than 0.')
      return
    }

    const safeDate = date || new Date().toISOString().slice(0, 10)
    const safeCategory = category.trim() || 'General'

    setIsSaving(true)
    try {
      await addDoc(collection(db, 'expenses'), {
        storeId,
        amount: parsedAmount,
        category: safeCategory,
        expenseDate: safeDate, // stored as YYYY-MM-DD string
        notes: notes.trim() || '',
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // clear only amount + notes, keep date & category for faster entry
      setAmount('')
      setNotes('')
    } catch (err) {
      console.error('[expenses] Failed to save expense', err)
      const message =
        err instanceof Error ? err.message : 'We could not save this expense. Please try again.'
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Expenses</h2>
          <p className="page__subtitle">
            Record rent, salaries, utilities, and other costs so your profit stays accurate.
          </p>
        </div>
        <div className="page__metric">
          <span className="page__metric-label">Total (last 50)</span>
          <span className="page__metric-value">GHS {total.toFixed(2)}</span>
        </div>
      </header>

      {!storeId && (
        <div className="card">
          <p>
            You don&apos;t have an active workspace yet. Finish onboarding or select a store to
            start tracking expenses.
          </p>
        </div>
      )}

      {storeId && (
        <div className="page__grid page__grid--two">
          {/* Form card */}
          <section className="card">
            <h3 className="card__title">Add expense</h3>
            <p className="card__subtitle">
              Capture costs as they happen so your Sedifex reports stay up to date.
            </p>

            {error && (
              <p className="sell-page__message sell-page__message--error" role="alert">
                {error}
              </p>
            )}

            <form
              onSubmit={handleSubmit}
              className="form"
              style={{ display: 'grid', gap: 12, marginTop: 12 }}
            >
              <div className="form__field">
                <label htmlFor="expense-date">Date</label>
                <input
                  id="expense-date"
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  required
                />
              </div>

              <div className="form__field">
                <label htmlFor="expense-category">Category</label>
                <input
                  id="expense-category"
                  type="text"
                  placeholder="Rent, Salary, Utilities, Fuel…"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                />
                <p className="form__hint">If left blank, we&apos;ll use &quot;General&quot;.</p>
              </div>

              <div className="form__field">
                <label htmlFor="expense-amount">Amount (GHS)</label>
                <input
                  id="expense-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  required
                />
              </div>

              <div className="form__field">
                <label htmlFor="expense-notes">Notes</label>
                <textarea
                  id="expense-notes"
                  rows={3}
                  placeholder="Optional: add details like invoice number or payee."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="button button--primary"
                disabled={isSaving || !storeId}
              >
                {isSaving ? 'Saving…' : 'Save expense'}
              </button>
            </form>
          </section>

          {/* List card */}
          <section className="card">
            <h3 className="card__title">Recent expenses</h3>
            <p className="card__subtitle">
              Showing the last 50 expenses recorded for this workspace.
            </p>

            {expenses.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 16 }}>
                <h4 className="empty-state__title">No expenses yet</h4>
                <p>Use the form to record your first cost for this store.</p>
              </div>
            ) : (
              <div className="table-wrapper" style={{ marginTop: 16 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Category</th>
                      <th scope="col" className="sell-page__numeric">
                        Amount (GHS)
                      </th>
                      <th scope="col">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map(expense => (
                      <tr key={expense.id}>
                        <td>{expense.expenseDate}</td>
                        <td>{expense.category}</td>
                        <td className="sell-page__numeric">
                          {Number(expense.amount).toFixed(2)}
                        </td>
                        <td>{expense.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
