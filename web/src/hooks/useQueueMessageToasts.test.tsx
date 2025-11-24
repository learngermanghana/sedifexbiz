import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useQueueMessageToasts } from './useQueueMessageToasts'

const mockPublish = vi.fn()

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ publish: mockPublish }),
}))

describe('useQueueMessageToasts', () => {
  const listeners: Record<string, Array<(event: MessageEvent) => void>> = {}

  beforeEach(() => {
    mockPublish.mockReset()
    listeners.message = []
    Object.defineProperty(global.navigator, 'serviceWorker', {
      value: {
        addEventListener: (event: string, handler: (event: MessageEvent) => void) => {
          listeners[event] = listeners[event] || []
          listeners[event]!.push(handler)
        },
        removeEventListener: (event: string, handler: (event: MessageEvent) => void) => {
          listeners[event] = (listeners[event] || []).filter(existing => existing !== handler)
        },
      },
      configurable: true,
    })
  })

  it('publishes success toasts for completed queue events', () => {
    renderHook(() => useQueueMessageToasts())

    listeners.message?.forEach(handler =>
      handler({ data: { type: 'QUEUE_REQUEST_COMPLETED', requestType: 'sale' } } as MessageEvent),
    )

    expect(mockPublish).toHaveBeenCalledWith({
      message: 'Queued sale synced successfully.',
      tone: 'success',
    })
  })

  it('publishes error toasts for failed queue events', () => {
    renderHook(() => useQueueMessageToasts())

    listeners.message?.forEach(handler =>
      handler({ data: { type: 'QUEUE_REQUEST_FAILED', requestType: 'receipt', error: 'offline' } } as MessageEvent),
    )

    expect(mockPublish).toHaveBeenCalledWith({
      message: "We couldn't sync the queued stock receipt. offline",
      tone: 'error',
      duration: 8000,
    })
  })
})
