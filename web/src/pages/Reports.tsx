import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './Reports.css'

type DaySummary = {
  dateKey: string
  date: Date
  totalSales: number
  totalTax: number
  receiptCount: number
  firstSaleAt: Date | null
  lastSaleAt: Date | null
}

// ... toDate / formatDate / formatTime / formatCurrency unchanged ...

export default function Today() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const [summaries, setSummaries] = useState<DaySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!storeId) {
      setSummaries([])
      setLoadError(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    setLoadError(null)

    const salesRef = collection(db, 'sales')

    // 🔴 OLD – requires composite index and was throwing:
    // const q = query(
    //   salesRef,
    //   where('storeId', '==', storeId),
    //   orderBy('createdAt', 'desc'),
    // )

    // ✅ NEW – filter only, sort later in memory
    const q = query(salesRef, where('storeId', '==', storeId))

    const unsubscribe = onSnapshot(
      q,
      (snapshot: QuerySnapshot<DocumentData>) => {
        if (cancelled) return

        const byDate = new Map<string, DaySummary>()

        snapshot.forEach(docSnap => {
          const data = docSnap.data() || {}
          const createdAt = toDate(data.createdAt)
          if (!createdAt) return

          const total =
            typeof data.total === 'number' && Number.isFinite(data.total)
              ? data.total
              : 0
          const taxTotal =
            typeof data.taxTotal === 'number' && Number.isFinite(data.taxTotal)
              ? data.taxTotal
              : 0

          const dateOnly = new Date(
            createdAt.getFullYear(),
            createdAt.getMonth(),
            createdAt.getDate(),
          )
          const dateKey = dateOnly.toISOString().slice(0, 10)

          let existing = byDate.get(dateKey)
          if (!existing) {
            existing = {
              dateKey,
              date: dateOnly,
              totalSales: 0,
              totalTax: 0,
              receiptCount: 0,
              firstSaleAt: createdAt,
              lastSaleAt: createdAt,
            }
            byDate.set(dateKey, existing)
          }

          existing.totalSales += total
          existing.totalTax += taxTotal
          existing.receiptCount += 1

          if (!existing.firstSaleAt || createdAt < existing.firstSaleAt) {
            existing.firstSaleAt = createdAt
          }
          if (!existing.lastSaleAt || createdAt > existing.lastSaleAt) {
            existing.lastSaleAt = createdAt
          }
        })

        // still sorting here – no change
        const rows = Array.from(byDate.values()).sort(
          (a, b) => b.date.getTime() - a.date.getTime(),
        )

        setSummaries(rows)
        setLoading(false)
        setLoadError(null)
      },
      error => {
        console.error('[reports] Failed to subscribe to sales', error)
        if (cancelled) return
        setLoading(false)
        setSummaries([])
        setLoadError(
          'We could not load today’s summary. Please try again.',
        )
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [storeId])

  const todaySummary = useMemo(
    () =>
      summaries.find(
        s => s.dateKey === new Date().toISOString().slice(0, 10),
      ) ?? null,
    [summaries],
  )

  // …rest of the component unchanged …
}
