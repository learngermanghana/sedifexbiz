import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { CUSTOMER_CACHE_LIMIT, loadCachedCustomers, saveCachedCustomers } from '../utils/offlineCache'
import { ensureCustomerLoyalty } from '../utils/customerLoyalty'
import './Customers.css'

type Customer = {
  id: string
  name: string
  displayName?: string
  phone?: string
  email?: string
  notes?: string
  loyalty?: any
  createdAt?: any
  updatedAt?: any
}

type CustomerSale = {
  id: string
  total: number
  taxTotal: number
  createdAt: Date | null
  items: Array<{
    productId: string
    name: string
    price: number
    qty: number
    taxRate?: number
  }>
  payment: {
    method?: string
    amountPaid?: number
    changeDue?: number
    [key: string]: any
  } | null
}

type CustomerSalesSummary = {
  totalSalesAmount: number
  saleCount: number
  lastSaleAt: Date | null
  lastSaleTotal: number | null
  recentSales: CustomerSale[]
}

function getCustomerPrimaryName(customer: Pick<Customer, 'displayName' | 'name'>): string {
  const displayName = customer.displayName?.trim()
  if (displayName) return displayName
  const legacyName = customer.name?.trim()
  if (legacyName) return legacyName
  return ''
}

function getCustomerFallbackContact(customer: Pick<Customer, 'email' | 'phone'>): string {
  const email = customer.email?.trim()
  if (email) return email
  const phone = customer.phone?.trim()
  if (phone) return phone
  return ''
}

function getCustomerSortKey(
  customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>,
): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) return primary
  return getCustomerFallbackContact(customer)
}

function getCustomerDisplayName(
  customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>,
): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) return primary
  const fallback = getCustomerFallbackContact(customer)
  if (fallback) return fallback
  return '—'
}

export default function Customers() {
  const { storeId: activeStoreId } = useActiveStore()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [queryText, setQueryText] = useState('')

  const [salesSummary, setSalesSummary] = useState<CustomerSalesSummary | null>(null)
  const [isLoadingSales, setIsLoadingSales] = useState(false)
  const [salesError, setSalesError] = useState<string | null>(null)

  // NEW: add-customer UI state
  const [isAddingCustomer, setIsAddingCustomer] = useState(false)
  const [isSavingCustomer, setIsSavingCustomer] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [newCustomer, setNewCustomer] = useState({
    displayName: '',
    phone: '',
    email: '',
    notes: '',
  })

  // ---------- Load customers ----------
  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setCustomers([])
      setSelectedCustomerId('')
      return () => {
        cancelled = true
      }
    }

    // 1) Load cached customers for fast first paint
    loadCachedCustomers<Customer>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          const normalized = cached.map(customer => ensureCustomerLoyalty(customer))
          setCustomers(
            [...normalized].sort((a, b) =>
              getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
                sensitivity: 'base',
              }),
            ),
          )
        }
      })
      .catch(error => {
        console.warn('[customers] Failed to load cached customers', error)
      })

    // 2) Live snapshot from Firestore
    const qCustomers = query(
      collection(db, 'customers'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(qCustomers, snap => {
      const rows = snap.docs.map(docSnap =>
        ensureCustomerLoyalty({ id: docSnap.id, ...(docSnap.data() as Customer) }),
      )
      saveCachedCustomers(rows, { storeId: activeStoreId }).catch(error => {
        console.warn('[customers] Failed to cache customers', error)
      })
      const sortedRows = [...rows].sort((a, b) =>
        getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
          sensitivity: 'base',
        }),
      )
      setCustomers(sortedRows)

      // If nothing selected yet, auto-select first customer
      if (!selectedCustomerId && sortedRows.length) {
        setSelectedCustomerId(sortedRows[0].id)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId],
  )

  const selectedCustomerLoyalty = useMemo(
    () => (selectedCustomer ? ensureCustomerLoyalty(selectedCustomer).loyalty : null),
    [selectedCustomer],
  )

  // ---------- Load sales for selected customer ----------
  useEffect(() => {
    if (!activeStoreId || !selectedCustomerId) {
      setSalesSummary(null)
      return
    }

    setIsLoadingSales(true)
    setSalesError(null)

    // We query sales by store + nested customer.id
    // commitSale writes: { storeId, total, customer: { id, ... } }
    const qSales = query(
      collection(db, 'sales'),
      where('storeId', '==', activeStoreId),
      where('customer.id', '==', selectedCustomerId),
      orderBy('createdAt', 'desc'),
      limit(50),
    )

    const unsubscribe = onSnapshot(
      qSales,
      snap => {
        const docs = snap.docs.map(d => {
          const raw = d.data() as DocumentData
          const createdAtField = raw.createdAt
          const createdAt =
            createdAtField && typeof createdAtField.toDate === 'function'
              ? createdAtField.toDate()
              : null

          const total = typeof raw.total === 'number' ? raw.total : 0
          const taxTotal = typeof raw.taxTotal === 'number' ? raw.taxTotal : 0

          return {
            id: d.id,
            total,
            taxTotal,
            createdAt,
            items: Array.isArray(raw.items) ? raw.items : [],
            payment: raw.payment ?? null,
          } as CustomerSale
        })

        const totalSalesAmount = docs.reduce((sum, sale) => sum + sale.total, 0)
        const saleCount = docs.length
        const lastSale = docs[0] || null
        const lastSaleAt = lastSale?.createdAt ?? null
        const lastSaleTotal = lastSale ? lastSale.total : null

        setSalesSummary({
          totalSalesAmount,
          saleCount,
          lastSaleAt,
          lastSaleTotal,
          recentSales: docs,
        })
        setIsLoadingSales(false)
      },
      error => {
        console.error('[customers] Failed to load customer sales', error)
        setSalesError('Unable to load sales for this customer.')
        setIsLoadingSales(false)
      },
    )

    return () => {
      unsubscribe()
    }
  }, [activeStoreId, selectedCustomerId])

  const filteredCustomers = useMemo(() => {
    if (!queryText.trim()) return customers
    const q = queryText.toLowerCase()
    return customers.filter(c => {
      const name = getCustomerDisplayName(c).toLowerCase()
      const phone = (c.phone || '').toLowerCase()
      const email = (c.email || '').toLowerCase()
      return name.includes(q) || phone.includes(q) || email.includes(q)
    })
  }, [customers, queryText])

  // ---------- Create customer ----------
  async function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault()
    if (!activeStoreId) {
      setAddError('No active store selected.')
      return
    }

    const displayName = newCustomer.displayName.trim()
    const phone = newCustomer.phone.trim()
    const email = newCustomer.email.trim()
    const notes = newCustomer.notes.trim()

    if (!displayName) {
      setAddError('Customer name is required.')
      return
    }

    try {
      setIsSavingCustomer(true)
      setAddError(null)

      await addDoc(collection(db, 'customers'), {
        storeId: activeStoreId,
        displayName,
        phone: phone || null,
        email: email || null,
        notes: notes || '',
        loyalty: { points: 0 },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Reset form; snapshot listener will pull in the new customer
      setNewCustomer({ displayName: '', phone: '', email: '', notes: '' })
      setIsAddingCustomer(false)
    } catch (error) {
      console.error('[customers] Failed to create customer', error)
      setAddError('Unable to save customer. Please try again.')
    } finally {
      setIsSavingCustomer(false)
    }
  }

  return (
    <div className="page customers-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Customers</h2>
          <p className="page__subtitle">
            Look up customers, view their purchase history, and track loyalty points.
          </p>
        </div>
      </header>

      <div className="customers-page__grid">
        {/* Left: customer list */}
        <section className="card" aria-label="Customer list">
          <div className="customers-page__section-header">
            <h3 className="card__title">Customers</h3>
            <p className="card__subtitle">
              {customers.length ? `${customers.length} customers` : 'No customers yet.'}
            </p>
          </div>

          <div className="customers-page__toolbar">
            <div className="customers-page__search-field">
              <input
                placeholder="Search by name, phone, or email"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
              />
            </div>
            <div className="customers-page__tool-buttons">
              {/* NEW: Add customer button */}
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => {
                  setIsAddingCustomer(prev => !prev)
                  setAddError(null)
                }}
                disabled={!activeStoreId}
              >
                {isAddingCustomer ? 'Cancel' : 'Add customer'}
              </button>

              <Link to="/sell" className="button button--ghost button--small">
                Go to Sell
              </Link>
              <Link to="/products" className="button button--ghost button--small">
                View products
              </Link>
            </div>
          </div>

          {/* NEW: Inline add-customer form */}
          {isAddingCustomer && (
            <form
              className="customers-page__add-form"
              onSubmit={handleCreateCustomer}
              aria-label="Add customer"
            >
              <div className="customers-page__add-form-grid">
                <label>
                  <span>Name</span>
                  <input
                    required
                    placeholder="Customer name"
                    value={newCustomer.displayName}
                    onChange={e =>
                      setNewCustomer(prev => ({ ...prev, displayName: e.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Phone</span>
                  <input
                    placeholder="Phone number"
                    value={newCustomer.phone}
                    onChange={e =>
                      setNewCustomer(prev => ({ ...prev, phone: e.target.value }))
                    }
                  />
                </label>

                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    placeholder="Email address"
                    value={newCustomer.email}
                    onChange={e =>
                      setNewCustomer(prev => ({ ...prev, email: e.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="customers-page__add-form-notes">
                <span>Notes</span>
                <textarea
                  rows={2}
                  placeholder="Optional notes"
                  value={newCustomer.notes}
                  onChange={e =>
                    setNewCustomer(prev => ({ ...prev, notes: e.target.value }))
                  }
                />
              </label>

              {addError && (
                <p className="customers-page__message customers-page__message--error">
                  {addError}
                </p>
              )}

              <div className="customers-page__add-form-actions">
                <button
                  type="submit"
                  className="button button--primary button--small"
                  disabled={isSavingCustomer}
                >
                  {isSavingCustomer ? 'Saving…' : 'Save customer'}
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => {
                    setIsAddingCustomer(false)
                    setAddError(null)
                  }}
                  disabled={isSavingCustomer}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="table-wrapper">
            <table className="table" aria-label="Customers table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.length ? (
                  filteredCustomers.map(c => {
                    const loyalty = ensureCustomerLoyalty(c).loyalty
                    const points = loyalty?.points ?? 0
                    const isSelected = c.id === selectedCustomerId

                    return (
                      <tr
                        key={c.id}
                        className={
                          'customers-page__row' +
                          (isSelected ? ' customers-page__row--selected' : '')
                        }
                        onClick={() => setSelectedCustomerId(c.id)}
                      >
                        <td>
                          <div>{getCustomerDisplayName(c)}</div>
                          {c.notes && (
                            <div className="table__secondary">{c.notes}</div>
                          )}
                        </td>
                        <td>
                          <div>{c.phone || '—'}</div>
                          <div className="table__secondary">{c.email || ''}</div>
                        </td>
                        <td>
                          <span className="customers-page__badge">
                            {points.toFixed(0)} pts
                          </span>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={3}>
                      <div className="customers-page__details-empty">
                        <p>No customers found.</p>
                        <p>
                          Add customers from the Sell page, or use the “Add customer” button
                          above to create one here.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Right: details & sales summary */}
        <section className="card customers-page__details" aria-label="Customer details">
          {selectedCustomer ? (
            <div className="customers-page__details-content">
              <div className="customers-page__section-header">
                <h3 className="card__title">{getCustomerDisplayName(selectedCustomer)}</h3>
                <p className="card__subtitle">Profile &amp; purchase history</p>
              </div>

              <dl className="customers-page__detail-list">
                <div>
                  <dt>Phone</dt>
                  <dd>{selectedCustomer.phone || '—'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selectedCustomer.email || '—'}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>{selectedCustomer.notes || '—'}</dd>
                </div>
                <div>
                  <dt>Loyalty points</dt>
                  <dd>
                    {(selectedCustomerLoyalty?.points ?? 0).toFixed(0)} pts
                  </dd>
                </div>
              </dl>

              <section className="customers-page__history" aria-label="Sales history">
                <h4>Sales summary</h4>

                {isLoadingSales && <p>Loading sales…</p>}
                {salesError && (
                  <p className="customers-page__message customers-page__message--error">
                    {salesError}
                  </p>
                )}

                {!isLoadingSales && !salesError && (
                  <>
                    <ul>
                      <li>
                        <div className="customers-page__history-row">
                          <span className="customers-page__history-primary">Total spent</span>
                          <span className="customers-page__history-total">
                            GHS{' '}
                            {salesSummary
                              ? salesSummary.totalSalesAmount.toFixed(2)
                              : '0.00'}
                          </span>
                        </div>
                        <div className="customers-page__history-meta">
                          {salesSummary?.saleCount
                            ? `${salesSummary.saleCount} sale${
                                salesSummary.saleCount === 1 ? '' : 's'
                              }`
                            : 'No sales yet'}
                        </div>
                      </li>

                      {salesSummary?.lastSaleAt && (
                        <li>
                          <div className="customers-page__history-row">
                            <span className="customers-page__history-primary">
                              Last purchase
                            </span>
                            <span className="customers-page__history-total">
                              GHS{' '}
                              {(salesSummary.lastSaleTotal ?? 0).toFixed(2)}
                            </span>
                          </div>
                          <div className="customers-page__history-meta">
                            {salesSummary.lastSaleAt.toLocaleString()}
                          </div>
                        </li>
                      )}
                    </ul>

                    <h4>Recent sales</h4>
                    {salesSummary?.recentSales.length ? (
                      <ul>
                        {salesSummary.recentSales.map(sale => (
                          <li key={sale.id}>
                            <div className="customers-page__history-row">
                              <span className="customers-page__history-primary">
                                Sale #{sale.id.slice(0, 8)}
                              </span>
                              <span className="customers-page__history-total">
                                GHS {sale.total.toFixed(2)}
                              </span>
                            </div>
                            <div className="customers-page__history-meta">
                              {sale.createdAt
                                ? sale.createdAt.toLocaleString()
                                : 'Unknown date'}
                              {sale.payment?.method && (
                                <> • Paid via {sale.payment.method}</>
                              )}
                            </div>
                            {sale.items?.length ? (
                              <div className="customers-page__history-items">
                                {sale.items.slice(0, 4).map(item => (
                                  <span key={item.productId}>
                                    {item.qty} × {item.name}
                                  </span>
                                ))}
                                {sale.items.length > 4 && (
                                  <span>+ {sale.items.length - 4} more…</span>
                                )}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="customers-page__history-meta">
                        No sales recorded for this customer yet.
                      </p>
                    )}
                  </>
                )}
              </section>

              <div className="customers-page__details-actions">
                <Link to="/sell" className="button button--primary button--small">
                  Start new sale
                </Link>
                <Link to="/finance" className="button button--ghost button--small">
                  View reports
                </Link>
              </div>
            </div>
          ) : (
            <div className="customers-page__details-empty">
              <h3>Select a customer</h3>
              <p>
                Choose someone from the list to view their profile, loyalty points, and
                purchase history.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
