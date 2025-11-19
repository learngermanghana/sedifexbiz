// web/src/utils/storeId.ts

function normalizeCandidate(candidate: unknown): string | null {
  if (typeof candidate !== 'string') {
    return null
  }

  const trimmed = candidate.trim()
  return trimmed ? trimmed : null
}

/**
 * Accept the many historical shapes we have used for the workspace/store id
 * when reading membership documents. The default case is `storeId`, but
 * older documents may store it as `workspace_uid` or other variations.
 */
export function getStoreIdFromRecord(record: Record<string, unknown> | undefined): string | null {
  if (!record) {
    return null
  }

  const candidates = [
    record.storeId,
    record.storeID,
    record.store_id,
    record.workspaceSlug,
    record.workspaceId,
    record.workspace_id,
    record.workspaceUid,
    record.workspace_uid,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate)
    if (normalized) {
      return normalized
    }
  }

  return null
}
