import type { User } from 'firebase/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/db', () => {
  const setDoc = vi.fn()
  const doc = vi.fn((_db: unknown, collection: string, id: string) => ({
    path: `${collection}/${id}`,
  }))
  const serverTimestamp = vi.fn(() => ({ __mockTimestamp: true }))

  return {
    db: {},
    rosterDb: {},
    doc,
    setDoc,
    updateDoc: vi.fn(),
    serverTimestamp,
  }
})

const { setDoc, doc, serverTimestamp } = vi.mocked(await import('../lib/db'))

const { ensureStoreDocument } = await import('./sessionController')

describe('ensureStoreDocument', () => {
  afterEach(() => {
    setDoc.mockClear()
    doc.mockClear()
    serverTimestamp.mockClear()
  })

  it('creates default store and workspace documents', async () => {
    const user = {
      uid: 'user-123',
      email: 'owner@example.com',
      displayName: 'Owner Example',
      phoneNumber: '+233501234567',
    } as unknown as User

    await ensureStoreDocument(user)

    expect(setDoc).toHaveBeenCalledTimes(2)

    const storeCall = setDoc.mock.calls.find(([ref]) => ref.path === 'stores/user-123')
    expect(storeCall).toBeTruthy()
    expect(storeCall?.[1]).toMatchObject({
      storeId: 'user-123',
      ownerUid: 'user-123',
      workspaceSlug: 'user-123',
      ownerEmail: 'owner@example.com',
      ownerPhone: '+233501234567',
      ownerName: 'Owner Example',
      paymentStatus: 'trial',
      contractStatus: 'active',
    })

    const workspaceCall = setDoc.mock.calls.find(([ref]) => ref.path === 'workspaces/user-123')
    expect(workspaceCall).toBeTruthy()
    expect(workspaceCall?.[1]).toMatchObject({
      slug: 'user-123',
      storeId: 'user-123',
      ownerId: 'user-123',
      ownerEmail: 'owner@example.com',
      ownerPhone: '+233501234567',
      ownerName: 'Owner Example',
      company: 'Owner Example',
      displayName: 'Owner Example',
      status: 'active',
      contractStatus: 'active',
      paymentStatus: 'trial',
    })
  })

  it('derives a workspace name from the email when display name is missing', async () => {
    const user = {
      uid: 'user-456',
      email: 'fresh-owner@example.com',
      displayName: null,
      phoneNumber: null,
    } as unknown as User

    await ensureStoreDocument(user)

    const workspaceCall = setDoc.mock.calls.find(([ref]) => ref.path === 'workspaces/user-456')
    expect(workspaceCall).toBeTruthy()
    expect(workspaceCall?.[1]).toMatchObject({
      company: 'Fresh Owner',
      displayName: 'Fresh Owner',
      ownerName: 'Fresh Owner',
    })
  })
})
