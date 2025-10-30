import { auth } from '../firebase'
import { firebaseEnv } from '../config/firebaseEnv'

const FUNCTIONS_REGION = firebaseEnv.functionsRegion
const PROJECT_ID = firebaseEnv.projectId

const SYNC_TAG = 'sync-pending-requests'

export type QueueRequestType = 'sale' | 'receipt' | (string & {})

export type QueueStatusValue = 'idle' | 'pending' | 'processing' | 'error'

export type QueueStatusEvent = {
  type: 'status'
  status: QueueStatusValue
  pending: number
  error: string | null
  timestamp: number
}

export type QueueRequestCompletedEvent = {
  type: 'request-complete'
  requestType: QueueRequestType
  timestamp: number
}

export type QueueRequestFailedEvent = {
  type: 'request-failed'
  requestType: QueueRequestType
  error: string | null
  timestamp: number
}

export type QueueEvent = QueueStatusEvent | QueueRequestCompletedEvent | QueueRequestFailedEvent

type QueueStatusMessage = {
  type?: unknown
  status?: unknown
  pending?: unknown
  error?: unknown
}

type QueueRequestResultMessage = {
  type?: unknown
  requestType?: unknown
  error?: unknown
}

const QUEUE_STATUS_MESSAGE_TYPE = 'QUEUE_STATUS'
const QUEUE_REQUEST_COMPLETED_MESSAGE = 'QUEUE_REQUEST_COMPLETED'
const QUEUE_REQUEST_FAILED_MESSAGE = 'QUEUE_REQUEST_FAILED'
const REQUEST_QUEUE_STATUS_MESSAGE = 'REQUEST_QUEUE_STATUS'

const queueListeners = new Set<(event: QueueEvent) => void>()
let isMonitoringQueue = false
let lastKnownStatusEvent: QueueStatusEvent | null = null
let serviceWorkerMessageHandler: ((this: ServiceWorkerContainer, event: MessageEvent) => void) | null = null

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

function normalizeQueueStatus(value: unknown): QueueStatusValue {
  if (value === 'processing' || value === 'pending' || value === 'error') {
    return value
  }
  return 'idle'
}

function normalizeQueuePending(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }
  return 0
}

function isValidRequestType(value: unknown): value is QueueRequestType {
  return typeof value === 'string' && value.trim().length > 0
}

function dispatchQueueEvent(event: QueueEvent) {
  queueListeners.forEach(listener => {
    try {
      listener(event)
    } catch (error) {
      console.warn('[offline-queue] Queue listener failed', error)
    }
  })
}

function parseQueueStatusEvent(data: unknown): QueueStatusEvent | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const message = data as QueueStatusMessage
  if (message.type !== QUEUE_STATUS_MESSAGE_TYPE) {
    return null
  }

  const pending = normalizeQueuePending(message.pending)
  const status = normalizeQueueStatus(message.status)
  const effectiveStatus: QueueStatusValue = pending === 0 && status !== 'error' ? 'idle' : status

  const rawError = typeof message.error === 'string' && message.error.trim().length > 0 ? message.error.trim() : null

  return {
    type: 'status',
    status: effectiveStatus,
    pending,
    error: effectiveStatus === 'error' ? rawError : null,
    timestamp: Date.now(),
  }
}

function parseQueueRequestCompletedEvent(data: unknown): QueueRequestCompletedEvent | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const message = data as QueueRequestResultMessage
  if (message.type !== QUEUE_REQUEST_COMPLETED_MESSAGE || !isValidRequestType(message.requestType)) {
    return null
  }

  return {
    type: 'request-complete',
    requestType: message.requestType,
    timestamp: Date.now(),
  }
}

function parseQueueRequestFailedEvent(data: unknown): QueueRequestFailedEvent | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const message = data as QueueRequestResultMessage
  if (message.type !== QUEUE_REQUEST_FAILED_MESSAGE || !isValidRequestType(message.requestType)) {
    return null
  }

  const error = typeof message.error === 'string' && message.error.trim().length > 0 ? message.error.trim() : null

  return {
    type: 'request-failed',
    requestType: message.requestType,
    error,
    timestamp: Date.now(),
  }
}

function handleServiceWorkerMessage(this: ServiceWorkerContainer, event: MessageEvent) {
  const statusEvent = parseQueueStatusEvent(event.data)
  if (statusEvent) {
    lastKnownStatusEvent = statusEvent
    dispatchQueueEvent(statusEvent)
    return
  }

  const completedEvent = parseQueueRequestCompletedEvent(event.data)
  if (completedEvent) {
    dispatchQueueEvent(completedEvent)
    return
  }

  const failedEvent = parseQueueRequestFailedEvent(event.data)
  if (failedEvent) {
    dispatchQueueEvent(failedEvent)
  }
}

function ensureQueueMonitoring() {
  if (isMonitoringQueue) {
    return
  }

  if (!('serviceWorker' in navigator)) {
    return
  }

  const container = navigator.serviceWorker
  if (!container || typeof container.addEventListener !== 'function') {
    return
  }

  serviceWorkerMessageHandler = handleServiceWorkerMessage
  container.addEventListener('message', serviceWorkerMessageHandler)
  isMonitoringQueue = true
}

function teardownQueueMonitoring() {
  if (!isMonitoringQueue) {
    return
  }

  if (!('serviceWorker' in navigator)) {
    return
  }

  const container = navigator.serviceWorker
  if (!container || typeof container.removeEventListener !== 'function' || !serviceWorkerMessageHandler) {
    return
  }

  container.removeEventListener('message', serviceWorkerMessageHandler)
  serviceWorkerMessageHandler = null
  isMonitoringQueue = false
}

export function getCallableEndpoint(functionName: string) {
  if (!PROJECT_ID) {
    throw new Error('Missing Firebase project configuration')
  }
  return `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`
}

export function subscribeToQueue(listener: (event: QueueEvent) => void) {
  if (!('serviceWorker' in navigator)) {
    return () => {}
  }

  ensureQueueMonitoring()
  queueListeners.add(listener)

  if (lastKnownStatusEvent) {
    // Provide the freshest snapshot immediately to new listeners.
    try {
      listener(lastKnownStatusEvent)
    } catch (error) {
      console.warn('[offline-queue] Queue listener failed', error)
    }
  }

  return () => {
    queueListeners.delete(listener)
    if (queueListeners.size === 0) {
      teardownQueueMonitoring()
    }
  }
}

export async function requestQueueStatus() {
  if (!('serviceWorker' in navigator)) {
    return false
  }

  ensureQueueMonitoring()

  try {
    const registration = await navigator.serviceWorker.ready
    const controller = getController(registration)
    if (!controller) {
      return false
    }

    controller.postMessage({ type: REQUEST_QUEUE_STATUS_MESSAGE })
    return true
  } catch (error) {
    console.warn('[offline-queue] Unable to request queue status', error)
    return false
  }
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
      authToken = await auth.currentUser?.getIdToken() ?? null
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
        controller.postMessage({ type: 'PROCESS_QUEUE_NOW' } as ProcessMessage)
      }
    } else {
      controller.postMessage({ type: 'PROCESS_QUEUE_NOW' } as ProcessMessage)
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
    controller?.postMessage({ type: 'PROCESS_QUEUE_NOW' } as ProcessMessage)
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
