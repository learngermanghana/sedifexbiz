import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

export type ProductDefaults = {
  defaultItemType: 'product' | 'service' | 'made_to_order'
  enableManufacturerFields: boolean
  enableNonInventoryMode: boolean
}

export type StorePreferences = {
  productDefaults: ProductDefaults
}

const DEFAULT_PREFERENCES: StorePreferences = {
  productDefaults: {
    defaultItemType: 'product',
    enableManufacturerFields: false,
    enableNonInventoryMode: false,
  },
}

function mergePreferences(raw: Record<string, unknown> | undefined | null): StorePreferences {
  const productDefaults: ProductDefaults = {
    defaultItemType:
      raw?.productDefaults &&
      typeof (raw.productDefaults as any).defaultItemType === 'string' &&
      ['product', 'service', 'made_to_order'].includes(
        (raw.productDefaults as any).defaultItemType,
      )
        ? ((raw.productDefaults as any).defaultItemType as ProductDefaults['defaultItemType'])
        : DEFAULT_PREFERENCES.productDefaults.defaultItemType,
    enableManufacturerFields:
      raw?.productDefaults?.enableManufacturerFields === true ??
      DEFAULT_PREFERENCES.productDefaults.enableManufacturerFields,
    enableNonInventoryMode:
      raw?.productDefaults?.enableNonInventoryMode === true ??
      DEFAULT_PREFERENCES.productDefaults.enableNonInventoryMode,
  }

  return { productDefaults }
}

export function useStorePreferences(storeId: string | null) {
  const [preferences, setPreferences] = useState<StorePreferences>(DEFAULT_PREFERENCES)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!storeId) {
      setPreferences(DEFAULT_PREFERENCES)
      return undefined
    }

    setLoading(true)
    const ref = doc(db, 'storeSettings', storeId)
    const unsubscribe = onSnapshot(
      ref,
      snapshot => {
        const data = snapshot.data() as Record<string, unknown> | undefined
        setPreferences(mergePreferences(data))
        setLoading(false)
      },
      () => setLoading(false),
    )

    return unsubscribe
  }, [storeId])

  const updatePreferences = useMemo(
    () =>
      async (changes: Partial<StorePreferences>) => {
        if (!storeId) return
        await setDoc(doc(db, 'storeSettings', storeId), changes, { merge: true })
      },
    [storeId],
  )

  return { preferences, loading, updatePreferences }
}
