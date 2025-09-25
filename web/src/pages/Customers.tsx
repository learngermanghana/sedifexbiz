import React, { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { Timestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { auth, db } from '../firebase'
import './Customers.css'

type Customer = {
  id: string
  name: string
  phone?: string
  email?: string
  notes?: string
  createdAt?: Timestamp | null
}

export default function Customers() {
  const user = auth.currentUser
  const STORE_ID = useMemo(() => user?.uid || null, [user?.uid])

  const [customers, setCustomers] = useState<Customer[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', STORE_ID),
      orderBy('name')
    )
    return onSnapshot(q, snap => {
      const rows = snap.docs.map(docSnap => {
        const data = docSnap.data() as Omit<Customer, 'id'>
        return {
          id: docSnap.id,
          ...data,
        }
      })
      setCustomers(rows)
    })
  }, [STORE_ID])

  async function addCustomer(event: React.FormEvent) {
    event.preventDefault()
    if (!STORE_ID) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Customer name is required to save a record.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addDoc(collection(db, 'customers'), {
        storeId: STORE_ID,
        name: trimmedName,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        createdAt: serverTimestamp(),
      })
      setName('')
      setPhone('')
      setEmail('')
      setNotes('')
    } catch (err) {
      console.error('[customers] Unable to save customer', err)
      setError('We could not save this customer. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function removeCustomer(id: string) {
    if (!id) return
    const confirmation = window.confirm('Remove this customer?')
    if (!confirmation) return
    setBusy(true)
    try {
      await deleteDoc(doc(db, 'customers', id))
    } catch (err) {
      console.error('[customers] Unable to delete customer', err)
      setError('Unable to delete this customer right now.')
    } finally {
      setBusy(false)
    }
  }

  if (!STORE_ID) {
    return <div>Loading…</div>
  }

  return (
    <div className="page customers-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Customers</h2>
          <p className="page__subtitle">
            Keep a tidy record of your regulars and speed up checkout on the sales floor.
          </p>
        </div>
        <span className="customers-page__badge" aria-live="polite">
          {customers.length} saved
        </span>
      </header>

      <div className="customers-page__grid">
        <section className="card" aria-label="Add a customer">
          <div className="customers-page__section-header">
            <h3 className="card__title">New customer</h3>
            <p className="card__subtitle">Capture contact details so you can reuse them during checkout.</p>
          </div>

          <form className="customers-page__form" onSubmit={addCustomer}>
            <div className="field">
              <label className="field__label" htmlFor="customer-name">Full name</label>
              <input
                id="customer-name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. Ama Mensah"
                disabled={busy}
                required
              />
            </div>

            <div className="customers-page__form-row">
              <div className="field">
                <label className="field__label" htmlFor="customer-phone">Phone</label>
                <input
                  id="customer-phone"
                  value={phone}
                  onChange={event => setPhone(event.target.value)}
                  placeholder="024 000 0000"
                  disabled={busy}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="customer-email">Email</label>
                <input
                  id="customer-email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="ama@example.com"
                  disabled={busy}
                  type="email"
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="customer-notes">Notes</label>
              <textarea
                id="customer-notes"
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Birthday reminders, delivery addresses, favourite products…"
                rows={3}
                disabled={busy}
              />
            </div>

            {error && <p className="customers-page__message customers-page__message--error">{error}</p>}

            <button type="submit" className="button button--primary" disabled={busy}>
              Save customer
            </button>
          </form>

          <p className="field__hint">
            Customers saved here appear in the checkout flow. Visit the <Link to="/sell">Sell page</Link> to try it out.
          </p>
        </section>

        <section className="card" aria-label="Saved customers">
          <div className="customers-page__section-header">
            <h3 className="card__title">Customer list</h3>
            <p className="card__subtitle">
              Stay organised and keep sales staff informed with up-to-date contact information.
            </p>
          </div>

          {customers.length ? (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Notes</th>
                    <th scope="col">Created</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(customer => {
                    const createdAt = customer.createdAt?.toDate?.() ?? null
                    const contactBits = [customer.phone, customer.email].filter(Boolean).join(' • ')
                    return (
                      <tr key={customer.id}>
                        <td>{customer.name}</td>
                        <td>{contactBits || '—'}</td>
                        <td>{customer.notes || '—'}</td>
                        <td>{createdAt ? createdAt.toLocaleString() : '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="button button--danger button--small"
                            onClick={() => removeCustomer(customer.id)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3 className="empty-state__title">No customers saved yet</h3>
              <p>Add your first customer using the form and they will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
