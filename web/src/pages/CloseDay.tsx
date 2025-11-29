// web/src/pages/CloseDay.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  addDoc,
  serverTimestamp,
  getDocs,
  setDoc,
  doc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'

const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1] as const

// How big a difference before we show a strong warning + require a note
const LARGE_DIFFERENCE_THRESHOLD = 20 // GHS 20

type CashCountState = Record<string, string>

function createInitialCashCountState(): CashCountState {
  return DENOMINATIONS.reduce<CashCountState>((acc, denom) => {
    acc[String(denom)] = ''
    return acc
  }, {})
}

// 🔧 More robust currency parser (accepts string | number | null | undefined)
function parseCurrency(input: string | number | null | undefined): number {
  if (input === null || input === undefined) return 0
  const normalized = String(input).replace(/[^0-9.-]/g, '')
  if (!normalized) return 0
  const value = Number.parseFloat(normalized)
  return Number.isFinite(value) ? value : 0
}

function parseQuantity(input: string): number {
  if (!input) return 0
  const normalized = input.replace(/[^0-9]/g, '')
  const value = Number.parseInt(normalized, 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function getDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

export default function CloseDay() {
  const user = useAuthUser()
  const { storeId: activeStoreId } = useActiveStore()

  const [total, setTotal] = useState(0)
  const [cashCounts, setCashCounts] = useState<CashCountState>(() =>
    createInitialCashCountState(),
  )
  const [looseCash, setLooseCash] = useState('')
  const [cardAndDigital, setCardAndDigital] = useState('')
  const [cashRemoved, setCashRemoved] = useState('')
  const [cashAdded, setCashAdded] = useState('')
  const [notes, setNotes] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Load today's sales total for this store
  useEffect(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    if (!activeStoreId) {
      setTotal(0)
      return () => {
        /* noop */
      }
    }

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', activeStoreId),
      where('createdAt', '>=', Timestamp.fromDate(start)),
      orderBy('createdAt', 'desc'),
    )

    return onSnapshot(q, snap => {
      let sum = 0
      snap.forEach(d => {
        const data = d.data()
        const saleTotal =
          typeof data.total === 'number'
            ? data.total
            : typeof data.totals?.total === 'number'
              ? data.totals.total
              : 0
        sum += Number(saleTotal) || 0
      })
      setTotal(sum)
    })
  }, [activeStoreId])

  // Print CSS (hide buttons when printing)
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent =
      '@media print { .no-print { display: none !important; } .print-summary { max-width: 100% !important; } }'
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  const looseCashTotal = useMemo(
    () => parseCurrency(looseCash),
    [looseCash],
  )

  const countedCash = useMemo(() => {
    return (
      DENOMINATIONS.reduce((sum, denom) => {
        const count = parseQuantity(cashCounts[String(denom)])
        return sum + denom * count
      }, 0) + looseCashTotal
    )
  }, [cashCounts, looseCashTotal])

  const cardTotal = useMemo(
    () => parseCurrency(cardAndDigital),
    [cardAndDigital],
  )
  const removedTotal = useMemo(
    () => parseCurrency(cashRemoved),
    [cashRemoved],
  )
  const addedTotal = useMemo(
    () => parseCurrency(cashAdded),
    [cashAdded],
  )

  // Expected physical cash = all sales - non-cash payments - cash taken out + cash added
  const expectedCash = useMemo(() => {
    const computed = total - cardTotal - removedTotal + addedTotal
    return Number.isFinite(computed) ? computed : 0
  }, [addedTotal, cardTotal, removedTotal, total])

  const variance = useMemo(
    () => countedCash - expectedCash,
    [countedCash, expectedCash],
  )

  const differenceLabel =
    Math.abs(variance) < 0.01
      ? 'Matches'
      : variance < 0
        ? 'Short (missing cash)'
        : 'Over (extra cash)'

  const isLargeDifference =
    Math.abs(variance) > LARGE_DIFFERENCE_THRESHOLD + 0.009

  const handleCountChange = (denom: number, value: string) => {
    setCashCounts(prev => ({ ...prev, [String(denom)]: value }))
  }

  const handlePrint = () => {
    window.print()
  }

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async event => {
    event.preventDefault()
    setSubmitError(null)
    setSubmitSuccess(false)
    setIsSubmitting(true)

    try {
      if (!activeStoreId) {
        throw new Error('Select a workspace before recording a close-out.')
      }

      // If difference is large, require a note
      if (isLargeDifference && !notes.trim()) {
        throw new Error(
          'The difference is large. Please add a short note explaining what happened before saving.',
        )
      }

      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)

      const salesQuery = query(
        collection(db, 'sales'),
        where('storeId', '==', activeStoreId),
        where('createdAt', '>=', Timestamp.fromDate(start)),
        where('createdAt', '<', Timestamp.fromDate(end)),
        orderBy('createdAt', 'asc'),
      )

      const salesSnapshot = await getDocs(salesQuery)

      let totalSales = 0
      let totalTax = 0
      let receiptCount = 0
      let startTime: Timestamp | null = null
      let endTime: Timestamp | null = null
      const cashierBreakdown: Record<
        string,
        { receiptCount: number; totalSales: number; totalTax: number }
      > = {}

      salesSnapshot.forEach(docSnap => {
        const data = docSnap.data()
        const saleTotal =
          typeof data.total === 'number'
            ? data.total
            : typeof data.totals?.total === 'number'
              ? data.totals.total
              : 0
        const saleTax = Number(data.taxTotal ?? 0) || 0
        totalSales += Number(saleTotal) || 0
        totalTax += saleTax
        receiptCount += 1

        const createdAt =
          data.createdAt instanceof Timestamp ? data.createdAt : null
        if (createdAt) {
          const millis = createdAt.toMillis()
          if (!startTime || millis < startTime.toMillis()) startTime = createdAt
          if (!endTime || millis > endTime.toMillis()) endTime = createdAt
        }

        const cashierIdRaw =
          typeof data.cashierId === 'string' ? data.cashierId.trim() : ''
        const cashierId =
          cashierIdRaw ||
          (typeof data.createdBy === 'string' ? data.createdBy : '') ||
          'unknown'
        const entry =
          cashierBreakdown[cashierId] ?? {
            receiptCount: 0,
            totalSales: 0,
            totalTax: 0,
          }
        entry.receiptCount += 1
        entry.totalSales += Number(saleTotal) || 0
        entry.totalTax += saleTax
        cashierBreakdown[cashierId] = entry
      })

      const daySummaryId = `${activeStoreId}_${getDayKey(start)}`
      const daySummaryRef = doc(db, 'daySummaries', daySummaryId)
      const summaryPayload: Record<string, unknown> = {
        storeId: activeStoreId,
        businessDate: Timestamp.fromDate(start),
        totalSales,
        totalTax,
        receiptCount,
        startTime,
        endTime,
        updatedAt: serverTimestamp(),
      }

      if (Object.keys(cashierBreakdown).length > 0) {
        summaryPayload.cashierBreakdown = cashierBreakdown
      }

      await setDoc(daySummaryRef, summaryPayload, { merge: true })

      const closePayload = {
        businessDay: Timestamp.fromDate(start),
        salesTotal: totalSales,
        expectedCash,
        countedCash,
        variance,
        looseCash: looseCashTotal,
        cardAndDigital: cardTotal,
        cashRemoved: removedTotal,
        cashAdded: addedTotal,
        denominations: DENOMINATIONS.map(denom => {
          const quantity = parseQuantity(cashCounts[String(denom)])
          return {
            denomination: denom,
            quantity,
            subtotal: denom * quantity,
          }
        }),
        notes: notes.trim() || null,
        closedBy: user
          ? {
              uid: user.uid,
              displayName: user.displayName || null,
              email: user.email || null,
            }
          : null,
        closedAt: serverTimestamp(),
        storeId: activeStoreId,
      }

      await addDoc(collection(db, 'closeouts'), closePayload)

      const actor = user?.displayName || user?.email || 'Team member'
      try {
        await addDoc(collection(db, 'activity'), {
          storeId: activeStoreId,
          type: 'task',
          summary: `Closed day ${getDayKey(start)}`,
          detail: `Difference: GHS ${variance.toFixed(
            2,
          )} · Cash counted: GHS ${countedCash.toFixed(2)}`,
          actor,
          createdAt: serverTimestamp(),
        })
      } catch (activityError) {
        console.warn('[activity] Failed to log close day', activityError)
      }

      setSubmitSuccess(true)
      setCashCounts(createInitialCashCountState())
      setLooseCash('')
      setCardAndDigital('')
      setCashRemoved('')
      setCashAdded('')
      setNotes('')
    } catch (error: any) {
      console.error('[close-day] Failed to record closeout', error)
      const message =
        typeof error?.message === 'string'
          ? error.message
          : 'We were unable to save the close day record. Please retry.'
      setSubmitError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="print-summary" style={{ maxWidth: 760 }}>
      <h2 style={{ color: '#4338CA' }}>Close Day</h2>

      <div
        className="no-print"
        style={{
          marginTop: 12,
          padding: '12px 14px',
          background: '#EEF2FF',
          border: '1px solid #C7D2FE',
          borderRadius: 8,
          display: 'grid',
          gap: 6,
        }}
      >
        <strong>How to use this page</strong>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: 'grid',
            gap: 4,
          }}
        >
          <li>Confirm the sales total is correct for today.</li>
          <li>
            Enter card / mobile money / transfers and any cash taken out or added –
            these numbers change the expected cash below.
          </li>
          <li>Count each note and coin, add loose cash, then review the cash check.</li>
          <li>Add notes for the next shift, then save and print the summary.</li>
        </ul>
      </div>

      <form onSubmit={handleSubmit}>
        <section style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Sales Summary</h3>
          <p style={{ marginBottom: 8 }}>Today’s total sales (cash + card + momo)</p>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              marginBottom: 16,
            }}
          >
            GHS {total.toFixed(2)}
          </div>
          <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span>Card / mobile money / transfers</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={cardAndDigital}
                onChange={event => setCardAndDigital(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span>Cash taken out (e.g. bank deposit, payouts)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={cashRemoved}
                onChange={event => setCashRemoved(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span>Cash put in drawer (float top-up)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={cashAdded}
                onChange={event => setCashAdded(event.target.value)}
                placeholder="0.00"
              />
            </label>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h3 style={{ marginBottom: 12 }}>Cash Count</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Denomination
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Quantity
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {DENOMINATIONS.map(denom => {
                  const key = String(denom)
                  const quantity = parseQuantity(cashCounts[key])
                  const subtotal = denom * quantity
                  return (
                    <tr key={key}>
                      <td style={{ padding: '6px 4px' }}>
                        GHS {denom.toFixed(denom % 1 === 0 ? 0 : 2)}
                      </td>
                      <td style={{ padding: '6px 4px' }}>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step="1"
                          value={cashCounts[key]}
                          onChange={event =>
                            handleCountChange(denom, event.target.value)
                          }
                          style={{ width: '100%' }}
                        />
                      </td>
                      <td
                        style={{
                          padding: '6px 4px',
                          textAlign: 'right',
                        }}
                      >
                        GHS {subtotal.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: '6px 4px' }}>Loose cash / coins</td>
                  <td style={{ padding: '6px 4px' }} colSpan={2}>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={looseCash}
                      onChange={event => setLooseCash(event.target.value)}
                      style={{ width: '100%' }}
                      placeholder="0.00"
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section style={{ marginTop: 32 }}>
          <h3 style={{ marginBottom: 8 }}>Cash check</h3>
          <p
            style={{
              marginTop: 0,
              marginBottom: 8,
              fontSize: 14,
              color: '#4b5563',
            }}
          >
            We compare what the system expects with what you counted in the drawer.
            Card / mobile money / transfers reduce the expected cash.
          </p>
          <div style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Non-cash payments (card / momo / transfers)</span>
              <strong>GHS {cardTotal.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Expected cash in drawer</span>
              <strong>GHS {expectedCash.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Cash you counted</span>
              <strong>GHS {countedCash.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Difference</span>
              <strong
                style={{
                  color:
                    Math.abs(variance) > 0.009 ? '#b91c1c' : '#047857',
                }}
              >
                GHS {variance.toFixed(2)} · {differenceLabel}
              </strong>
            </div>
          </div>

          {/* Traffic light style status */}
          <p
            style={{
              marginTop: 8,
              fontSize: 14,
              color:
                Math.abs(variance) < 0.01
                  ? '#047857'
                  : isLargeDifference
                    ? '#b91c1c'
                    : '#92400e',
            }}
          >
            {Math.abs(variance) < 0.01 &&
              '✅ All good – your cash matches the system.'}
            {Math.abs(variance) >= 0.01 && !isLargeDifference && (
              <>⚠️ Small difference. Please double-check the drawer and amounts.</>
            )}
            {isLargeDifference && (
              <>
                ⚠️ Large difference. You must add a note explaining what happened before
                saving.
              </>
            )}
          </p>
        </section>

        <section style={{ marginTop: 32 }}>
          <h3 style={{ marginBottom: 8 }}>Notes</h3>
          <textarea
            value={notes}
            onChange={event => setNotes(event.target.value)}
            rows={4}
            style={{ width: '100%', resize: 'vertical' }}
            placeholder={
              isLargeDifference
                ? 'Large difference – explain what happened (e.g. payout, mistake, cash left in safe)...'
                : 'Include context for differences or reminders for the next shift.'
            }
          />
        </section>

        {submitError && (
          <p style={{ color: '#b91c1c', marginTop: 16 }}>{submitError}</p>
        )}
        {submitSuccess && (
          <p style={{ color: '#047857', marginTop: 16 }}>
            Close day record saved successfully.
          </p>
        )}

        <div
          className="no-print"
          style={{ display: 'flex', gap: 12, marginTop: 24 }}
        >
          <button
            type="button"
            onClick={handlePrint}
            style={{ padding: '10px 16px' }}
          >
            Print summary
          </button>
          <button
            type="submit"
            style={{
              padding: '10px 16px',
              background: '#4338CA',
              color: 'white',
              border: 'none',
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Save close day record'}
          </button>
        </div>
      </form>
    </div>
  )
}
