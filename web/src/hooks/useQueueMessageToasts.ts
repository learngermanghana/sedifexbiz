import { useEffect } from 'react'
import { useToast } from '../components/ToastProvider'

export type QueueRequestType = 'sale' | 'receipt'

type QueueCompletedMessage = {
  type: 'QUEUE_REQUEST_COMPLETED'
  requestType?: unknown
}

type QueueFailedMessage = {
  type: 'QUEUE_REQUEST_FAILED'
  requestType?: unknown
  error?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isQueueRequestType(value: unknown): value is QueueRequestType {
  return value === 'sale' || value === 'receipt'
}

function getQueueRequestLabel(requestType: unknown): string {
  if (!isQueueRequestType(requestType)) return 'request'
  return requestType === 'receipt' ? 'stock receipt' : 'sale'
}

function isQueueCompletedMessage(value: unknown): value is QueueCompletedMessage {
  return isRecord(value) && (value as any).type === 'QUEUE_REQUEST_COMPLETED'
}

function isQueueFailedMessage(value: unknown): value is QueueFailedMessage {
  return isRecord(value) && (value as any).type === 'QUEUE_REQUEST_FAILED'
}

function normalizeQueueError(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

export function getQueueToastPayload(data: unknown) {
  if (isQueueCompletedMessage(data)) {
    const label = getQueueRequestLabel(data.requestType)
    return { message: `Queued ${label} synced successfully.`, tone: 'success' as const }
  }

  if (isQueueFailedMessage(data)) {
    const label = getQueueRequestLabel(data.requestType)
    const detail = normalizeQueueError(data.error)
    return {
      message: detail
        ? `We couldn't sync the queued ${label}. ${detail}`
        : `We couldn't sync the queued ${label}. Please try again.`,
      tone: 'error' as const,
      duration: 8000,
    }
  }

  return null
}

export function useQueueMessageToasts() {
  const { publish } = useToast()

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const handleMessage = (event: MessageEvent) => {
      const toastProps = getQueueToastPayload(event.data)
      if (toastProps) publish(toastProps)
    }

    navigator.serviceWorker.addEventListener('message', handleMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage)
  }, [publish])
}
