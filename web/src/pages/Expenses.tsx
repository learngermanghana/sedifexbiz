// web/src/pages/Expenses.tsx
import React, { useEffect, useState } from 'react'
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'
import { useToast } from '../components/ToastProvider'

type ExpenseRecord = {
  id: string
  storeId: string
  amount: number
  category: string | null
  note: string | null
  date: Timestamp | null
  createdAt: Timestamp | null
}

function formatDate(ts: Timestamp | null) {
  if (!ts) return '—'
  try {
    return ts.toDate().toLocaleDateString()
  } catch {
    return '—'
  }
}

export default function Expenses() {
  const { storeId } = useActiveStore()
  const user = useAuthUser()
  const { publish } = useToast()

  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('General')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => {
    const today = new Date()
    return today.toISOString().slice(0, 10)
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ExpenseRecord[]>([])

  // Load recent expenses for this workspace
  useEffect(() => {
    if (!storeId) {
      setRows([])
      return
    }

    const q = query(
      collection(db, 'expenses'),
      where('storeId', '==', storeId),
      orderBy('date', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(50),
    )

    return onSnapshot(
      q,
      snapshot => {
        const data: ExpenseRecord[] = snapshot.docs.map(docSnap => {
          const d = docSnap.data() as any
          return {
            id: docSnap.id,
            storeId: d.storeId,
            amount: Number(d.amount ?? 0),
            category: typeof d.category === 'string' ? d.category : null,
            note: typeof d.note === 'string' ? d.note : null,
            date: d.date instanceof Timestamp ? d.date : null,
            createdAt: d.createdAt instanceof Timestamp ? d.createdAt : null,
          }
        })
        setRows(data)
      },
      err => {
        console.error('[expenses] Failed to load expenses', err)
        publish({ tone: 'error', message: 'Unable to load expenses.' })
      },
    )
  }, [publish, storeId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!storeId) {
      setError('Select a workspace before recording expenses.')
      return
    }
    if (!user) {
      setError('You must be signed in to record an expense.')
      return
    }

    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a valid amount greater than zero.')
      return
    }

    let expenseDate: Date
    try {
      expenseDate = date ? new Date(date) : new Date()
    } catch {
      expenseDate = new Date()
    }

    setSaving(true)
    try {
      await addDoc(collection(db, 'expenses'), {
        storeId,
        amount: parsedAmount,
        category: category || 'General',
        note: note.trim() || null,
        date: Timestamp.fromDate(expenseDate),
        createdAt: serverTimestamp(),
        createdBy: {
          uid: user.uid,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
        },
      })

      publish({ tone: 'success', message: 'Expense recorded.' })
      setAmount('')
      setNote('')
    } catch (err) {
      console.error('[expenses] Failed to save expense', err)
      setError('We were unable to save this expense. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Expenses</h2>
          <p className="page__subtitle">
            Record daily expenses so your finance view matches your real cash.
          </p>
        </div>
      </header>

      <div className="page__grid">
        <section className="card" aria-labelledby="expense-form-heading">
          <h3 id="expense-form-heading" className="card__title">
            Add expense
          </h3>
          <p className="card__subtitle">
            Log rent, utilities, salaries, or any other business expense.
          </p>

          <form className="form" onSubmit={handleSubmit}>
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
              <select
                id="expense-category"
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                <option value="General">General</option>
                <option value="Rent">Rent</option>
                <option value="Utilities">Utilities</option>
                <option value="Salaries">Salaries</option>
                <option value="Inventory">Inventory purchase</option>
                <option value="Transport">Transport</option>
                <option value="Other">Other</option>
              </select>
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
              <label htmlFor="expense-note">Note (optional)</label>
              <textarea
                id="expense-note"
                rows={3}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Example: Rent for November, staff lunch, delivery fuel…"
              />
            </div>

            {error && (
              <p className="status status--error" role="alert">
                {error}
              </p>
            )}

            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save expense'}
            </button>
          </form>
        </section>

        <section className="card" aria-labelledby="expense-list-heading">
          <h3 id="expense-list-heading" className="card__title">
            Recent expenses
          </h3>
          <p className="card__subtitle">
            Last 50 expenses recorded for this workspace.
          </p>

          {rows.length === 0 ? (
            <div className="empty-state">
              <h4 className="empty-state__title">No expenses yet</h4>
              <p>Start by adding your first expense on the left.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Note</th>
                    <th className="sell-page__numeric">Amount (GHS)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(exp => (
                    <tr key={exp.id}>
                      <td>{formatDate(exp.date)}</td>
                      <td>{exp.category ?? '—'}</td>
                      <td>{exp.note ?? '—'}</td>
                      <td className="sell-page__numeric">
                        {exp.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
