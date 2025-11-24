import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { collection, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import PageSection from '../layout/PageSection'
import { useActiveStore } from '../hooks/useActiveStore'
import { db } from '../firebase'

type DaySummary = {
  id: string
  businessDate: Date | null
  totalSales: number
  totalTax: number
  receiptCount: number
  startTime: Date | null
  endTime: Date | null
}

function formatCurrency(value: number) {
  return `GHS ${value.toFixed(2)}`
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function Reports(): ReactElement {
  const { storeId } = useActiveStore()
  const [summaries, setSummaries] = useState<DaySummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) {
      setSummaries([])
      setIsLoading(false)
      setError('Select a workspace to see your reports.')
      return () => {
        /* noop */
      }
    }

    setIsLoading(true)
    setError(null)

    const salesCollection = collection(db, 'workspaces', storeId, 'sales')
    const salesQuery = query(salesCollection, orderBy('createdAt', 'desc'))

    return onSnapshot(
      salesQuery,
      snapshot => {
        const dailySummaries = new Map<string, DaySummary>()

        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data()
          const createdAt = toDate(data.createdAt)
          const businessDate = createdAt
            ? new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate())
            : null
          const dateKey = createdAt ? formatDateKey(createdAt) : docSnap.id

          const existing = dailySummaries.get(dateKey)
          const summary: DaySummary =
            existing ?? {
              id: dateKey,
              businessDate,
              totalSales: 0,
              totalTax: 0,
              receiptCount: 0,
              startTime: createdAt,
              endTime: createdAt,
            }

          summary.totalSales += Number(data.total ?? 0) || 0
          summary.totalTax += Number(data.taxTotal ?? 0) || 0
          summary.receiptCount += 1
          if (!summary.businessDate && businessDate) summary.businessDate = businessDate

          if (createdAt) {
            if (!summary.startTime || createdAt < summary.startTime) {
              summary.startTime = createdAt
            }
            if (!summary.endTime || createdAt > summary.endTime) {
              summary.endTime = createdAt
            }
          }

          dailySummaries.set(dateKey, summary)
        })

        const rows = Array.from(dailySummaries.values()).sort((a, b) => {
          const aTime = a.businessDate?.getTime() ?? 0
          const bTime = b.businessDate?.getTime() ?? 0
          if (aTime !== bTime) return bTime - aTime
          return b.id.localeCompare(a.id)
        })

        setSummaries(rows)
        setIsLoading(false)
      },
      err => {
        console.error('[reports] Unable to load sales summaries', err)
        setError('We could not load day summaries. Please try again.')
        setIsLoading(false)
      },
    )
  }, [storeId])

  const heading = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    [],
  )

  return (
    <div className="reports-page">
      <PageSection title="Day summaries" subtitle="Review totals captured when you close the day.">
        {!storeId ? (
          <div className="empty-state" role="status" aria-live="polite">
            <h3 className="empty-state__title">Choose a workspace</h3>
            <p>You&apos;ll see past close days after selecting a workspace.</p>
          </div>
        ) : isLoading ? (
          <p>Loading summaries…</p>
        ) : error ? (
          <p style={{ color: '#b91c1c' }}>{error}</p>
        ) : summaries.length === 0 ? (
          <div className="empty-state" role="status" aria-live="polite">
            <h3 className="empty-state__title">No day summaries yet</h3>
            <p>Close the day to capture totals for reporting.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Date</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Sales</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Tax</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Receipts</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Start time</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>End time</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map(summary => {
                  const dateLabel = summary.businessDate ? heading.format(summary.businessDate) : summary.id
                  const startLabel = summary.startTime ? summary.startTime.toLocaleTimeString() : '—'
                  const endLabel = summary.endTime ? summary.endTime.toLocaleTimeString() : '—'
                  return (
                    <tr key={summary.id}>
                      <td style={{ padding: '8px 6px' }}>{dateLabel}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{formatCurrency(summary.totalSales)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{formatCurrency(summary.totalTax)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{summary.receiptCount}</td>
                      <td style={{ padding: '8px 6px' }}>{startLabel}</td>
                      <td style={{ padding: '8px 6px' }}>{endLabel}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>

      <PageSection
        title="Today"
        subtitle="Track today’s performance and quick actions."
      >
        <div className="empty-state" role="status" aria-live="polite">
          <h3 className="empty-state__title">Today’s snapshot is coming soon</h3>
          <p>
            Soon you&rsquo;ll see live sales, top products, and urgent follow-ups for the day in one convenient
            spot.
          </p>
        </div>
      </PageSection>
    </div>
  )
}
