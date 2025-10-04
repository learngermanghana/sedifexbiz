import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionMock = vi.fn(async () => ({ data: { session: null }, error: null }))

vi.mock('../../config/supabaseEnv', () => ({
  supabaseEnv: {
    url: 'https://demo.supabase.co',
    anonKey: 'anon-test',
    functionsUrl: 'https://demo.supabase.co/functions/v1',
  },
}))

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}))

describe('offlineQueue', () => {
  const originalNavigator = globalThis.navigator
  let postMessageMock: ReturnType<typeof vi.fn>
  let queueCallableRequest: (typeof import('../offlineQueue'))['queueCallableRequest']
  let getCallableEndpoint: (typeof import('../offlineQueue'))['getCallableEndpoint']

  beforeEach(async () => {
    vi.resetModules()
    getSessionMock.mockReset()
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

    ;({ queueCallableRequest, getCallableEndpoint } = await import('../offlineQueue'))
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
    expect(firstMessage?.payload?.endpoint).toBe(
      'https://demo.supabase.co/functions/v1/processSale'
    )
  })

  it('builds callable endpoint using the configured functions region', () => {
    expect(getCallableEndpoint('generateReport')).toBe(
      'https://demo.supabase.co/functions/v1/generateReport'
    )
  })
})
