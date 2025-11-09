import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getIdTokenMock = vi.fn(async () => 'test-token')

vi.mock('../../config/firebaseEnv', () => ({
  firebaseEnv: {
    apiKey: 'demo-api-key',
    authDomain: 'demo.firebaseapp.com',
    projectId: 'demo-project',
    storageBucket: 'demo.appspot.com',
    appId: 'demo-app-id',
    functionsRegion: 'us-central1',
    appCheckSiteKey: 'recaptcha-key',
  },
}))

vi.mock('../../firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: getIdTokenMock,
    },
  },
}))

describe('offlineQueue', () => {
  const originalNavigator = globalThis.navigator
  let postMessageMock: ReturnType<typeof vi.fn>
  let messageListeners: Set<(event: MessageEvent) => void>
  let queueCallableRequest: (typeof import('../offlineQueue'))['queueCallableRequest']
  let getCallableEndpoint: (typeof import('../offlineQueue'))['getCallableEndpoint']
  let subscribeToQueue: (typeof import('../offlineQueue'))['subscribeToQueue']
  let requestQueueStatus: (typeof import('../offlineQueue'))['requestQueueStatus']
  let addEventListenerMock: ReturnType<typeof vi.fn>
  let removeEventListenerMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    getIdTokenMock.mockClear()
    postMessageMock = vi.fn()
    messageListeners = new Set()
    addEventListenerMock = vi.fn((event: string, listener: EventListener) => {
      if (event === 'message') {
        messageListeners.add(listener as unknown as (event: MessageEvent) => void)
      }
    })
    removeEventListenerMock = vi.fn((event: string, listener: EventListener) => {
      if (event === 'message') {
        messageListeners.delete(listener as unknown as (event: MessageEvent) => void)
      }
    })
    const registration = {
      active: { postMessage: postMessageMock },
    }

    const serviceWorker = {
      ready: Promise.resolve(registration),
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
    } as unknown as ServiceWorkerContainer

    Object.defineProperty(globalThis, 'navigator', {
      value: { serviceWorker } as Navigator,
      configurable: true,
      writable: true,
    })

    ;({
      queueCallableRequest,
      getCallableEndpoint,
      subscribeToQueue,
      requestQueueStatus,
    } = await import('../offlineQueue'))
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
    expect(firstMessage?.payload?.authToken).toBe('test-token')
    expect(getIdTokenMock).toHaveBeenCalledTimes(1)
    expect(firstMessage?.payload?.endpoint).toBe(
      'https://us-central1-demo-project.cloudfunctions.net/processSale'
    )
  })

  it('builds callable endpoint using the configured functions region', () => {
    expect(getCallableEndpoint('generateReport')).toBe(
      'https://us-central1-demo-project.cloudfunctions.net/generateReport'
    )
  })

  it('notifies subscribers when queue status updates arrive', async () => {
    const events: unknown[] = []

    const unsubscribe = subscribeToQueue(event => {
      events.push(event)
    })

    expect(addEventListenerMock).toHaveBeenCalledWith('message', expect.any(Function))
    const [listener] = Array.from(messageListeners)
    expect(listener).toBeDefined()

    listener?.call(navigator.serviceWorker as ServiceWorkerContainer, {
      data: { type: 'QUEUE_STATUS', status: 'processing', pending: 2, error: 'Boom' },
    } as MessageEvent)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'status',
      status: 'processing',
      pending: 2,
      error: 'Boom',
    })

    unsubscribe()
    expect(removeEventListenerMock).toHaveBeenCalledWith('message', expect.any(Function))
  })

  it('requests queue status from the active service worker controller', async () => {
    const requested = await requestQueueStatus()
    expect(requested).toBe(true)
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'REQUEST_QUEUE_STATUS' })
  })
})
