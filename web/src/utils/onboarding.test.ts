import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchOnboardingStatus } from './onboarding'

const storage: Record<string, string> = {}

const mockDoc = vi.fn()
const mockGetDoc = vi.fn()

vi.mock('../firebase', () => ({
  db: { __type: 'mockDb' },
}))

vi.mock('firebase/firestore', () => ({
  doc: (...args: Parameters<typeof mockDoc>) => mockDoc(...args),
  getDoc: (...args: Parameters<typeof mockGetDoc>) => mockGetDoc(...args),
  serverTimestamp: () => ({ __type: 'serverTimestamp' }),
}))

describe('fetchOnboardingStatus', () => {
  beforeEach(() => {
    mockDoc.mockReset()
    mockGetDoc.mockReset()

    Object.keys(storage).forEach(key => delete storage[key])

    globalThis.window = {
      localStorage: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => {
          storage[key] = value
        },
        removeItem: (key: string) => {
          delete storage[key]
        },
      },
    } as unknown as Window & typeof globalThis
  })

  it('marks staff onboarding as completed without forcing owner flow', async () => {
    mockGetDoc.mockResolvedValue({ data: () => ({ role: 'staff' }) })

    const status = await fetchOnboardingStatus('staff-123')

    expect(status).toBe('completed')
    expect(storage['sedifex.onboarding.status.staff-123']).toBe('completed')
  })
})
