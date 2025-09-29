import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../firebase', () => ({
  auth: { currentUser: null },
}))

describe('offlineQueue', () => {
  const originalNavigator = globalThis.navigator
  let postMessageMock: ReturnType<typeof vi.fn>
  let queueCallableRequest: (typeof import('../offlineQueue'))['queueCallableRequest']

  beforeEach(async () => {
    vi.resetModules()
    postMessageMock = vi.fn()
    const registration = {
      active: { postMessage: postMessageMock },
    }

    const serviceWorker = {
      ready: Promise.resolve(registration),
    }

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker } as Navigator,
      configurable: true,
      writable: true,
    })

    Object.assign(import.meta.env, {
      VITE_FB_PROJECT_ID: 'demo-project',
      VITE_FB_FUNCTIONS_REGION: 'us-central1',
    })

    ;({ queueCallableRequest } = await import('../offlineQueue'))
  })

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).navigator
    }
  })

  it('queues sale request with the correct request type', async () => {
    const queued = await queueCallableRequest('processSale', { total: 100 }, 'sale')

    expect(queued).toBe(true)
    const firstMessage = postMessageMock.mock.calls[0]?.[0]
    expect(firstMessage?.payload?.requestType).toBe('sale')
  })
})
