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
  limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'
import './CloseDay.css'

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

// Recent close-day records
type CloseoutRecord = {
  id: string
  businessDay: Date | null
  salesTotal: number
  expectedCash: number
  countedCash: number
  variance: number
  looseCash: number
  cardAndDigital: number
  cashRemoved: number
  cashAdded: number
  closedAt: Date | null
  closedByName: string
}

export default function CloseDay() {
  const user = useAuthUser()
  const { storeId: activeStoreId } = useActiveStore()

  const [total, setTotal] = useState(0)
  const [cashCounts, setCashCounts] = useState<CashCountState>(() =>
    createInitialCashCountState(),
  )
  const [looseCash, setLooseCash] = useState('')
  const [cashRemoved, setCashRemoved] = useState('')
  const [cashAdded, setCashAdded] = useState('')
  const [notes, setNotes] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // auto-calculated non-cash payments (card / momo / transfers)
  const [autoNonCashTotal, setAutoNonCashTotal] = useState(0)

  // recent close-day records
  const [recentCloseouts, setRecentCloseouts] = useState<CloseoutRecord[]>([])
  const [closeoutsError, setCloseoutsError] = useState<string | null>(null)
  const [isLoadingCloseouts, setIsLoadingCloseouts] = useState(false)

  // which saved closeout we want to show / print
  const [selectedCloseout, setSelectedCloseout] = useState<CloseoutRecord | null>(
    null,
  )

  // Load today's sales total for this store + auto non-cash total
  useEffect(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)

    if (!activeStoreId) {
      setTotal(0)
      setAutoNonCashTotal(0)
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
      let nonCashSum = 0

      snap.forEach(d => {
        const data = d.data() as any

        // Total
        const saleTotal =
          typeof data.total === 'number'
            ? data.total
            : typeof data.totals?.total === 'number'
              ? data.totals.total
              : 0

        sum += Number(saleTotal) || 0

        // 🔍 payment.tenders: sum all non-cash amounts
        const tenders = Array.isArray(data.payment?.tenders)
          ? data.payment.tenders
          : []

        for (const tender of tenders) {
          const amount = Number(tender?.amount) || 0
          const method = (tender?.method || '').toLowerCase()
          if (amount > 0 && method && method !== 'cash') {
            nonCashSum += amount
          }
        }
      })

      setTotal(sum)
      setAutoNonCashTotal(nonCashSum)
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

  // load last 10 close-day records
  useEffect(() => {
    if (!activeStoreId) {
      setRecentCloseouts([])
      setSelectedCloseout(null)
      setCloseoutsError(null)
      return () => {
        /* noop */
      }
    }

    setIsLoadingCloseouts(true)

    const q = query(
      collection(db, 'closeouts'),
      where('storeId', '==', activeStoreId),
      orderBy('businessDay', 'desc'),
      limit(10),
    )

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const rows: CloseoutRecord[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data() as any
          const bd =
            data.businessDay instanceof Timestamp
              ? data.businessDay.toDate()
              : null
          const ca =
            data.closedAt instanceof Timestamp ? data.closedAt.toDate() : null
          const closedBy = data.closedBy || {}
          const closedByName =
            (typeof closedBy.displayName === 'string' && closedBy.displayName) ||
            (typeof closedBy.email === 'string' && closedBy.email) ||
            'Unknown'

          return {
            id: docSnap.id,
            businessDay: bd,
            salesTotal: Number(data.salesTotal ?? 0) || 0,
            expectedCash: Number(data.expectedCash ?? 0) || 0,
            countedCash: Number(data.countedCash ?? 0) || 0,
            variance: Number(data.variance ?? 0) || 0,
            looseCash: Number(data.looseCash ?? 0) || 0,
            cardAndDigital: Number(data.cardAndDigital ?? 0) || 0,
            cashRemoved: Number(data.cashRemoved ?? 0) || 0,
            cashAdded: Number(data.cashAdded ?? 0) || 0,
            closedAt: ca,
            closedByName,
          }
        })

        setRecentCloseouts(rows)
        setCloseoutsError(null)
        setIsLoadingCloseouts(false)

        // default selected: keep current if still in list, otherwise latest
        setSelectedCloseout(prev => {
          if (prev) {
            const stillThere = rows.find(r => r.id === prev.id)
            if (stillThere) return stillThere
          }
          return rows[0] ?? null
        })
      },
      error => {
        console.error('[close-day] Failed to load recent closeouts', error)
        setCloseoutsError('Unable to load recent close-day records.')
        setIsLoadingCloseouts(false)
      },
    )

    return () => unsubscribe()
  }, [activeStoreId])

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

  const removedTotal = useMemo(
    () => parseCurrency(cashRemoved),
    [cashRemoved],
  )
  const addedTotal = useMemo(
    () => parseCurrency(cashAdded),
    [cashAdded],
  )

  // cardTotal is now 100% auto from today's sales (non-cash payments)
  const cardTotal = autoNonCashTotal

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
    // We just print the page. The selected closeout summary section below
    // is visible in print mode, so it will appear on the paper.
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
        const data = docSnap.data() as any
        const saleTotal =
          typeof data.total === 'number'
            ? data.total
            : typeof data.totals?.total === 'number'
              ? data.totals.total
              : 0
        const saleTax =
          Number(data.taxTotal ?? data.totals?.taxTotal ?? 0) || 0
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

      const closedByName =
        (user?.displayName && user.displayName.trim()) ||
        (user?.email && user.email.trim()) ||
        'Unknown'

      const closePayload = {
        businessDay: Timestamp.fromDate(start),
        salesTotal: totalSales,
        expectedCash,
        countedCash,
        variance,
        looseCash: looseCashTotal,
        cardAndDigital: cardTotal, // numeric non-cash total (card + momo + others)
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

      const closeDocRef = await addDoc(collection(db, 'closeouts'), closePayload)

      // Optimistically select the freshly saved close-out for printing so the
      // PDF/print view is never empty while we wait for Firestore to sync.
      const optimisticCloseout: CloseoutRecord = {
        id: closeDocRef.id,
        businessDay: start,
        salesTotal: totalSales,
        expectedCash,
        countedCash,
        variance,
        looseCash: looseCashTotal,
        cardAndDigital: cardTotal,
        cashRemoved: removedTotal,
        cashAdded: addedTotal,
        closedAt: new Date(),
        closedByName,
      }

      setSelectedCloseout(optimisticCloseout)
      setRecentCloseouts(prev => [optimisticCloseout, ...prev].slice(0, 10))

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

      // Auto-print after save – this will now also include the new row
      // in the "Recent close day records" and the print summary.
      window.setTimeout(() => {
        try {
          window.print()
        } catch (e) {
          console.warn('[close-day] Auto-print failed', e)
        }
      }, 250)
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

      {/* Simple English helper */}
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
          <li>Check that today’s sales total looks correct.</li>
          <li>
            We automatically add all <strong>card / mobile money / transfer</strong> sales
            from today. You only type the <strong>cash in the drawer</strong> and any cash
            you took out or added.
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
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span>Card / mobile money / transfers (auto from today’s sales)</span>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid #CBD5F5',
                  background: '#F9FAFB',
                  fontSize: 14,
                }}
              >
                GHS {cardTotal.toFixed(2)}
              </div>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                This is money customers paid by card or mobile money. It is not inside the
                cash drawer. If it looks wrong, fix the payment method on the Sell page
                receipts.
              </span>
            </div>
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
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                Any cash you removed from the drawer today. Example: bank deposit, paying a
                supplier, staff payout.
              </span>
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
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                Extra cash you added to the drawer that did not come from today’s sales. For
                example: the owner adds float from the safe so you have more change.
              </span>
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
            We compare what the system expects with what you counted in the drawer. Card /
            mobile money / transfers are pulled automatically from today’s sales.
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
            Close day record saved successfully. Printing summary…
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

      {/* Recent close-day records */}
      <section style={{ marginTop: 40 }}>
        <h3 style={{ marginBottom: 8 }}>Recent close day records</h3>
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 14, color: '#4b5563' }}>
          Last 10 days that were closed for this workspace. Click a row to select which one
          you want to print below.
        </p>

        {isLoadingCloseouts && <p>Loading recent records…</p>}
        {closeoutsError && (
          <p style={{ color: '#b91c1c' }}>{closeoutsError}</p>
        )}
        {!isLoadingCloseouts && !closeoutsError && recentCloseouts.length === 0 && (
          <p>No previous close day records yet.</p>
        )}

        {!isLoadingCloseouts && !closeoutsError && recentCloseouts.length > 0 && (
          <div className="close-day__closeouts">
            <table className="close-day__table">
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Business day
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Sales total
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Expected cash
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Counted cash
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Difference
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Closed by
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #d1d5db',
                      padding: '6px 4px',
                    }}
                  >
                    Closed at
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentCloseouts.map(close => {
                  const diffLabel =
                    Math.abs(close.variance) < 0.01
                      ? 'Matches'
                      : close.variance < 0
                        ? 'Short'
                        : 'Over'
                  const diffColor =
                    Math.abs(close.variance) < 0.01
                      ? '#047857'
                      : Math.abs(close.variance) > LARGE_DIFFERENCE_THRESHOLD
                        ? '#b91c1c'
                        : '#92400e'

                  const isSelected = selectedCloseout?.id === close.id

                  return (
                    <tr
                      key={close.id}
                      onClick={() => setSelectedCloseout(close)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isSelected
                          ? 'rgba(67,56,202,0.06)'
                          : 'transparent',
                      }}
                    >
                      <td style={{ padding: '6px 4px' }}>
                        {close.businessDay
                          ? close.businessDay.toLocaleDateString()
                          : 'Unknown'}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        GHS {close.salesTotal.toFixed(2)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        GHS {close.expectedCash.toFixed(2)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        GHS {close.countedCash.toFixed(2)}
                      </td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                        <span style={{ color: diffColor }}>
                          GHS {close.variance.toFixed(2)} · {diffLabel}
                        </span>
                      </td>
                      <td style={{ padding: '6px 4px' }}>{close.closedByName}</td>
                      <td style={{ padding: '6px 4px' }}>
                        {close.closedAt ? close.closedAt.toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="close-day__cards">
              {recentCloseouts.map(close => {
                const diffLabel =
                  Math.abs(close.variance) < 0.01
                    ? 'Matches'
                    : close.variance < 0
                      ? 'Short'
                      : 'Over'
                const diffColor =
                  Math.abs(close.variance) < 0.01
                    ? '#047857'
                    : Math.abs(close.variance) > LARGE_DIFFERENCE_THRESHOLD
                      ? '#b91c1c'
                      : '#92400e'

                const isSelected = selectedCloseout?.id === close.id

                return (
                  <button
                    key={close.id}
                    type="button"
                    onClick={() => setSelectedCloseout(close)}
                    className="close-day__card"
                    style={{
                      borderColor: isSelected ? 'rgba(67,56,202,0.6)' : '#e5e7eb',
                      backgroundColor: isSelected
                        ? 'rgba(67,56,202,0.06)'
                        : 'white',
                    }}
                  >
                    <div className="close-day__card-row">
                      <span>Business day</span>
                      <strong>
                        {close.businessDay
                          ? close.businessDay.toLocaleDateString()
                          : 'Unknown'}
                      </strong>
                    </div>
                    <div className="close-day__card-row">
                      <span>Sales total</span>
                      <strong>GHS {close.salesTotal.toFixed(2)}</strong>
                    </div>
                    <div className="close-day__card-row">
                      <span>Expected cash</span>
                      <strong>GHS {close.expectedCash.toFixed(2)}</strong>
                    </div>
                    <div className="close-day__card-row">
                      <span>Counted cash</span>
                      <strong>GHS {close.countedCash.toFixed(2)}</strong>
                    </div>
                    <div className="close-day__card-row">
                      <span>Difference</span>
                      <strong style={{ color: diffColor }}>
                        GHS {close.variance.toFixed(2)} · {diffLabel}
                      </strong>
                    </div>
                    <div className="close-day__card-row">
                      <span>Closed by</span>
                      <strong>{close.closedByName}</strong>
                    </div>
                    <div className="close-day__card-row">
                      <span>Closed at</span>
                      <strong>
                        {close.closedAt ? close.closedAt.toLocaleString() : '—'}
                      </strong>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* Print summary for the selected closeout – this is what will always show on paper */}
      {selectedCloseout && (
        <section style={{ marginTop: 32 }}>
          <h3 style={{ marginBottom: 8 }}>Close day summary for print</h3>
          <p style={{ marginTop: 0, fontSize: 14, color: '#4b5563' }}>
            This section uses saved data from the <strong>closeouts</strong> collection.
            When you print, this is the “receipt” your partners or manager will see.
          </p>

          <div style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Business day</span>
              <strong>
                {selectedCloseout.businessDay
                  ? selectedCloseout.businessDay.toLocaleDateString()
                  : 'Unknown'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sales total</span>
              <strong>GHS {selectedCloseout.salesTotal.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Non-cash payments</span>
              <strong>GHS {selectedCloseout.cardAndDigital.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Cash taken out</span>
              <strong>GHS {selectedCloseout.cashRemoved.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Cash put in drawer</span>
              <strong>GHS {selectedCloseout.cashAdded.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Expected cash in drawer</span>
              <strong>GHS {selectedCloseout.expectedCash.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Cash counted</span>
              <strong>GHS {selectedCloseout.countedCash.toFixed(2)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Difference</span>
              <strong>
                GHS {selectedCloseout.variance.toFixed(2)}{' '}
                {Math.abs(selectedCloseout.variance) < 0.01
                  ? '(Matches)'
                  : selectedCloseout.variance < 0
                    ? '(Short)'
                    : '(Over)'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Closed by</span>
              <strong>{selectedCloseout.closedByName}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Closed at</span>
              <strong>
                {selectedCloseout.closedAt
                  ? selectedCloseout.closedAt.toLocaleString()
                  : '—'}
              </strong>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
