import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { collection, onSnapshot, orderBy, query, where, type Timestamp } from 'firebase/firestore'
import PageSection from '../layout/PageSection'
import { useActiveStore } from '../hooks/useActiveStore'
import { db } from '../firebase'

type DaySummary = {
  id: string
  businessDate: Date | null
  totalSales: number
  totalTax: number
  totalDiscount: number
  receiptCount: number
  startTime: Date | null
  endTime: Date | null
  noteCount: number
  notes: string[]
}

function formatCurrency(value: number) {
  return `GHS ${value.toFixed(2)}`
}

function parseDateFromId(id: string): Date | null {
  const maybeDate = id.split('_')[1]
  if (!maybeDate || maybeDate.length !== 8) return null
  const year = Number(maybeDate.slice(0, 4))
  const month = Number(maybeDate.slice(4, 6))
  const day = Number(maybeDate.slice(6, 8))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(year, month - 1, day)
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
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

    const q = query(
      collection(db, 'daySummaries'),
      where('storeId', '==', storeId),
      orderBy('businessDate', 'desc'),
    )

    return onSnapshot(
      q,
      snapshot => {
        const rows: DaySummary[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data()
          const businessDate = toDate(data.businessDate) ?? parseDateFromId(docSnap.id)
          const noteSamplesRaw = Array.isArray((data as any)?.noteSamples)
            ? (data as any).noteSamples
            : []
          const noteSamples = noteSamplesRaw
            .map((entry: any) => {
              if (typeof entry === 'string') return entry
              if (entry && typeof entry.note === 'string') return entry.note
              return ''
            })
            .filter(Boolean)
          return {
            id: docSnap.id,
            businessDate,
            totalSales: Number(data.totalSales ?? 0) || 0,
            totalTax: Number(data.totalTax ?? 0) || 0,
            totalDiscount: Number((data as any)?.totalDiscount ?? 0) || 0,
            receiptCount: Number(data.receiptCount ?? 0) || 0,
            startTime: toDate(data.startTime),
            endTime: toDate(data.endTime),
            noteCount: Number((data as any)?.noteCount ?? noteSamples.length) || 0,
            notes: noteSamples,
          }
        })
        setSummaries(rows)
        setIsLoading(false)
      },
      err => {
        console.error('[reports] Unable to load day summaries', err)
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
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Discounts</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Receipts</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Start time</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>End time</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #d1d5db', padding: '8px 6px' }}>Notes</th>
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
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{formatCurrency(summary.totalDiscount)}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>{summary.receiptCount}</td>
                        <td style={{ padding: '8px 6px' }}>{startLabel}</td>
                        <td style={{ padding: '8px 6px' }}>{endLabel}</td>
                        <td style={{ padding: '8px 6px' }}>
                          {summary.noteCount > 0 ? `${summary.noteCount} note${summary.noteCount === 1 ? '' : 's'}` : '—'}
                          {summary.notes.length > 0 && (
                            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                              {summary.notes.join(' • ')}
                            </div>
                          )}
                        </td>
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
