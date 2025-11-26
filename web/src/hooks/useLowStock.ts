import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'

import { db } from '../firebase'
import { useActiveStore } from './useActiveStore'
import { PRODUCT_CACHE_LIMIT } from '../utils/offlineCache'

type LowStockProduct = {
  id: string
  name: string
  sku: string | null
  stockCount: number
  reorderLevel: number
  storeId?: string | null
}

type UseLowStockResult = {
  lowStock: LowStockProduct[]
  topLowStock: LowStockProduct[]
  isLoading: boolean
  error: string | null
}

function sanitizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

export function useLowStock(topCount = 5): UseLowStockResult {
  const { storeId } = useActiveStore()
  const [lowStock, setLowStock] = useState<LowStockProduct[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) {
      setLowStock([])
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)

    const productsQuery = query(
      collection(db, 'products'),
      where('storeId', '==', storeId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(PRODUCT_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(
      productsQuery,
      snapshot => {
        if (cancelled) return

        setError(null)

        const products = snapshot.docs
          .map(docSnap => {
            const data = docSnap.data() as Record<string, unknown>
            const stockCount = sanitizeNumber(data.stockCount)
            const reorderLevel = sanitizeNumber(
              data.reorderLevel ?? data.reorderThreshold ?? null,
            )

            return {
              id: docSnap.id,
              name: typeof data.name === 'string' ? data.name : 'Unknown product',
              sku: typeof data.sku === 'string' ? data.sku : null,
              stockCount: stockCount ?? 0,
              reorderLevel: reorderLevel ?? -1,
              storeId,
            }
          })
          .filter(product => product.reorderLevel >= 0 && product.stockCount <= product.reorderLevel)

        setLowStock(products)
        setIsLoading(false)
      },
      subscriptionError => {
        if (cancelled) return
        setError('Unable to load low stock products right now. Try again shortly.')
        console.error('[useLowStock] subscription error', subscriptionError)
        setIsLoading(false)
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [storeId])

  const sortedLowStock = useMemo(() => {
    return [...lowStock].sort((a, b) => {
      const aGap = a.stockCount - a.reorderLevel
      const bGap = b.stockCount - b.reorderLevel
      if (aGap === bGap) {
        return a.reorderLevel - b.reorderLevel
      }
      return aGap - bGap
    })
  }, [lowStock])

  const topLowStock = useMemo(() => {
    return sortedLowStock.slice(0, topCount)
  }, [sortedLowStock, topCount])

  return {
    lowStock: sortedLowStock,
    topLowStock,
    isLoading,
    error,
  }
}

export type { LowStockProduct }
