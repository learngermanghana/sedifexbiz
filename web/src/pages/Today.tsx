import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'

import { db } from '../firebase'
import { useActiveStoreContext } from '../context/ActiveStoreProvider'

export function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

type DailySummary = {
  salesTotal: number
  salesCount: number
  cardTotal: number
  cashTotal: number
  receiptCount: number
  receiptUnits: number
  newCustomers: number
}

type ActivityEntry = {
  id: string
  message: string
  type: string | null
  actor: string | null
  at: Date | null
}

type TimestampLike = { toDate?: () => Date }

function isTimestamp(value: unknown): value is TimestampLike {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as TimestampLike).toDate === 'function',
  )
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const parsed = Number.parseFloat(trimmed)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function toInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return 0
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function mapDailySummary(data: DocumentData | undefined): DailySummary {
  return {
    salesTotal: toNumber(data?.salesTotal),
    salesCount: toInteger(data?.salesCount),
    cardTotal: toNumber(data?.cardTotal),
    cashTotal: toNumber(data?.cashTotal),
    receiptCount: toInteger(data?.receiptCount),
    receiptUnits: toInteger(data?.receiptUnits),
    newCustomers: toInteger(data?.newCustomers),
  }
}

function mapActivity(docSnapshot: QueryDocumentSnapshot<DocumentData>): ActivityEntry {
  const data = docSnapshot.data()

  const message =
    typeof data.message === 'string' && data.message.trim()
      ? data.message.trim()
      : 'Activity recorded'

  const type = typeof data.type === 'string' && data.type.trim() ? data.type.trim() : null

  let actor: string | null = null
  const rawActor = data.actor
  if (typeof rawActor === 'string' && rawActor.trim()) {
    actor = rawActor.trim()
  } else if (rawActor && typeof rawActor === 'object') {
    const displayName =
      typeof (rawActor as Record<string, unknown>).displayName === 'string'
        ? (rawActor as Record<string, unknown>).displayName
        : null
    const email =
      typeof (rawActor as Record<string, unknown>).email === 'string'
        ? (rawActor as Record<string, unknown>).email
        : null
    actor = (displayName || email || '').trim() || null
  }

  let at: Date | null = null
  const rawTimestamp = data.at
  if (isTimestamp(rawTimestamp)) {
    try {
      at = rawTimestamp.toDate() ?? null
    } catch (error) {
      console.error('[today] unable to convert timestamp', error)
      at = null
    }
  } else if (typeof rawTimestamp === 'string') {
    const parsed = new Date(rawTimestamp)
    at = Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return {
    id: docSnapshot.id,
    message,
    type,
    actor,
    at,
  }
}

function formatCurrency(value: number) {
  return `GHS ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatNumber(value: number) {
  return value.toLocaleString()
}

function formatTime(value: Date | null) {
  if (!value) return '—'
  try {
    return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch (error) {
    console.error('[today] unable to format time', error)
    return '—'
  }
}

export default function Today() {
  const { storeId, isLoading: storeLoading, storeChangeToken } = useActiveStoreContext()

  const today = useMemo(() => new Date(), [])
  const todayKey = useMemo(() => formatDateKey(today), [today])
  const todayLabel = useMemo(
    () =>
      today.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    [today],
  )

  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [activitiesError, setActivitiesError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) {
      setSummary(null)
      setSummaryLoading(false)
      setSummaryError(null)
      return
    }

    let cancelled = false
    setSummaryLoading(true)
    setSummaryError(null)

    const ref = doc(db, 'dailySummaries', `${storeId}_${todayKey}`)
    getDoc(ref)
      .then(snapshot => {
        if (cancelled) return
        if (snapshot.exists()) {
          setSummary(mapDailySummary(snapshot.data()))
        } else {
          setSummary(mapDailySummary(undefined))
        }
      })
      .catch(error => {
        if (cancelled) return
        console.error('[today] failed to load daily summary', error)
        setSummary(null)
        setSummaryError("We couldn't load today's summary.")
      })
      .finally(() => {
        if (cancelled) return
        setSummaryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [storeId, todayKey, storeChangeToken])

  useEffect(() => {
    if (!storeId) {
      setActivities([])
      setActivitiesLoading(false)
      setActivitiesError(null)
      return
    }

    let cancelled = false
    setActivitiesLoading(true)
    setActivitiesError(null)

    const activitiesQuery = query(
      collection(db, 'activities'),
      where('storeId', '==', storeId),
      where('dateKey', '==', todayKey),
      orderBy('at', 'desc'),
      limit(50),
    )

    getDocs(activitiesQuery)
      .then(snapshot => {
        if (cancelled) return
        setActivities(snapshot.docs.map(mapActivity))
      })
      .catch(error => {
        if (cancelled) return
        console.error('[today] failed to load activities', error)
        setActivities([])
        setActivitiesError("We couldn't load the activity feed.")
      })
      .finally(() => {
        if (cancelled) return
        setActivitiesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [storeId, todayKey, storeChangeToken])

  useEffect(() => {
    setSummary(null)
    setSummaryError(null)
    setActivities([])
    setActivitiesError(null)
  }, [storeChangeToken])

  if (storeLoading) {
    return (
      <div>
        <h2 style={{ color: '#4338CA', marginBottom: 8 }}>Today</h2>
        <p style={{ color: '#475569' }}>Loading your workspace…</p>
      </div>
    )
  }

  if (!storeId) {
    return (
      <div>
        <h2 style={{ color: '#4338CA', marginBottom: 8 }}>Today</h2>
        <p style={{ color: '#475569' }}>Select a workspace to see today's performance.</p>
      </div>
    )
  }

  const kpis = summary
    ? [
        {
          title: 'Sales',
          primary: formatCurrency(summary.salesTotal),
          secondary: `${formatNumber(summary.salesCount)} sale${summary.salesCount === 1 ? '' : 's'}`,
        },
        {
          title: 'Card payments',
          primary: formatCurrency(summary.cardTotal),
          secondary: 'Card & digital total',
        },
        {
          title: 'Cash payments',
          primary: formatCurrency(summary.cashTotal),
          secondary: 'Cash counted today',
        },
        {
          title: 'Receipts',
          primary: `${formatNumber(summary.receiptCount)} receipt${summary.receiptCount === 1 ? '' : 's'}`,
          secondary: `${formatNumber(summary.receiptUnits)} unit${summary.receiptUnits === 1 ? '' : 's'}`,
        },
        {
          title: 'New customers',
          primary: formatNumber(summary.newCustomers),
          secondary: 'Added to your CRM',
        },
      ]
    : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h2 style={{ color: '#4338CA', marginBottom: 4 }}>Today</h2>
        <p style={{ color: '#475569', margin: 0 }}>Daily performance for {todayLabel}.</p>
      </header>

      <section
        aria-labelledby="today-kpis"
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 id="today-kpis" style={{ margin: 0, fontSize: 18, color: '#0F172A' }}>
            Key performance indicators
          </h3>
          {summaryLoading && (
            <span aria-live="polite" style={{ fontSize: 13, color: '#64748B' }}>
              Loading today&apos;s summary…
            </span>
          )}
          {summaryError && !summaryLoading && (
            <span role="status" style={{ fontSize: 13, color: '#DC2626' }}>
              {summaryError}
            </span>
          )}
        </div>

        {summaryLoading && kpis.length === 0 ? (
          <p style={{ color: '#475569' }}>Loading today&apos;s summary…</p>
        ) : summaryError && kpis.length === 0 ? (
          <p style={{ color: '#DC2626' }}>{summaryError}</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
            }}
          >
            {kpis.map(kpi => (
              <article
                key={kpi.title}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #E2E8F0',
                  borderRadius: 16,
                  padding: '16px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 13, color: '#64748B' }}>{kpi.title}</span>
                <strong style={{ fontSize: 24, color: '#0F172A' }}>{kpi.primary}</strong>
                <span style={{ fontSize: 12, color: '#475569' }}>{kpi.secondary}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section
        aria-labelledby="today-activity"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 id="today-activity" style={{ margin: 0, fontSize: 18, color: '#0F172A' }}>
            Activity feed
          </h3>
          {activitiesLoading && (
            <span aria-live="polite" style={{ fontSize: 13, color: '#64748B' }}>
              Loading activity feed…
            </span>
          )}
          {activitiesError && !activitiesLoading && (
            <span role="status" style={{ fontSize: 13, color: '#DC2626' }}>
              {activitiesError}
            </span>
          )}
        </div>

        {activitiesLoading && activities.length === 0 ? (
          <p style={{ color: '#475569' }}>Loading activity feed…</p>
        ) : activitiesError && activities.length === 0 ? (
          <p style={{ color: '#DC2626' }}>{activitiesError}</p>
        ) : activities.length === 0 ? (
          <p style={{ color: '#475569' }}>No activity recorded yet today.</p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {activities.map(activity => {
              const meta: string[] = []
              if (activity.type) meta.push(activity.type)
              if (activity.actor) meta.push(activity.actor)
              meta.push(formatTime(activity.at))

              return (
                <li
                  key={activity.id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 14, color: '#0F172A', fontWeight: 600 }}>
                    {activity.message}
                  </span>
                  <span style={{ fontSize: 12, color: '#475569' }}>{meta.join(' • ')}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
