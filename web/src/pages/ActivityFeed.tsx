// web/src/pages/ActivityFeed.tsx (or wherever it lives)
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
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './ActivityFeed.css'
import { FixedSizeList, ListChildComponentProps } from '../utils/VirtualizedList'
import { buildReceiptPdf, type PaymentMethod, type ReceiptPayload } from '../utils/receipt'

type ActivityType = 'sale' | 'customer' | 'inventory' | 'expense' | 'task'
type TimeRange = 'any' | '24h' | '7d' | '30d'

type Activity = {
  id: string
  storeId: string
  type: ActivityType
  summary: string
  detail: string
  actor: string
  timestamp: Date
  receipt: ReceiptPayload | null
}

const TYPE_LABELS: Record<ActivityType, string> = {
  sale: 'Sale',
  customer: 'Customer',
  inventory: 'Inventory',
  expense: 'Expense',
  task: 'Task',
}

const TYPE_COLORS: Record<ActivityType, string> = {
  sale: '#4338CA',
  customer: '#10B981',
  inventory: '#0EA5E9',
  expense: '#EA580C',
  task: '#F59E0B',
}

function toDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value?.toDate === 'function') {
    try {
      return value.toDate()
    } catch {
      return null
    }
  }
  const ms = Date.parse(String(value))
  return Number.isNaN(ms) ? null : new Date(ms)
}

function toReceiptPayload(value: any): ReceiptPayload | null {
  if (!value || typeof value !== 'object') return null

  const saleId = typeof value.saleId === 'string' ? value.saleId : null
  if (!saleId) return null

  const rawItems = Array.isArray(value.items) ? value.items : []
  const items = rawItems
    .map(item => ({
      name: typeof item?.name === 'string' ? item.name : 'Item',
      qty: Number(item?.qty) || 0,
      price: Number(item?.price) || 0,
    }))
    .filter(item => item.qty > 0)

  const totalsRaw = typeof value.totals === 'object' && value.totals !== null ? value.totals : {}
  const totals = {
    subTotal: Number(totalsRaw.subTotal) || 0,
    taxTotal: Number(totalsRaw.taxTotal) || 0,
    discount: Number(totalsRaw.discount) || 0,
    total: Number(totalsRaw.total) || 0,
  }

  const paymentMethod: PaymentMethod =
    value.paymentMethod === 'card' ||
    value.paymentMethod === 'mobile_money' ||
    value.paymentMethod === 'transfer'
      ? value.paymentMethod
      : 'cash'

  const discountInput = typeof value.discountInput === 'string' ? value.discountInput : ''
  const companyName = typeof value.companyName === 'string' ? value.companyName : null
  const customerName = typeof value.customerName === 'string' ? value.customerName : null

  return {
    saleId,
    items,
    totals,
    paymentMethod,
    discountInput,
    companyName,
    customerName,
  }
}

function formatTimestamp(date: Date) {
  const now = Date.now()
  const elapsed = now - date.getTime()
  const minutes = Math.round(elapsed / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function buildCsvValue(value: string) {
  const needsQuotes = value.includes(',') || value.includes('"') || value.includes('\n')
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

export default function ActivityFeed() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()

  const [activities, setActivities] = useState<Activity[]>([])
  const [filter, setFilter] = useState<ActivityType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [actorFilter, setActorFilter] = useState('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('any')
  const [newSummary, setNewSummary] = useState('')
  const [newDetail, setNewDetail] = useState('')
  const [newType, setNewType] = useState<ActivityType>('sale')
  const [actor, setActor] = useState('You')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)

  // 🔴 LIVE SUBSCRIPTION TO FIRESTORE
  useEffect(() => {
    if (!storeId) {
      setActivities([])
      return
    }

    setLoading(true)
    setLoadError(null)

    const activityRef = collection(db, 'activity')
    const q = query(
      activityRef,
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
      limit(200),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const rows: Activity[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data() || {}
          return {
            id: docSnap.id,
            storeId: data.storeId ?? storeId,
            type: (data.type as ActivityType) ?? 'task',
            summary: data.summary ?? '',
            detail: data.detail ?? '',
            actor: data.actor ?? 'Team member',
            timestamp: toDate(data.createdAt) ?? new Date(),
            receipt: toReceiptPayload(data.receipt),
          }
        })
        setActivities(rows)
        setLoading(false)
      },
      error => {
        console.error('[activity] Failed to subscribe', error)
        setActivities([])
        setLoading(false)
        setLoadError('Unable to load activity right now. Please try again.')
      },
    )

    return () => unsubscribe()
  }, [storeId])

  const actorOptions = useMemo(() => {
    const uniqueActors = Array.from(new Set(activities.map(activity => activity.actor.trim()).filter(Boolean)))
    return ['all', ...uniqueActors]
  }, [activities])

  const filteredActivities = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    return activities.filter(activity => {
      const matchesType = filter === 'all' || activity.type === filter
      const matchesQuery = normalizedQuery
        ? `${activity.summary} ${activity.detail} ${activity.actor}`.toLowerCase().includes(normalizedQuery)
        : true
      const matchesActor = actorFilter === 'all' || activity.actor === actorFilter

      if (timeRange === 'any') {
        return matchesType && matchesQuery && matchesActor
      }

      const now = Date.now()
      const cutoff = (() => {
        switch (timeRange) {
          case '24h':
            return now - 24 * 60 * 60 * 1000
          case '7d':
            return now - 7 * 24 * 60 * 60 * 1000
          case '30d':
            return now - 30 * 24 * 60 * 60 * 1000
          default:
            return now
        }
      })()

      return matchesType && matchesQuery && matchesActor && activity.timestamp.getTime() >= cutoff
    })
  }, [activities, filter, search, actorFilter, timeRange])

  const counts = useMemo(() => {
    return activities.reduce<Record<ActivityType, number>>(
      (acc, activity) => {
        acc[activity.type] += 1
        return acc
      },
      { sale: 0, customer: 0, inventory: 0, expense: 0, task: 0 },
    )
  }, [activities])

  const shouldVirtualizeFeed = filteredActivities.length > 80
  const feedRowHeight = 128
  const feedViewportHeight = Math.min(
    Math.max(feedRowHeight * 3, filteredActivities.length * feedRowHeight),
    720,
  )

  function handleDownloadReceipt(receipt: ReceiptPayload) {
    setReceiptError(null)

    const built = buildReceiptPdf(receipt)
    if (!built) {
      setReceiptError('Unable to build the receipt right now. Please try again.')
      return
    }

    const link = document.createElement('a')
    link.href = built.url
    link.download = built.fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(built.url)
  }

  const renderActivityCard = (activity: Activity) => (
    <article key={activity.id} className="activity-item">
      <div className="activity-type" style={{ color: TYPE_COLORS[activity.type] }}>
        <span
          className="activity-type__dot"
          style={{ background: TYPE_COLORS[activity.type] }}
        />
        {TYPE_LABELS[activity.type]}
      </div>
      <div className="activity-body">
        <div className="activity-body__row">
          <h4>{activity.summary}</h4>
          <span className="activity-timestamp">{formatTimestamp(activity.timestamp)}</span>
        </div>
        <p className="activity-detail">{activity.detail}</p>
        <div className="activity-meta">By {activity.actor}</div>
        {activity.type === 'sale' && activity.receipt && (
          <div className="activity-actions-row">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => handleDownloadReceipt(activity.receipt)}
            >
              Download receipt
            </button>
          </div>
        )}
      </div>
    </article>
  )

  const VirtualizedActivityRow = ({ index, style, data }: ListChildComponentProps<Activity[]>) => {
    const activity = data[index]
    return <div style={style} className="activity-feed__virtual-row">{renderActivityCard(activity)}</div>
  }

  // 🟢 WRITE NEW ACTIVITY TO FIRESTORE
  async function addActivity(event: React.FormEvent) {
    event.preventDefault()
    if (!newSummary.trim() || !storeId) return

    try {
      await addDoc(collection(db, 'activity'), {
        storeId,
        type: newType,
        summary: newSummary.trim(),
        detail: newDetail.trim() || 'Noted in activity feed.',
        actor: actor.trim() || 'Team member',
        createdAt: serverTimestamp(),
      })
      // onSnapshot will bring it into the list
      setNewSummary('')
      setNewDetail('')
      setActor('You')
    } catch (error) {
      console.error('[activity] Failed to add activity', error)
      setLoadError('Unable to log activity. Please try again.')
    }
  }

  function downloadCsv() {
    if (!filteredActivities.length) return

    const headers = ['Type', 'Summary', 'Detail', 'Actor', 'Timestamp']
    const rows = filteredActivities.map(activity => [
      TYPE_LABELS[activity.type],
      activity.summary,
      activity.detail,
      activity.actor,
      activity.timestamp.toISOString(),
    ])

    const csvContent = [
      headers.map(buildCsvValue).join(','),
      ...rows.map(row => row.map(cell => buildCsvValue(cell)).join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const link = document.createElement('a')
    link.href = url
    link.download = `activity-feed-${ts}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="activity-page">
      <header className="activity-header">
        <div>
          <p className="activity-eyebrow">Activity feed</p>
          <h2>Everything that just happened</h2>
          <p className="activity-subhead">
            Track sales, customer updates, and operational work in one place. New entries appear instantly and can be
            downloaded for records.
          </p>
        </div>
        <div className="activity-actions">
          <div className="activity-pill">Live</div>
          <button
            type="button"
            className="button button--primary"
            onClick={downloadCsv}
            disabled={!filteredActivities.length}
          >
            Download CSV
          </button>
        </div>
      </header>

      {storeError && <div className="activity-error">{storeError}</div>}
      {loadError && <div className="activity-error">{loadError}</div>}
      {receiptError && <div className="activity-error">{receiptError}</div>}
      {loading && <p className="activity-loading">Loading activity…</p>}

      <section className="activity-controls" aria-label="Activity controls">
        <div className="activity-filters" role="group" aria-label="Activity type filters">
          {(['all', 'sale', 'customer', 'inventory', 'expense', 'task'] as const).map(option => {
            const label = option === 'all' ? 'All activity' : TYPE_LABELS[option]
            const countLabel = option === 'all' ? activities.length : counts[option]
            return (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                aria-pressed={filter === option}
                className={filter === option ? 'activity-filter is-active' : 'activity-filter'}
              >
                <span>{label}</span>
                <span className="activity-count">{countLabel}</span>
              </button>
            )
          })}
        </div>

        <div className="activity-utilities">
          <div className="activity-selects">
            <label className="activity-select">
              <span className="activity-select__label">Actor</span>
              <select value={actorFilter} onChange={event => setActorFilter(event.target.value)}>
                {actorOptions.map(option => (
                  <option key={option} value={option}>
                    {option === 'all' ? 'Anyone' : option}
                  </option>
                ))}
              </select>
            </label>

            <label className="activity-select">
              <span className="activity-select__label">Time</span>
              <select value={timeRange} onChange={event => setTimeRange(event.target.value as TimeRange)}>
                <option value="any">Any time</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>
          </div>

          <div className="activity-search">
            <label className="activity-search__label">
              <span className="activity-search__hint">Search feed</span>
              <input
                type="search"
                placeholder="Find a product, customer, or teammate"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="activity-add" aria-label="Log activity">
        <div>
          <h3>Log something that just happened</h3>
          <p className="activity-subtext">
            Keep everyone aligned by adding the sale, customer, or task you just completed.
          </p>
        </div>
        <form className="activity-form" onSubmit={addActivity}>
          <label className="activity-form__field">
            <span>Type</span>
            <select value={newType} onChange={event => setNewType(event.target.value as ActivityType)}>
              <option value="sale">Sale</option>
              <option value="customer">Customer</option>
              <option value="inventory">Inventory</option>
              <option value="expense">Expense</option>
              <option value="task">Task</option>
            </select>
          </label>
          <label className="activity-form__field">
            <span>Summary</span>
            <input
              type="text"
              value={newSummary}
              onChange={event => setNewSummary(event.target.value)}
              placeholder="e.g. Sold 2 x Drip Coffee Maker"
              required
            />
          </label>
          <label className="activity-form__field">
            <span>Details</span>
            <input
              type="text"
              value={newDetail}
              onChange={event => setNewDetail(event.target.value)}
              placeholder="Payment method, notes, or follow-up"
            />
          </label>
          <label className="activity-form__field">
            <span>Who did this?</span>
            <input
              type="text"
              value={actor}
              onChange={event => setActor(event.target.value)}
              placeholder="Name"
            />
          </label>
          <button
            type="submit"
            className="button button--primary"
            disabled={!newSummary.trim() || !storeId}
          >
            Add to feed
          </button>
        </form>
      </section>

      <section className="activity-feed" aria-live="polite">
        {filteredActivities.length === 0 && !loading ? (
          <div className="activity-empty">
            <p>No activity yet. Try adding a new entry or adjust your filters.</p>
          </div>
        ) : shouldVirtualizeFeed ? (
          <FixedSizeList
            height={feedViewportHeight}
            itemCount={filteredActivities.length}
            itemData={filteredActivities}
            itemKey={(index, items) => items[index].id}
            itemSize={feedRowHeight}
            className="activity-feed__virtual-list"
          >
            {VirtualizedActivityRow}
          </FixedSizeList>
        ) : (
          filteredActivities.map(renderActivityCard)
        )}
      </section>
    </div>
  )
}
