import { describe, expect, it, beforeEach } from 'vitest'

import { getActiveStoreId, loadWorkspaceProfile, mapAccount } from './loadWorkspace'

const docMock = vi.fn()
const getDocMock = vi.fn()
const collectionMock = vi.fn()
const getDocsMock = vi.fn()
const queryMock = vi.fn()
const whereMock = vi.fn()
const limitMock = vi.fn()

const mockDb = { name: 'primary-db' }
const mockRosterDb = { name: 'roster-db' }

vi.mock('../lib/db', () => ({
  doc: (...args: Parameters<typeof docMock>) => docMock(...args),
  getDoc: (...args: Parameters<typeof getDocMock>) => getDocMock(...args),
  collection: (...args: Parameters<typeof collectionMock>) => collectionMock(...args),
  getDocs: (...args: Parameters<typeof getDocsMock>) => getDocsMock(...args),
  query: (...args: Parameters<typeof queryMock>) => queryMock(...args),
  where: (...args: Parameters<typeof whereMock>) => whereMock(...args),
  limit: (...args: Parameters<typeof limitMock>) => limitMock(...args),
  db: mockDb,
  rosterDb: mockRosterDb,
}))

beforeEach(() => {
  docMock.mockReset()
  getDocMock.mockReset()
  collectionMock.mockReset()
  getDocsMock.mockReset()
  queryMock.mockReset()
  whereMock.mockReset()
  limitMock.mockReset()
})

describe('loadWorkspaceProfile', () => {
  it('returns the workspace document when loading by slug', async () => {
    docMock.mockReturnValue({ type: 'doc', path: 'workspaces/sedifex-coffee' })
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ storeId: 'store-123', company: 'Sedifex Coffee' }),
    })

    const workspace = await loadWorkspaceProfile({ slug: 'sedifex-coffee' })

    expect(docMock).toHaveBeenCalledWith(mockDb, 'workspaces', 'sedifex-coffee')
    expect(getDocMock).toHaveBeenCalled()
    expect(workspace).toEqual({ id: 'sedifex-coffee', storeId: 'store-123', company: 'Sedifex Coffee' })
  })

  it('queries by storeId when slug is not provided', async () => {
    collectionMock.mockReturnValue({ type: 'collection', path: 'workspaces' })
    whereMock.mockReturnValue({ clause: 'where-store' })
    limitMock.mockReturnValue({ clause: 'limit-1' })
    queryMock.mockReturnValue({ type: 'query' })
    getDocsMock.mockResolvedValue({
      docs: [
        {
          id: 'workspace-coffee',
          data: () => ({ storeId: 'store-123', plan: 'Monthly' }),
        },
      ],
    })

    const workspace = await loadWorkspaceProfile({ storeId: 'store-123' })

    expect(collectionMock).toHaveBeenCalledWith(mockDb, 'workspaces')
    expect(whereMock).toHaveBeenCalledWith('storeId', '==', 'store-123')
    expect(limitMock).toHaveBeenCalledWith(1)
    expect(queryMock).toHaveBeenCalledWith({ type: 'collection', path: 'workspaces' }, { clause: 'where-store' }, { clause: 'limit-1' })
    expect(workspace).toEqual({ id: 'workspace-coffee', storeId: 'store-123', plan: 'Monthly' })
  })
})

describe('mapAccount', () => {
  it('prefers contract status, billing plan, payment status, and converts timestamps to dates', () => {
    const startDate = new Date('2023-01-01T00:00:00Z')
    const endDate = new Date('2023-02-01T00:00:00Z')
    const profile = mapAccount({
      id: 'workspace-1',
      contractStatus: 'Paused',
      status: 'Active',
      billing: {
        plan: 'Pro',
        paymentStatus: 'Delinquent',
        amountPaid: 99.95,
        currency: 'USD',
      },
      subscription: { plan: 'Starter', status: 'Active' },
      contract: { start: startDate, end: endDate },
      storeId: 'store-123',
      name: 'Sedifex Coffee',
    })

    expect(profile.status).toBe('Paused')
    expect(profile.plan).toBe('Pro')
    expect(profile.paymentStatus).toBe('Delinquent')
    expect(profile.contractStart?.toISOString()).toBe(startDate.toISOString())
    expect(profile.contractEnd?.toISOString()).toBe(endDate.toISOString())
    expect(profile.amountPaid).toBeCloseTo(99.95)
    expect(profile.currency).toBe('USD')
  })

  it('falls back to amountPaid minor units when billing amount is missing', () => {
    const profile = mapAccount({
      id: 'workspace-2',
      amountPaid: 2500,
      storeId: 'store-456',
    })

    expect(profile.amountPaid).toBeCloseTo(25)
  })
})

describe('getActiveStoreId', () => {
  it('returns the trimmed storeId for the user document', async () => {
    docMock.mockReturnValue({ type: 'doc', path: 'teamMembers/user-1' })
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ storeId: ' store-789 ' }),
    })

    const storeId = await getActiveStoreId('user-1')

    expect(docMock).toHaveBeenCalledWith(mockRosterDb, 'teamMembers', 'user-1')
    expect(storeId).toBe('store-789')
  })
})
