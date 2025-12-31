// web/src/pages/Expenses.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useAuthUser } from '../hooks/useAuthUser'

type Expense = {
  id: string
  storeId: string
  amount: number
  category: string
  description: string
  date: string // yyyy-mm-dd
  createdAt?: unknown
}

const CATEGORIES = [
  'Rent',
  'Salaries & wages',
  'Utilities',
  'Supplies',
  'Transport',
  'Marketing',
  'Loan repayment',
  'Miscellaneous',
] as const

type ExpensesProps = {
  embedded?: boolean
}

export default function Expenses({ embedded = false }: ExpensesProps) {
  const { storeId } = useActiveStore()
  const user = useAuthUser()

  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const activityActor = user?.displayName || user?.email || 'Team member'

  const [expenses, setExpenses] = useState<Expense[]>([])

  function currentMonthKey(dateValue: Date) {
    const year = dateValue.getFullYear()
    const month = String(dateValue.getMonth() + 1).padStart(2, '0')
    return `${year}-${month}`
  }

  // Load expenses for this store
  useEffect(() => {
    if (!storeId) {
      setExpenses([])
      return
    }

    const q = query(
      collection(db, 'expenses'),
      where('storeId', '==', storeId),
      orderBy('date', 'desc'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: Expense[] = snap.docs.map(docSnap => {
        const data = docSnap.data() as any
        return {
          id: docSnap.id,
          storeId: data.storeId,
          amount: Number(data.amount) || 0,
          category: data.category || 'Uncategorized',
          description: data.description || '',
          date: data.date || '',
          createdAt: data.createdAt,
        }
      })
      setExpenses(rows)
    })

    return unsubscribe
  }, [storeId])

  const totalMonthly = useMemo(() => {
    if (!expenses.length) return 0
    const currentMonth = currentMonthKey(new Date())
    return expenses
      .filter(exp => exp.date?.startsWith(currentMonth))
      .reduce((sum, exp) => sum + exp.amount, 0)
  }, [expenses])

  const totalAllTime = useMemo(
    () => expenses.reduce((sum, exp) => sum + exp.amount, 0),
    [expenses],
  )

  const isFormValid =
    !!storeId &&
    !!user &&
    amount.trim() !== '' &&
    Number(amount) > 0 &&
    date.trim() !== '' &&
    category.trim() !== ''

  async function logExpenseActivity(amountValue: number) {
    if (!storeId) return

    try {
      await addDoc(collection(db, 'activity'), {
        storeId,
        type: 'expense',
        summary: `Recorded expense of GHS ${amountValue.toFixed(2)}`,
        detail: `${category} · ${description.trim() || 'No notes added'}`,
        actor: activityActor,
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      console.warn('[activity] Failed to log expense', err)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!storeId) {
      setError('You need an active workspace to record expenses.')
      setSuccess(null)
      return
    }
    if (!user) {
      setError('You must be signed in to record expenses.')
      setSuccess(null)
      return
    }
    if (!isFormValid) return

    setIsSaving(true)
    setError(null)
    setSuccess(null)

    try {
      await addDoc(collection(db, 'expenses'), {
        storeId,
        amount: Number(amount),
        category,
        description: description.trim(),
        date,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      })

      await logExpenseActivity(Number(amount))

      // clear form (keep date & category to make multiple entries easier)
      setAmount('')
      setDescription('')

      // show success message
      setSuccess('Expense saved. You can see it in the history below.')
    } catch (err) {
      console.error('[expenses] Failed to save expense', err)
      setError('We could not save this expense. Please try again.')
      setSuccess(null)
    } finally {
      setIsSaving(false)
    }
  }

  const content = (
    <>
      {/* Entry form */}
      <section className="card" aria-label="Add expense">
        <h3 className="card__title">Add expense</h3>
        <p className="card__subtitle">
          Capture expenses for this Sedifex workspace. Amounts are stored in your POS currency.
        </p>

        {!storeId && (
          <p className="status status--error" role="alert">
            Switch to a workspace before adding expenses.
          </p>
        )}

        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        {success && (
          <p className="status status--success" role="status">
            {success}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="form"
          style={{ display: 'grid', gap: 12, maxWidth: 480 }}
        >
          <div className="form__field">
            <label htmlFor="expense-amount">Amount</label>
            <input
              id="expense-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
            />
            <p className="form__hint">Enter the total cost for this expense.</p>
          </div>

          <div className="form__field">
            <label htmlFor="expense-category">Category</label>
            <select
              id="expense-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <p className="form__hint">Use categories to understand where money is going.</p>
          </div>

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
            <label htmlFor="expense-description">Notes (optional)</label>
            <textarea
              id="expense-description"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Eg. March rent for East Legon store"
            />
          </div>

          <button
            type="submit"
            className="button button--primary"
            disabled={!isFormValid || isSaving}
          >
            {isSaving ? 'Saving…' : 'Save expense'}
          </button>
        </form>
      </section>

      {/* Summary + list */}
      <section className="card" style={{ marginTop: 24 }}>
        <div className="page__header" style={{ padding: 0, marginBottom: 12 }}>
          <div>
            <h3 className="card__title">Expense history</h3>
            <p className="card__subtitle">
              This list updates in real time for your current workspace.
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="card__subtitle">
              This month: <strong>GHS {totalMonthly.toFixed(2)}</strong>
            </p>
            <p className="card__subtitle">
              All time: <strong>GHS {totalAllTime.toFixed(2)}</strong>
            </p>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div className="empty-state">
            <h4 className="empty-state__title">No expenses yet</h4>
            <p>Add your first expense above to start tracking store costs.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th className="sell-page__numeric">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <tr key={exp.id}>
                    <td>{exp.date}</td>
                    <td>{exp.category}</td>
                    <td>{exp.description || '—'}</td>
                    <td className="sell-page__numeric">
                      GHS {exp.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )

  if (embedded) {
    return (
      <section className="card" style={{ marginTop: 24 }} aria-label="Expenses">
        <div className="page__header" style={{ padding: 0, marginBottom: 12 }}>
          <div>
            <h3 className="card__title">Expenses</h3>
            <p className="card__subtitle">
              Add and review expenses here without leaving Finance.
            </p>
          </div>
        </div>
        {content}
      </section>
    )
  }

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
      {content}
    </div>
  )
}
