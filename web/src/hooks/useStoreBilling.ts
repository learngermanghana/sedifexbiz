// web/src/hooks/useStoreBilling.ts
import { doc, onSnapshot, db } from '../lib/db'
import { useEffect, useState } from 'react'

export function useStoreBilling(storeId?: string | null) {
  const [billing, setBilling] = useState<any>(null)
  useEffect(() => {
    if (!storeId) return
    const ref = doc(db, 'stores', storeId)
    return onSnapshot(ref, snap => setBilling(snap.data()?.billing || null))
  }, [storeId])
  return billing
}
