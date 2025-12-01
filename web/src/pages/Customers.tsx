import React, { useEffect, useMemo, useState, useCallback } from 'react'
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
import {
  CUSTOMER_CACHE_LIMIT,
  loadCachedCustomers,
  saveCachedCustomers,
} from '../utils/offlineCache'
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

  // NEW: editable default message template
  const [messageTemplate, setMessageTemplate] = useState(
    'Hi {name}, thanks for shopping with us.',
  )

  // NEW: "Add customer" form state
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [isSavingCustomer, setIsSavingCustomer] = useState(false)
  const [customerFormError, setCustomerFormError] = useState<string | null>(null)
  const [customerFormSuccess, setCustomerFormSuccess] = useState<string | null>(null)

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
  }, [activeStoreId, selectedCustomerId])

  const selectedCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId],
  )

  // ---------- Load sales for selected customer ----------
  useEffect(() => {
    if (!activeStoreId || !selectedCustomerId) {
      setSalesSummary(null)
      return
    }

    setIsLoadingSales(true)
    setSalesError(null)

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

  // ---------- Contact actions (WhatsApp / Telegram / Email) ----------

  const contactMessage = useMemo(() => {
    const template = messageTemplate || ''
    if (!selectedCustomer) {
      // When no customer selected, just strip the {name} placeholder
      return template.replace('{name}', '').trim()
    }
    const name = getCustomerDisplayName(selectedCustomer)
    return template.replace('{name}', name)
  }, [selectedCustomer, messageTemplate])

  const handleWhatsApp = useCallback(() => {
    if (!selectedCustomer || !selectedCustomer.phone) return
    const digits = selectedCustomer.phone.replace(/[^\d]/g, '')
    const encodedText = encodeURIComponent(contactMessage || '')
    const href = digits
      ? `https://wa.me/${digits}?text=${encodedText}`
      : `https://wa.me/?text=${encodedText}`
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [selectedCustomer, contactMessage])

  const handleTelegram = useCallback(() => {
    if (!selectedCustomer || !selectedCustomer.phone) return
    const encodedText = encodeURIComponent(contactMessage || '')
    const href = `https://t.me/share/url?url=&text=${encodedText}`
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [selectedCustomer, contactMessage])

  const handleEmail = useCallback(() => {
    if (!selectedCustomer || !selectedCustomer.email) return
    const subject = 'Thank you for your purchase'
    const body = contactMessage || 'Thank you for your purchase.'
    const mailto = `mailto:${encodeURIComponent(
      selectedCustomer.email,
    )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.location.href = mailto
  }, [selectedCustomer, contactMessage])

  const canWhatsApp = Boolean(selectedCustomer?.phone)
  const canTelegram = Boolean(selectedCustomer?.phone)
  const canEmail = Boolean(selectedCustomer?.email)

  // ---------- Create customer from form ----------

  const handleCreateCustomer: React.FormEventHandler<HTMLFormElement> = async event => {
    event.preventDefault()
    setCustomerFormError(null)
    setCustomerFormSuccess(null)

    const trimmedName = newName.trim()
    const trimmedPhone = newPhone.trim()
    const trimmedEmail = newEmail.trim()
    const trimmedNotes = newNotes.trim()

    if (!activeStoreId) {
      setCustomerFormError('Select a workspace before adding customers.')
      return
    }

    if (!trimmedName && !trimmedPhone && !trimmedEmail) {
      setCustomerFormError('Enter at least a name or a phone or email.')
      return
    }

    try {
      setIsSavingCustomer(true)

      const payload: Record<string, unknown> = {
        storeId: activeStoreId,
        displayName: trimmedName || null,
        name: trimmedName || null,
        phone: trimmedPhone || null,
        email: trimmedEmail || null,
        notes: trimmedNotes || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      const docRef = await addDoc(collection(db, 'customers'), payload)

      // Reset form
      setNewName('')
      setNewPhone('')
      setNewEmail('')
      setNewNotes('')
      setCustomerFormSuccess('Customer added successfully.')
      setSelectedCustomerId(docRef.id)
    } catch (error) {
      console.error('[customers] Failed to create customer', error)
      setCustomerFormError('Unable to save customer. Please try again.')
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
            Add customers, look up profiles, and see how much each person has spent with your store.
          </p>
        </div>
      </header>

      <div className="customers-page__grid">
        {/* Left: Add / edit customer form */}
        <section className="card" aria-label="Add customer">
          <div className="customers-page__section-header">
            <h3 className="card__title">New customer</h3>
            <p className="card__subtitle">
              Save regular shoppers or VIPs so you can track their visits and contact them later.
            </p>
          </div>

          <form className="customers-page__form" onSubmit={handleCreateCustomer}>
            <div className="customers-page__form-row">
              <div className="form__field">
                <label htmlFor="customer-name">Name</label>
                <input
                  id="customer-name"
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Customer name"
                  autoComplete="off"
                />
              </div>
              <div className="form__field">
                <label htmlFor="customer-phone">Phone</label>
                <input
                  id="customer-phone"
                  type="tel"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  placeholder="233 20 123 4567"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="customers-page__form-row">
              <div className="form__field">
                <label htmlFor="customer-email">Email</label>
                <input
                  id="customer-email"
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="customer@example.com"
                  autoComplete="off"
                />
              </div>
              <div className="form__field">
                <label htmlFor="customer-notes">Notes (optional)</label>
                <input
                  id="customer-notes"
                  type="text"
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  placeholder="Birthday, preferences, VIP, etc."
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="customers-page__form-actions">
              <button
                type="submit"
                className="button button--primary button--small"
                disabled={isSavingCustomer}
              >
                {isSavingCustomer ? 'Saving…' : 'Add customer'}
              </button>
              {customerFormError && (
                <p className="customers-page__message customers-page__message--error">
                  {customerFormError}
                </p>
              )}
              {customerFormSuccess && (
                <p className="customers-page__message customers-page__message--success">
                  {customerFormSuccess}
                </p>
              )}
            </div>

            <p className="customers-page__message" style={{ fontSize: 12, color: '#64748b' }}>
              You can also attach a customer to a sale directly on the Sell page — both routes
              use the same customer list.
            </p>
          </form>
        </section>

        {/* Middle: customer list */}
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
              <Link to="/sell" className="button button--ghost button--small">
                Go to Sell
              </Link>
              <Link to="/products" className="button button--ghost button--small">
                View products
              </Link>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="table" aria-label="Customers table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Contact</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.length ? (
                  filteredCustomers.map(c => {
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
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={2}>
                      <div className="customers-page__details-empty">
                        <p>No customers found.</p>
                        <p>
                          Add customers using the form on the left or from the Sell page.
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
              </dl>

              {/* Contact actions + editable message */}
              <div className="customers-page__details-actions">
                <div
                  className="customers-page__contact-actions"
                  aria-label="Contact customer actions"
                >
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={handleWhatsApp}
                    disabled={!canWhatsApp}
                    title={
                      canWhatsApp
                        ? 'Send a WhatsApp message'
                        : 'Add a phone number to contact via WhatsApp'
                    }
                  >
                    WhatsApp message
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={handleTelegram}
                    disabled={!canTelegram}
                    title={
                      canTelegram
                        ? 'Send a Telegram message'
                        : 'Add a phone number to contact via Telegram'
                    }
                  >
                    Telegram message
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={handleEmail}
                    disabled={!canEmail}
                    title={
                      canEmail
                        ? 'Send an email'
                        : 'Add an email address to contact this customer'
                    }
                  >
                    Email
                  </button>
                </div>
              </div>

              <div className="customers-page__details-actions" style={{ marginTop: 8 }}>
                <div className="customers-page__message-template">
                  <label className="field__label" htmlFor="customer-message-template">
                    Default message
                  </label>
                  <textarea
                    id="customer-message-template"
                    className="customers-page__message-template-input"
                    rows={3}
                    value={messageTemplate}
                    onChange={e => setMessageTemplate(e.target.value)}
                    placeholder="Hi {name}, thanks for shopping with us."
                  />
                  <p className="field__hint">
                    Use <code>{'{name}'}</code> to insert the customer&apos;s name
                    automatically.
                  </p>
                </div>
              </div>

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
                              GHS {(salesSummary.lastSaleTotal ?? 0).toFixed(2)}
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
                  View expenses
                </Link>
              </div>
            </div>
          ) : (
            <div className="customers-page__details-empty">
              <h3>Select a customer</h3>
              <p>
                Choose someone from the list to view their profile and purchase history.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
