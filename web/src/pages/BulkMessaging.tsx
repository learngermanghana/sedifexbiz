import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
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

type BulkMessageChannel = 'sms' | 'whatsapp'

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

type StatusTone = 'success' | 'error' | 'info'

type StatusMessage = {
  tone: StatusTone
  message: string
}

const MESSAGE_LIMIT = 1000
const SMS_SEGMENT_SIZE = 160

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
  const [channel, setChannel] = useState<BulkMessageChannel>('sms')
  const [message, setMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [isSending, setIsSending] = useState(false)

  const sendBulkMessage = useMemo(
    () => httpsCallable<BulkMessagePayload, BulkMessageResult>(functions, 'sendBulkMessage'),
    [],
  )

  useEffect(() => {
    let cancelled = false

    if (!storeId) {
      setCustomers([])
      setSelectedIds(new Set())
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

  const allVisibleSelected =
    filteredCustomers.length > 0 && filteredCustomers.every(customer => selectedIds.has(customer.id))

  const canSend =
    Boolean(storeId) &&
    message.trim().length > 0 &&
    message.trim().length <= MESSAGE_LIMIT &&
    selectableCustomers.length > 0 &&
    !isSending

  const statusToneClass = status ? `bulk-messaging-page__status--${status.tone}` : ''

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
        throw new Error('Twilio could not process the request.')
      }

      if (data.failures.length) {
        setStatus({
          tone: 'info',
          message: `Sent ${data.sent} of ${data.attempted} messages. ${data.failures.length} failed to send.`,
        })
      } else {
        setStatus({
          tone: 'success',
          message: `Sent ${data.sent} ${channel.toUpperCase()} messages successfully.`,
        })
      }
    } catch (error) {
      console.error('[bulk-messaging] Failed to send bulk message', error)
      setStatus({
        tone: 'error',
        message: 'We could not send the messages. Check Twilio configuration and try again.',
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="page bulk-messaging-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Bulk SMS & WhatsApp</h2>
          <p className="page__subtitle">
            Broadcast promotions, reminders, or updates to your customers using a Twilio-powered
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
          <p className="bulk-messaging-page__summary-value">{channel === 'sms' ? 'SMS' : 'WhatsApp'}</p>
          <p className="bulk-messaging-page__summary-meta">
            Messages will send via Twilio from your verified sender
          </p>
        </div>
        <div className="card bulk-messaging-page__summary-card">
          <p className="bulk-messaging-page__summary-label">Message length</p>
          <p className="bulk-messaging-page__summary-value">{messageLength}</p>
          <p className="bulk-messaging-page__summary-meta">
            {channel === 'sms' ? `${messageSegments} SMS segment(s)` : 'WhatsApp message count'}
          </p>
        </div>
      </section>

      <div className="bulk-messaging-page__grid">
        <section className="card">
          <div className="bulk-messaging-page__section-header">
            <div>
              <h3 className="card__title">Compose message</h3>
              <p className="card__subtitle">
                Choose the channel, craft your message, and send to the selected customers.
              </p>
            </div>
          </div>

          <div className="bulk-messaging-page__channel">
            <button
              type="button"
              className={`button button--outline bulk-messaging-page__channel-button${
                channel === 'sms' ? ' is-active' : ''
              }`}
              onClick={() => setChannel('sms')}
            >
              SMS
            </button>
            <button
              type="button"
              className={`button button--outline bulk-messaging-page__channel-button${
                channel === 'whatsapp' ? ' is-active' : ''
              }`}
              onClick={() => setChannel('whatsapp')}
            >
              WhatsApp
            </button>
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
                {isSending ? 'Sending...' : `Send ${channel === 'sms' ? 'SMS' : 'WhatsApp'}`}
              </button>
              <div className="bulk-messaging-page__actions-meta">
                Only customers with phone numbers will receive this broadcast.
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

      <section className="card bulk-messaging-page__footnote">
        <h3 className="card__title">Twilio delivery controls</h3>
        <p className="card__subtitle">
          Configure your Twilio account SID, auth token, and sender IDs in your Firebase functions
          environment to activate SMS and WhatsApp deliveries. This page will automatically route
          requests to the Twilio backend once credentials are set.
        </p>
      </section>
    </div>
  )
}
