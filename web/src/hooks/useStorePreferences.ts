import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { CustomNavItem, Industry, INDUSTRY_ENABLED_MODULE_PRESETS, NavigationLabelPolicy } from '../config/navigation'

export type ProductDefaults = {
  defaultItemType: 'product' | 'service' | 'made_to_order'
  enableManufacturerFields: boolean
  enableNonInventoryMode: boolean
}

export type StorePreferences = {
  productDefaults: ProductDefaults
  navigation: {
    industry: Industry
    labelPolicy: NavigationLabelPolicy
    enabledModules: string[]
    dashboardModules: string[]
    primaryMetrics: string[]
    customLabels: Partial<Record<string, string>>
    customNavItems: CustomNavItem[]
    showCustomizationBanner?: boolean
    requiresIndustryReview?: boolean
  }
}

const DEFAULT_PREFERENCES: StorePreferences = {
  productDefaults: {
    defaultItemType: 'product',
    enableManufacturerFields: false,
    enableNonInventoryMode: false,
  },
  navigation: {
    industry: 'shop',
    labelPolicy: 'shared',
    // Keep the transient shell focused while the selected workspace profile loads.
    // Account is always available to owners; the saved industry preset replaces this
    // as soon as Firestore returns the store settings.
    enabledModules: ['account'],
    dashboardModules: [],
    primaryMetrics: [],
    customLabels: {},
    customNavItems: [],
  },
}

function stringListFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.reduce<string[]>((acc, item) => {
    if (typeof item === 'string' && item.trim()) acc.push(item.trim())
    return acc
  }, [])
}

function normalizeCustomNavItems(value: unknown): CustomNavItem[] {
  if (!Array.isArray(value)) return DEFAULT_PREFERENCES.navigation.customNavItems
  return (value as Record<string, unknown>[]).reduce<CustomNavItem[]>((acc, item) => {
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const type = item.type
    const target = typeof item.target === 'string' ? item.target.trim() : ''
    const sortOrder =
      typeof item.sort_order === 'number'
        ? item.sort_order
        : typeof item.sortOrder === 'number'
        ? item.sortOrder
        : 0
    const rolesAllowed = Array.isArray(item.roles_allowed)
      ? item.roles_allowed.filter(role => role === 'owner' || role === 'staff')
      : Array.isArray(item.rolesAllowed)
      ? item.rolesAllowed.filter(role => role === 'owner' || role === 'staff')
      : []

    if (!id || !label || !target || rolesAllowed.length === 0) return acc
    if (type !== 'module' && type !== 'internal' && type !== 'external') return acc

    acc.push({
      id,
      label,
      type,
      target,
      sort_order: sortOrder,
      roles_allowed: rolesAllowed as Array<'owner' | 'staff'>,
    })
    return acc
  }, [])
}

function mirrorNavigationForLegacyFields(navigation: StorePreferences['navigation']) {
  const customNavItems = Array.isArray(navigation.customNavItems) ? navigation.customNavItems : []
  const enabledModules = Array.isArray(navigation.enabledModules) ? navigation.enabledModules : []
  const dashboardModules = Array.isArray(navigation.dashboardModules) ? navigation.dashboardModules : []
  const primaryMetrics = Array.isArray(navigation.primaryMetrics) ? navigation.primaryMetrics : []

  return {
    ...navigation,
    enabledModules,
    dashboardModules,
    primaryMetrics,
    customNavItems,
    enabled_modules: enabledModules,
    visible_modules: enabledModules,
    dashboard_modules: dashboardModules,
    primary_metrics: primaryMetrics,
    custom_nav_items: customNavItems,
  }
}

function mergePreferences(raw: Record<string, unknown> | undefined | null): StorePreferences {
  const navigation = (raw?.navigation as Record<string, unknown> | undefined) ?? undefined
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

  const allowedIndustries: Industry[] = ['shop', 'travel', 'ngo', 'school', 'event']
  const explicitIndustry =
    navigation &&
    typeof navigation.industry === 'string' &&
    allowedIndustries.includes(navigation.industry as Industry)
      ? (navigation.industry as Industry)
      : null

  const usage = (navigation?.usage as Record<string, unknown> | undefined) ?? {}
  const sellUsage = typeof usage.sell === 'number' ? usage.sell : 0
  const itemsUsage = typeof usage.items === 'number' ? usage.items : 0
  const bookingsUsage = typeof usage.bookings === 'number' ? usage.bookings : 0
  const isSellHeavy = sellUsage >= 20 || itemsUsage >= 20
  const isBookingsHeavy = bookingsUsage >= 20 && !isSellHeavy
  const inferredIndustry: Industry = isSellHeavy ? 'shop' : 'shop'
  const industry = explicitIndustry ?? inferredIndustry

  const labelPolicy =
    navigation &&
    typeof navigation.labelPolicy === 'string' &&
    ['shared', 'industry_aliases'].includes(navigation.labelPolicy)
      ? (navigation.labelPolicy as NavigationLabelPolicy)
      : DEFAULT_PREFERENCES.navigation.labelPolicy

  const customLabels =
    navigation && typeof navigation.customLabels === 'object'
      ? (Object.entries(navigation.customLabels as Record<string, unknown>).reduce(
          (acc, [key, value]) => {
            if (typeof value === 'string') {
              const trimmed = value.trim()
              if (trimmed) acc[key] = trimmed
            }
            return acc
          },
          {} as Partial<Record<string, string>>,
        ) as Partial<Record<string, string>>)
      : DEFAULT_PREFERENCES.navigation.customLabels

  // Prefer the current camelCase fields saved by the Account UI. Fall back to
  // legacy snake_case fields for older workspaces/templates.
  const enabledModulesSource =
    navigation && Array.isArray(navigation.enabledModules)
      ? navigation.enabledModules
      : navigation && Array.isArray(navigation.enabled_modules)
      ? navigation.enabled_modules
      : navigation && Array.isArray(navigation.visible_modules)
      ? navigation.visible_modules
      : null

  const enabledModules =
    enabledModulesSource
      ? stringListFrom(enabledModulesSource)
      : INDUSTRY_ENABLED_MODULE_PRESETS[industry]

  const dashboardModulesSource =
    navigation && Array.isArray(navigation.dashboardModules)
      ? navigation.dashboardModules
      : navigation && Array.isArray(navigation.dashboard_modules)
      ? navigation.dashboard_modules
      : []

  const dashboardModules = stringListFrom(dashboardModulesSource)

  const primaryMetricsSource =
    navigation && Array.isArray(navigation.primaryMetrics)
      ? navigation.primaryMetrics
      : navigation && Array.isArray(navigation.primary_metrics)
      ? navigation.primary_metrics
      : []

  const primaryMetrics = stringListFrom(primaryMetricsSource)

  const customNavItemsSource =
    navigation && Array.isArray(navigation.customNavItems)
      ? navigation.customNavItems
      : navigation && Array.isArray(navigation.custom_nav_items)
      ? navigation.custom_nav_items
      : null

  const customNavItems = customNavItemsSource ? normalizeCustomNavItems(customNavItemsSource) : DEFAULT_PREFERENCES.navigation.customNavItems

  return {
    productDefaults,
    navigation: {
      industry,
      labelPolicy,
      enabledModules,
      dashboardModules,
      primaryMetrics,
      customLabels,
      customNavItems,
      showCustomizationBanner: explicitIndustry == null,
      requiresIndustryReview: isBookingsHeavy && explicitIndustry == null,
    },
  }
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
        const payload: Partial<StorePreferences> & { navigation?: unknown } = { ...changes }
        if (changes.navigation) {
          payload.navigation = mirrorNavigationForLegacyFields(changes.navigation)
        }
        await setDoc(doc(db, 'storeSettings', storeId), payload, { merge: true })
      },
    [storeId],
  )

  return { preferences, loading, updatePreferences }
}
