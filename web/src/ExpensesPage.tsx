import React, { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  orderBy,
  query,
  where,
  Timestamp,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'

type Expense = {
  id: string
  category: string
  amount: number
  paymentMethod: string
  note: string | null
  createdAt: Timestamp | null
  createdByName: string | null
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export default function ExpensesPage() {
  const user = useAuthUser()
  const { storeId: activeStoreId } = useActiveStore()

  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mobile-money' | 'card' | 'other'>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [expenses, setExpenses] = useState<Expense[]>([])

  const businessDate = useMemo(() => startOfToday(), [])
  const businessDateTs = useMemo(() => Timestamp.fromDate(businessDate), [businessDate])

  useEffect(() => {
    if (!activeStoreId) {
      setExpenses([])
      return
    }

    const q = query(
      collection(db, 'expenses'),
      where('storeId', '==', activeStoreId),
      where('businessDate', '==', businessDateTs),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows: Expense[] = snap.docs.map(d => {
        const data = d.data() as any
        return {
          id: d.id,
          category: typeof data.category === 'string' ? data.category : '',
          amount: typeof data.amount === 'number' ? data.amount : 0,
          paymentMethod:
            typeof data.paymentMethod === 'string' ? data.paymentMethod : '',
          note: typeof data.note === 'string' && data.note.trim()
            ? data.note.trim()
            : null,
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
          createdByName:
            typeof data.createdByName === 'string' ? data.createdByName : null,
        }
      })
      setExpenses(rows)
    })

    return () => unsubscribe()
  }, [activeStoreId, businessDateTs])

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, row) => sum + row.amount, 0),
    [expenses],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!activeStoreId) {
      setError('Select a workspace before adding an expense.')
      return
    }
    if (!user) {
      setError('You must be signed in to record an expense.')
      return
    }

    const sanitizedCategory = category.trim()
    const value = Number.parseFloat(amount)
    const amountValue = Number.isFinite(value) && value > 0 ? value : 0

    if (!sanitizedCategory) {
      setError('Enter what this expense is for (e.g. fuel, food, repairs).')
      return
    }
    if (amountValue <= 0) {
      setError('Enter an amount greater than 0.')
      return
    }

    setIsSaving(true)
    try {
      await addDoc(collection(db, 'expenses'), {
        storeId: activeStoreId,
        businessDate: businessDateTs,
        category: sanitizedCategory,
        amount: amountValue,
        paymentMethod,
        note: note.trim() || null,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || null,
        createdAt: serverTimestamp(),
      })

      setCategory('')
      setAmount('')
      setPaymentMethod('cash')
      setNote('')
      setSuccess('Expense saved.')
    } catch (err) {
      console.error('[expenses] Failed to save expense', err)
      setError('We were unable to save this expense. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="card finance-expenses">
      <div className="sell-page__section-header">
        <h3 className="card__title">Expenses</h3>
        <p className="card__subtitle">
          Record fuel, airtime, small purchases, and other daily expenses.
        </p>
      </div>

      <form className="finance-expenses__form" onSubmit={handleSubmit}>
        <div className="finance-expenses__grid">
          <div className="form__field">
            <label htmlFor="expense-category">What was this for?</label>
            <input
              id="expense-category"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="Fuel, lunch, repairs, etc."
            />
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
              placeholder="0.00"
            />
          </div>

          <div className="form__field">
            <label htmlFor="expense-method">Paid with</label>
            <select
              id="expense-method"
              value={paymentMethod}
              onChange={e =>
                setPaymentMethod(e.target.value as typeof paymentMethod)
              }
            >
              <option value="cash">Cash</option>
              <option value="mobile-money">Mobile money</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="form__field">
          <label htmlFor="expense-note">Notes (optional)</label>
          <textarea
            id="expense-note"
            rows={3}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add any extra context for this expense."
          />
        </div>

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

        <button
          type="submit"
          className="button button--primary"
          disabled={isSaving}
        >
          {isSaving ? 'Saving…' : 'Add expense'}
        </button>
      </form>

      <section className="finance-expenses__list">
        <header className="finance-expenses__list-header">
          <h4>Today&apos;s expenses</h4>
          <span>Total: GHS {totalExpenses.toFixed(2)}</span>
        </header>

        {expenses.length === 0 ? (
          <p className="finance-expenses__empty">
            No expenses recorded yet for today.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Category</th>
                  <th>Amount (GHS)</th>
                  <th>Method</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <tr key={exp.id}>
                    <td>
                      {exp.createdAt
                        ? exp.createdAt.toDate().toLocaleTimeString()
                        : '—'}
                    </td>
                    <td>{exp.category}</td>
                    <td>{exp.amount.toFixed(2)}</td>
                    <td>{exp.paymentMethod}</td>
                    <td>{exp.createdByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
