import React, { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { CUSTOMER_CACHE_LIMIT, loadCachedCustomers, saveCachedCustomers } from '../utils/offlineCache'
import './BulkMessaging.css'

type Customer = {
  id: string
  name?: string
  displayName?: string
  phone?: string
  email?: string
  tags?: string[]
  updatedAt?: unknown
  createdAt?: unknown
}

type BulkMessageChannel = 'sms'

type BulkMessageRecipient = {
  id?: string
  name?: string
  phone?: string
}

type BulkMessagePayload = {
  storeId: string
  channel: BulkMessageChannel
  message: string
  recipients: BulkMessageRecipient[]
}

type BulkMessageResult = {
  ok: boolean
  attempted: number
  sent: number
  failures: { phone: string; error: string }[]
}

type BulkCreditsCheckoutPayload = {
  storeId: string
  package: string
}

type BulkCreditsCheckoutResult = {
  ok: boolean
  authorizationUrl?: string | null
  reference?: string | null
}

type StatusTone = 'success' | 'error' | 'info'

type StatusMessage = {
  tone: StatusTone
  message: string
}

type CreditsPackage = {
  id: string
  credits: number
  price: number
  label: string
}

const MESSAGE_LIMIT = 1000
const SMS_SEGMENT_SIZE = 160
const CREDITS_PER_SMS = 12
const BULK_CREDITS_PACKAGES: CreditsPackage[] = [
  { id: '10000', credits: 10000, price: 50, label: 'Starter' },
  { id: '50000', credits: 50000, price: 230, label: 'Growth' },
  { id: '100000', credits: 100000, price: 430, label: 'Scale' },
]
const SMS_PRICE_ESTIMATE_GHS =
  BULK_CREDITS_PACKAGES[0].price / (BULK_CREDITS_PACKAGES[0].credits / CREDITS_PER_SMS)
const formatNumber = (value: number) => value.toLocaleString('en-GH')
const formatPrice = (value: number) =>
  value.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function getCustomerPrimaryName(customer: Pick<Customer, 'displayName' | 'name'>): string {
  const displayName = customer.displayName?.trim()
  if (displayName) return displayName
  const legacyName = customer.name?.trim()
  if (legacyName) return legacyName
  return ''
}

function getCustomerDisplayName(customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) return primary
  const email = customer.email?.trim()
  if (email) return email
  const phone = customer.phone?.trim()
  if (phone) return phone
  return 'Unknown customer'
}

function formatPhone(value?: string) {
  if (!value) return '—'
  return value.replace(/^\+/, '+')
}

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase()
}

export default function BulkMessaging() {
  const { storeId } = useActiveStore()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const channel: BulkMessageChannel = 'sms'
  const [message, setMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number>(0)
  const [creditLoading, setCreditLoading] = useState(true)
  const [buyingPackageId, setBuyingPackageId] = useState<string | null>(null)
  const [buyStatus, setBuyStatus] = useState<StatusMessage | null>(null)

  const sendBulkMessage = useMemo(
    () => httpsCallable<BulkMessagePayload, BulkMessageResult>(functions, 'sendBulkMessage'),
    [],
  )

  const createBulkCreditsCheckout = useMemo(
    () =>
      httpsCallable<BulkCreditsCheckoutPayload, BulkCreditsCheckoutResult>(
        functions,
        'createBulkCreditsCheckout',
      ),
    [],
  )

  useEffect(() => {
    let cancelled = false

    if (!storeId) {
      setCustomers([])
      setSelectedIds(new Set())
      setCreditBalance(0)
      setCreditLoading(false)
      return () => {
        cancelled = true
      }
    }

    loadCachedCustomers<Customer>({ storeId })
      .then(cached => {
        if (!cancelled && cached.length) {
          setCustomers(
            [...cached].sort((a, b) =>
              getCustomerDisplayName(a).localeCompare(getCustomerDisplayName(b), undefined, {
                sensitivity: 'base',
              }),
            ),
          )
        }
      })
      .catch(error => {
        console.warn('[bulk-messaging] Failed to load cached customers', error)
      })

    const customerQuery = query(
      collection(db, 'customers'),
      where('storeId', '==', storeId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(customerQuery, snap => {
      const rows = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Customer, 'id'>),
      }))

      saveCachedCustomers(rows, { storeId }).catch(error => {
        console.warn('[bulk-messaging] Failed to cache customers', error)
      })

      setCustomers(
        [...rows].sort((a, b) =>
          getCustomerDisplayName(a).localeCompare(getCustomerDisplayName(b), undefined, {
            sensitivity: 'base',
          }),
        ),
      )
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [storeId])

  useEffect(() => {
    if (!storeId) return undefined

    setCreditLoading(true)

    const unsubscribe = onSnapshot(
      doc(db, 'stores', storeId),
      snapshot => {
        const data = snapshot.data() ?? {}
        const rawCredits = data.bulkMessagingCredits
        const nextCredits =
          typeof rawCredits === 'number' && Number.isFinite(rawCredits) ? rawCredits : 0
        setCreditBalance(nextCredits)
        setCreditLoading(false)
      },
      error => {
        console.error('[bulk-messaging] Failed to load bulk messaging credits', error)
        setCreditBalance(0)
        setCreditLoading(false)
      },
    )

    return () => unsubscribe()
  }, [storeId])

  const tagOptions = useMemo(() => {
    const tags = new Set<string>()
    customers.forEach(customer => {
      customer.tags?.forEach(tag => {
        if (tag) tags.add(tag)
      })
    })
    return Array.from(tags).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [customers])

  const filteredCustomers = useMemo(() => {
    const normalizedSearch = normalizeSearchTerm(searchTerm)
    return customers.filter(customer => {
      if (tagFilter && !(customer.tags ?? []).includes(tagFilter)) return false
      if (!normalizedSearch) return true
      const haystack = [
        getCustomerDisplayName(customer),
        customer.phone ?? '',
        customer.email ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [customers, searchTerm, tagFilter])

  const selectedCustomers = useMemo(
    () => customers.filter(customer => selectedIds.has(customer.id)),
    [customers, selectedIds],
  )

  const selectableCustomers = useMemo(
    () => selectedCustomers.filter(customer => Boolean(customer.phone?.trim())),
    [selectedCustomers],
  )

  const messageLength = message.length
  const messageSegments = Math.max(1, Math.ceil(messageLength / SMS_SEGMENT_SIZE))
  const creditsNeeded = selectableCustomers.length * messageSegments * CREDITS_PER_SMS
  const hasEnoughCredits = creditBalance >= creditsNeeded

  const allVisibleSelected =
    filteredCustomers.length > 0 && filteredCustomers.every(customer => selectedIds.has(customer.id))

  const canSend =
    Boolean(storeId) &&
    message.trim().length > 0 &&
    message.trim().length <= MESSAGE_LIMIT &&
    selectableCustomers.length > 0 &&
    hasEnoughCredits &&
    !isSending

  const statusToneClass = status ? `bulk-messaging-page__status--${status.tone}` : ''
  const buyStatusToneClass = buyStatus
    ? `bulk-messaging-page__status--${buyStatus.tone}`
    : ''

  function handleToggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleSelectAllVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        filteredCustomers.forEach(customer => next.delete(customer.id))
      } else {
        filteredCustomers.forEach(customer => next.add(customer.id))
      }
      return next
    })
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus(null)

    if (!storeId) {
      setStatus({ tone: 'error', message: 'Select a workspace before sending messages.' })
      return
    }

    if (!message.trim()) {
      setStatus({ tone: 'error', message: 'Write a message to send before continuing.' })
      return
    }

    if (message.length > MESSAGE_LIMIT) {
      setStatus({ tone: 'error', message: `Message exceeds the ${MESSAGE_LIMIT} character limit.` })
      return
    }

    if (!selectableCustomers.length) {
      setStatus({
        tone: 'error',
        message: 'Select at least one customer with a phone number to continue.',
      })
      return
    }

    if (creditLoading) {
      setStatus({
        tone: 'info',
        message: 'Checking bulk messaging credits. Please wait a moment and try again.',
      })
      return
    }

    if (!hasEnoughCredits) {
      setStatus({
        tone: 'error',
        message: 'You are out of bulk messaging credits. Please buy more to continue.',
      })
      return
    }

    setIsSending(true)

    try {
      const payload: BulkMessagePayload = {
        storeId,
        channel,
        message: message.trim(),
        recipients: selectableCustomers.map(customer => ({
          id: customer.id,
          name: getCustomerDisplayName(customer),
          phone: customer.phone,
        })),
      }

      const response = await sendBulkMessage(payload)
      const data = response.data

      if (!data.ok) {
        throw new Error('Hubtel could not process the request.')
      }

      if (data.failures.length) {
        const failureSummary = data.failures
          .slice(0, 3)
          .map((failure: { phone: string; error: string }) => {
            const phone = failure.phone || 'Unknown number'
            const reason = failure.error || 'Unknown error'
            return `${phone}: ${reason}`
          })
          .join(' | ')
        const extraFailures =
          data.failures.length > 3 ? ` (+${data.failures.length - 3} more)` : ''
        setStatus({
          tone: 'info',
          message: `Sent ${data.sent} of ${data.attempted} messages. ${data.failures.length} failed to send. ${failureSummary}${extraFailures}`,
        })
      } else {
        setStatus({
          tone: 'success',
          message: `Sent ${data.sent} SMS messages successfully.`,
        })
      }
    } catch (error) {
      console.error('[bulk-messaging] Failed to send bulk message', error)
      if (error instanceof FirebaseError && error.code === 'failed-precondition') {
        setStatus({
          tone: 'error',
          message: error.message || 'You do not have enough bulk messaging credits to send.',
        })
        return
      }
      setStatus({
        tone: 'error',
        message: 'We could not send the messages. Check Hubtel configuration and try again.',
      })
    } finally {
      setIsSending(false)
    }
  }

  async function handleBuyCredits(packageId: string) {
    setBuyStatus(null)

    if (!storeId) {
      setBuyStatus({ tone: 'error', message: 'Select a workspace before buying credits.' })
      return
    }

    if (buyingPackageId) return

    setBuyingPackageId(packageId)

    try {
      const response = await createBulkCreditsCheckout({
        storeId,
        package: packageId,
      })
      const data = response.data
      const authorizationUrl =
        typeof data?.authorizationUrl === 'string' ? data.authorizationUrl : null

      if (!authorizationUrl) {
        throw new Error('Paystack did not return a checkout URL.')
      }

      window.location.assign(authorizationUrl)
    } catch (error) {
      console.error('[bulk-messaging] Failed to start bulk credits checkout', error)
      setBuyStatus({
        tone: 'error',
        message: 'We could not start the Paystack checkout. Please try again.',
      })
    } finally {
      setBuyingPackageId(null)
    }
  }

  return (
    <div className="page bulk-messaging-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Bulk SMS</h2>
          <p className="page__subtitle">
            Broadcast promotions, reminders, or updates to your customers using a Hubtel-powered
            messaging hub.
          </p>
        </div>
      </header>

      <section className="bulk-messaging-page__summary">
        <div className="card bulk-messaging-page__summary-card">
          <p className="bulk-messaging-page__summary-label">Audience selected</p>
          <p className="bulk-messaging-page__summary-value">{selectedCustomers.length}</p>
          <p className="bulk-messaging-page__summary-meta">
            {selectableCustomers.length} with a phone number
          </p>
        </div>
        <div className="card bulk-messaging-page__summary-card">
          <p className="bulk-messaging-page__summary-label">Channel</p>
          <p className="bulk-messaging-page__summary-value">SMS</p>
          <p className="bulk-messaging-page__summary-meta">
            Messages will send via Hubtel from your verified sender
          </p>
        </div>
        <div className="card bulk-messaging-page__summary-card">
          <p className="bulk-messaging-page__summary-label">Message length</p>
          <p className="bulk-messaging-page__summary-value">{messageLength}</p>
          <p className="bulk-messaging-page__summary-meta">{`${messageSegments} SMS segment(s)`}</p>
        </div>
        <div className="card bulk-messaging-page__summary-card bulk-messaging-page__summary-card--credits">
          <p className="bulk-messaging-page__summary-label">Bulk message credits</p>
          <p className="bulk-messaging-page__summary-value">
            {creditLoading ? 'Loading…' : creditBalance}
          </p>
          <div className="bulk-messaging-page__summary-meta bulk-messaging-page__credits-meta">
            <span>
              {creditLoading
                ? 'Checking available credits'
                : creditsNeeded > 0
                ? `${formatNumber(creditsNeeded)} credits required (${formatNumber(
                    selectableCustomers.length,
                  )} recipient(s) × ${messageSegments} segment(s) × ${CREDITS_PER_SMS} credits)`
                : 'Select recipients to see required credits'}
            </span>
            <a className="button button--ghost button--small" href="#buy-credits">
              Buy credits
            </a>
          </div>
        </div>
      </section>

      <div className="bulk-messaging-page__grid">
        <section className="card">
          <div className="bulk-messaging-page__section-header">
            <div>
              <h3 className="card__title">Compose message</h3>
              <p className="card__subtitle">
                Craft your message and send to the selected customers.
              </p>
            </div>
          </div>

          <form className="bulk-messaging-page__form" onSubmit={handleSend}>
            <label className="field">
              <span className="field__label">Message</span>
              <textarea
                className="bulk-messaging-page__textarea"
                placeholder="Write your announcement, offer, or reminder..."
                value={message}
                maxLength={MESSAGE_LIMIT}
                onChange={event => setMessage(event.target.value)}
              />
              <span className="bulk-messaging-page__hint">
                {MESSAGE_LIMIT - messageLength} characters remaining
              </span>
            </label>

            {status ? (
              <div className={`bulk-messaging-page__status ${statusToneClass}`} role="status">
                {status.message}
              </div>
            ) : null}

            <div className="bulk-messaging-page__actions">
              <button type="submit" className="button button--primary" disabled={!canSend}>
                {isSending ? 'Sending...' : 'Send SMS'}
              </button>
              <div className="bulk-messaging-page__actions-meta">
                {hasEnoughCredits
                  ? 'Only customers with phone numbers will receive this broadcast.'
                  : 'Purchase bulk messaging credits to unlock sending.'}
              </div>
            </div>
          </form>
        </section>

        <section className="card">
          <div className="bulk-messaging-page__section-header">
            <div>
              <h3 className="card__title">Recipients</h3>
              <p className="card__subtitle">
                Select customers to receive your broadcast. Filter by name, phone, or tag.
              </p>
            </div>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={handleSelectAllVisible}
              disabled={!filteredCustomers.length}
            >
              {allVisibleSelected ? 'Clear shown' : 'Select shown'}
            </button>
          </div>

          <div className="bulk-messaging-page__filters">
            <label className="field">
              <span className="field__label">Search</span>
              <input
                type="search"
                placeholder="Search customers"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Tag</span>
              <select value={tagFilter ?? ''} onChange={event => setTagFilter(event.target.value || null)}>
                <option value="">All tags</option>
                {tagOptions.map(tag => (
                  <option key={tag} value={tag}>
                    #{tag}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="bulk-messaging-page__recipient-list" role="list">
            {filteredCustomers.length ? (
              filteredCustomers.map(customer => {
                const displayName = getCustomerDisplayName(customer)
                const hasPhone = Boolean(customer.phone?.trim())
                const isSelected = selectedIds.has(customer.id)

                return (
                  <label
                    key={customer.id}
                    className={`bulk-messaging-page__recipient-row${
                      isSelected ? ' is-selected' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(customer.id)}
                    />
                    <span className="bulk-messaging-page__recipient-name">{displayName}</span>
                    <span className="bulk-messaging-page__recipient-meta">
                      {hasPhone ? formatPhone(customer.phone) : 'No phone on file'}
                    </span>
                  </label>
                )
              })
            ) : (
              <div className="bulk-messaging-page__empty">
                <h4>No customers found</h4>
                <p>Update your search or add customers with phone numbers to send messages.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="card bulk-messaging-page__buy-credits" id="buy-credits">
        <div>
          <h3 className="card__title">Buy bulk messaging credits</h3>
          <p className="card__subtitle">
            Top up your balance to keep broadcasting SMS campaigns.
          </p>
        </div>
        <div className="bulk-messaging-page__buy-credits-actions">
          <div className="bulk-messaging-page__buy-credits-grid">
            {BULK_CREDITS_PACKAGES.map(creditPackage => {
              const isBusy = buyingPackageId === creditPackage.id
              return (
                <button
                  key={creditPackage.id}
                  type="button"
                  className="button button--outline bulk-messaging-page__buy-credits-option"
                  onClick={() => handleBuyCredits(creditPackage.id)}
                  disabled={!storeId || Boolean(buyingPackageId)}
                >
                  <span className="bulk-messaging-page__buy-credits-label">
                    {creditPackage.label}
                  </span>
                  <span className="bulk-messaging-page__buy-credits-amount">
                    {formatNumber(creditPackage.credits)} credits
                  </span>
                  <span className="bulk-messaging-page__buy-credits-sms">
                    ~{formatNumber(Math.round(creditPackage.credits / CREDITS_PER_SMS))} SMS
                  </span>
                  <span className="bulk-messaging-page__buy-credits-price">
                    GHS {creditPackage.price}
                  </span>
                  <span className="bulk-messaging-page__buy-credits-cta">
                    {isBusy ? 'Starting checkout…' : 'Buy now'}
                  </span>
                </button>
              )
            })}
          </div>
          {buyStatus ? (
            <div className={`bulk-messaging-page__status ${buyStatusToneClass}`} role="status">
              {buyStatus.message}
            </div>
          ) : (
            <p className="bulk-messaging-page__buy-credits-note">
              Choose a package to continue to Paystack checkout. Estimated SMS cost is about GHS{' '}
              {formatPrice(SMS_PRICE_ESTIMATE_GHS)} per SMS (12 credits per SMS).
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
