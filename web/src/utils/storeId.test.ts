import { describe, expect, it } from 'vitest'

import { getStoreIdFromRecord } from './storeId'

describe('getStoreIdFromRecord', () => {
  it('returns null when the record is missing or empty', () => {
    expect(getStoreIdFromRecord(undefined)).toBeNull()
    expect(getStoreIdFromRecord({})).toBeNull()
  })

  it('prefers storeId when present', () => {
    expect(getStoreIdFromRecord({ storeId: ' store-123 ' })).toBe('store-123')
  })

  it('falls back to legacy workspace_uid fields', () => {
    expect(getStoreIdFromRecord({ workspace_uid: 'legacy-store' })).toBe('legacy-store')
    expect(getStoreIdFromRecord({ workspaceUid: 'legacy-store-2' })).toBe('legacy-store-2')
  })

  it('checks other historical field names', () => {
    expect(getStoreIdFromRecord({ storeID: 'STORE-ID' })).toBe('STORE-ID')
    expect(getStoreIdFromRecord({ store_id: 'store_id' })).toBe('store_id')
    expect(getStoreIdFromRecord({ workspaceSlug: 'slugged' })).toBe('slugged')
    expect(getStoreIdFromRecord({ workspaceId: 'id-123' })).toBe('id-123')
    expect(getStoreIdFromRecord({ workspace_id: 'id-456' })).toBe('id-456')
  })
})
