import React, { useMemo, useState } from 'react'
import './ActivityFeed.css'

type ActivityType = 'sale' | 'customer' | 'inventory' | 'task'

type Activity = {
  id: string
  type: ActivityType
  summary: string
  detail: string
  actor: string
  timestamp: Date
}

const INITIAL_ACTIVITIES: Activity[] = [
  {
    id: '1',
    type: 'sale',
    summary: 'Sold 3 x Wireless Headphones',
    detail: 'Processed by register #2, paid with card.',
    actor: 'Rita A.',
    timestamp: new Date(Date.now() - 1000 * 60 * 9),
  },
  {
    id: '2',
    type: 'customer',
    summary: 'New customer added: Jason Lee',
    detail: 'Added phone number and opted into SMS receipts.',
    actor: 'Marcus O.',
    timestamp: new Date(Date.now() - 1000 * 60 * 22),
  },
  {
    id: '3',
    type: 'inventory',
    summary: 'Received 24 x Cold Brew Cans',
    detail: 'Checked into back room and ready for shelf stock.',
    actor: 'Ava T.',
    timestamp: new Date(Date.now() - 1000 * 60 * 45),
  },
  {
    id: '4',
    type: 'task',
    summary: 'Completed daily till check',
    detail: 'Cash counted and matched expected float.',
    actor: 'Andre P.',
    timestamp: new Date(Date.now() - 1000 * 60 * 90),
  },
  {
    id: '5',
    type: 'sale',
    summary: 'Refunded 1 x Coffee Grinder',
    detail: 'Issued store credit and updated inventory.',
    actor: 'Rita A.',
    timestamp: new Date(Date.now() - 1000 * 60 * 120),
  },
]

const TYPE_LABELS: Record<ActivityType, string> = {
  sale: 'Sale',
  customer: 'Customer',
  inventory: 'Inventory',
  task: 'Task',
}

const TYPE_COLORS: Record<ActivityType, string> = {
  sale: '#4338CA',
  customer: '#10B981',
  inventory: '#0EA5E9',
  task: '#F59E0B',
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
  const [activities, setActivities] = useState<Activity[]>(() =>
    INITIAL_ACTIVITIES.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
  )
  const [filter, setFilter] = useState<ActivityType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [newSummary, setNewSummary] = useState('')
  const [newDetail, setNewDetail] = useState('')
  const [newType, setNewType] = useState<ActivityType>('sale')
  const [actor, setActor] = useState('You')

  const filteredActivities = useMemo(() => {
    const normalizedQuery = search.trim().toLowerCase()
    return activities.filter(activity => {
      const matchesType = filter === 'all' || activity.type === filter
      const matchesQuery = normalizedQuery
        ? `${activity.summary} ${activity.detail} ${activity.actor}`
            .toLowerCase()
            .includes(normalizedQuery)
        : true
      return matchesType && matchesQuery
    })
  }, [activities, filter, search])

  const counts = useMemo(() => {
    return activities.reduce<Record<ActivityType, number>>(
      (acc, activity) => {
        acc[activity.type] += 1
        return acc
      },
      { sale: 0, customer: 0, inventory: 0, task: 0 },
    )
  }, [activities])

  function addActivity(event: React.FormEvent) {
    event.preventDefault()
    if (!newSummary.trim()) return

    const nextActivity: Activity = {
      id: crypto.randomUUID(),
      type: newType,
      summary: newSummary.trim(),
      detail: newDetail.trim() || 'Noted in activity feed.',
      actor: actor.trim() || 'Team member',
      timestamp: new Date(),
    }

    setActivities(prev => [nextActivity, ...prev])
    setNewSummary('')
    setNewDetail('')
    setActor('You')
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
    const link = document.createElement('a')
    link.href = url
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    link.download = `activity-feed-${timestamp}.csv`
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
          <button type="button" className="button button--primary" onClick={downloadCsv} disabled={!filteredActivities.length}>
            Download CSV
          </button>
        </div>
      </header>

      <section className="activity-controls" aria-label="Activity controls">
        <div className="activity-filters" role="group" aria-label="Activity type filters">
          {(['all', 'sale', 'customer', 'inventory', 'task'] as const).map(option => {
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
      </section>

      <section className="activity-add" aria-label="Log activity">
        <div>
          <h3>Log something that just happened</h3>
          <p className="activity-subtext">Keep everyone aligned by adding the sale, customer, or task you just completed.</p>
        </div>
        <form className="activity-form" onSubmit={addActivity}>
          <label className="activity-form__field">
            <span>Type</span>
            <select value={newType} onChange={event => setNewType(event.target.value as ActivityType)}>
              <option value="sale">Sale</option>
              <option value="customer">Customer</option>
              <option value="inventory">Inventory</option>
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
          <button type="submit" className="button button--primary" disabled={!newSummary.trim()}>
            Add to feed
          </button>
        </form>
      </section>

      <section className="activity-feed" aria-live="polite">
        {filteredActivities.length === 0 ? (
          <div className="activity-empty">
            <p>No activity yet. Try adding a new entry or adjust your filters.</p>
          </div>
        ) : (
          filteredActivities.map(activity => (
            <article key={activity.id} className="activity-item">
              <div className="activity-type" style={{ color: TYPE_COLORS[activity.type] }}>
                <span className="activity-type__dot" style={{ background: TYPE_COLORS[activity.type] }} />
                {TYPE_LABELS[activity.type]}
              </div>
              <div className="activity-body">
                <div className="activity-body__row">
                  <h4>{activity.summary}</h4>
                  <span className="activity-timestamp">{formatTimestamp(activity.timestamp)}</span>
                </div>
                <p className="activity-detail">{activity.detail}</p>
                <div className="activity-meta">By {activity.actor}</div>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  )
}
