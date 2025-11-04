import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  requestQueueStatus,
  subscribeToQueue,
  type QueueEvent,
  type QueueStatusEvent,
  type QueueStatusValue,
} from '../utils/offlineQueue'

import runtimeEnv from '../config/runtimeEnv'

const HEARTBEAT_URL = runtimeEnv.VITE_HEARTBEAT_URL ?? '/heartbeat.json'
const DEFAULT_HEARTBEAT_INTERVAL = 30_000

type QueueState = {
  status: QueueStatusValue
  pending: number
  lastError: string | null
  updatedAt: number | null
}

type ConnectivityState = {
  isOnline: boolean
  isReachable: boolean
  isChecking: boolean
  lastHeartbeatAt: number | null
  heartbeatError: string | null
  queue: QueueState
}

export type ConnectivitySnapshot = ConnectivityState & {
  checkHeartbeat: () => Promise<void>
}

export function useConnectivityStatus(intervalMs = DEFAULT_HEARTBEAT_INTERVAL): ConnectivitySnapshot {
  const [state, setState] = useState<ConnectivityState>(() => ({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isReachable: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isChecking: false,
    lastHeartbeatAt: null,
    heartbeatError: null,
    queue: {
      status: 'idle',
      pending: 0,
      lastError: null,
      updatedAt: null,
    },
  }))
  const isMountedRef = useRef(true)

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const heartbeatUrl = HEARTBEAT_URL
  const interval = Math.max(5_000, intervalMs)

  const runHeartbeat = useCallback(async () => {
    const now = Date.now()
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true

    if (!isMountedRef.current) return

    if (!online) {
      setState(prev => ({
        ...prev,
        isOnline: false,
        isReachable: false,
        isChecking: false,
        heartbeatError: null,
        lastHeartbeatAt: now,
      }))
      return
    }

    setState(prev => ({
      ...prev,
      isOnline: true,
      isChecking: true,
    }))

    try {
      const response = await fetch(`${heartbeatUrl}?ts=${Date.now()}`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      if (!isMountedRef.current) return

      setState(prev => ({
        ...prev,
        isReachable: true,
        isChecking: false,
        heartbeatError: null,
        lastHeartbeatAt: Date.now(),
      }))
    } catch (error) {
      if (!isMountedRef.current) return

      setState(prev => ({
        ...prev,
        isReachable: false,
        isChecking: false,
        heartbeatError: error instanceof Error ? error.message : 'Heartbeat failed',
        lastHeartbeatAt: Date.now(),
      }))
    }
  }, [heartbeatUrl])

  useEffect(() => {
    void runHeartbeat()
    const timer = window.setInterval(() => {
      void runHeartbeat()
    }, interval)

    return () => {
      window.clearInterval(timer)
    }
  }, [interval, runHeartbeat])

  useEffect(() => {
    function handleOnline() {
      setState(prev => ({
        ...prev,
        isOnline: true,
      }))
      void runHeartbeat()
    }

    function handleOffline() {
      const now = Date.now()
      setState(prev => ({
        ...prev,
        isOnline: false,
        isReachable: false,
        isChecking: false,
        heartbeatError: null,
        lastHeartbeatAt: now,
      }))
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [runHeartbeat])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void runHeartbeat()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [runHeartbeat])

  useEffect(() => {
    function updateQueueFromStatus(event: QueueStatusEvent) {
      setState(prev => ({
        ...prev,
        queue: {
          status: event.status,
          pending: event.pending,
          lastError: event.error,
          updatedAt: event.timestamp,
        },
      }))
    }

    function handleQueueEvent(event: QueueEvent) {
      if (event.type === 'status') {
        updateQueueFromStatus(event)
        return
      }

      setState(prev => ({
        ...prev,
        queue: {
          ...prev.queue,
          lastError:
            event.type === 'request-failed'
              ? event.error ?? prev.queue.lastError
              : prev.queue.lastError,
          updatedAt: event.timestamp,
        },
      }))

      if (event.type === 'request-complete' || event.type === 'request-failed') {
        void requestQueueStatus()
      }
    }

    const unsubscribe = subscribeToQueue(handleQueueEvent)
    void requestQueueStatus()

    return () => {
      unsubscribe()
    }
  }, [])

  return useMemo(
    () => ({
      ...state,
      checkHeartbeat: runHeartbeat,
    }),
    [state, runHeartbeat]
  )
}
