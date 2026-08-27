export type EventAuditAction = 'created' | 'updated' | 'deleted'

type RecordMap = Record<string, unknown>

const AUDIT_METADATA_FIELDS = new Set([
  'createdBy',
  'createdByType',
  'updatedBy',
  'updatedByType',
  'auditUpdatedAt',
])

function normalizeForComparison(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeForComparison)

  if (typeof value === 'object') {
    const maybeTimestamp = value as { toDate?: () => Date }
    if (typeof maybeTimestamp.toDate === 'function') {
      try {
        return maybeTimestamp.toDate().toISOString()
      } catch {
        // Fall through to a stable object comparison.
      }
    }

    return Object.keys(value as RecordMap)
      .sort()
      .reduce<RecordMap>((result, key) => {
        result[key] = normalizeForComparison((value as RecordMap)[key])
        return result
      }, {})
  }

  return value
}

function valuesEqual(left: unknown, right: unknown) {
  if (left === right) return true
  return JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
}

export function getEventAuditAction(before: RecordMap | null, after: RecordMap | null): EventAuditAction | null {
  if (!before && after) return 'created'
  if (before && after) return 'updated'
  if (before && !after) return 'deleted'
  return null
}

export function changedEventFields(before: RecordMap | null, after: RecordMap | null): string[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ])

  return [...keys]
    .filter(key => !AUDIT_METADATA_FIELDS.has(key))
    .filter(key => !valuesEqual(before?.[key], after?.[key]))
    .sort()
}

export function isAuditMetadataOnlyUpdate(before: RecordMap | null, after: RecordMap | null) {
  return getEventAuditAction(before, after) === 'updated' && changedEventFields(before, after).length === 0
}
