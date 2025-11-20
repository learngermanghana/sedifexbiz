// web/src/utils/storeId.ts
export function getStoreIdFromRecord(record: Record<string, unknown>): string | null {
  const candidates = [
    record.storeId,
    record.workspace_uid,
    record.workspaceId,
    record.ownerId
  ]

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}
