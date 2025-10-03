import { supabaseEnv } from '../config/supabaseEnv'
import { supabase } from '../supabaseClient'

const FUNCTIONS_BASE_URL = supabaseEnv.functionsUrl

const SYNC_TAG = 'sync-pending-requests'

export type QueueRequestType = 'sale' | 'receipt'

type QueueMessage = {
  type: 'QUEUE_BACKGROUND_REQUEST'
  payload: {
    requestType: QueueRequestType
    endpoint: string
    payload: unknown
    authToken: string | null
    createdAt: number
  }
}

type ProcessMessage = { type: 'PROCESS_QUEUE_NOW' }

function getController(registration: ServiceWorkerRegistration) {
  return registration.active ?? registration.waiting ?? registration.installing ?? null
}

export function getCallableEndpoint(functionName: string) {
  if (!FUNCTIONS_BASE_URL) {
    throw new Error('Missing Supabase function configuration')
  }
  const normalized = functionName.replace(/^\/+/, '').trim()
  if (!normalized) {
    throw new Error('Function name is required')
  }
  return `${FUNCTIONS_BASE_URL}/${normalized}`
}

export async function queueCallableRequest(
  functionName: string,
  payload: unknown,
  requestType: QueueRequestType
) {
  if (!('serviceWorker' in navigator)) {
    return false
  }

  try {
    const registration = await navigator.serviceWorker.ready
    const controller = getController(registration)
    if (!controller) {
      return false
    }

    let authToken: string | null = null
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        throw error
      }
      authToken = data?.session?.access_token ?? null
    } catch (error) {
      console.warn('[offline-queue] Unable to read auth token for queued request', error)
    }

    const message: QueueMessage = {
      type: 'QUEUE_BACKGROUND_REQUEST',
      payload: {
        requestType,
        endpoint: getCallableEndpoint(functionName),
        payload,
        authToken,
        createdAt: Date.now(),
      },
    }

    controller.postMessage(message)

    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync
    if (syncManager) {
      try {
        await syncManager.register(SYNC_TAG)
      } catch (error) {
        console.warn('[offline-queue] Background sync registration failed', error)
        controller.postMessage({ type: 'PROCESS_QUEUE_NOW' } satisfies ProcessMessage)
      }
    } else {
      controller.postMessage({ type: 'PROCESS_QUEUE_NOW' } satisfies ProcessMessage)
    }

    return true
  } catch (error) {
    console.error('[offline-queue] Failed to queue request for background processing', error)
    return false
  }
}

export async function triggerQueueProcessing() {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    const controller = getController(registration)
    controller?.postMessage({ type: 'PROCESS_QUEUE_NOW' } satisfies ProcessMessage)
    const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync
    if (syncManager) {
      try {
        await syncManager.register(SYNC_TAG)
      } catch (error) {
        console.warn('[offline-queue] Unable to schedule sync on demand', error)
      }
    }
  } catch (error) {
    console.warn('[offline-queue] Unable to trigger queue processing', error)
  }
}
