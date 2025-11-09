import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_INTERVAL_MS = 5_000
const DEFAULT_INTERVAL_MS = 60_000

type UseAutoRerunOptions = {
  /**
   * How often to automatically trigger reruns (in milliseconds).
   * Values below 5 seconds are clamped to avoid excessive polling.
   */
  intervalMs?: number
}

export function useAutoRerun(isEnabled: boolean, options?: UseAutoRerunOptions) {
  const [token, setToken] = useState(0)
  const isActiveRef = useRef(true)

  useEffect(() => {
    isActiveRef.current = true
    return () => {
      isActiveRef.current = false
    }
  }, [])

  const intervalMs = Math.max(MIN_INTERVAL_MS, options?.intervalMs ?? DEFAULT_INTERVAL_MS)

  const trigger = useCallback(() => {
    if (!isActiveRef.current || !isEnabled) {
      return
    }
    setToken(prev => prev + 1)
  }, [isEnabled])

  useEffect(() => {
    if (!isEnabled) {
      return undefined
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined
    }

    const handleOnline = () => {
      trigger()
    }

    const handleVisibility = () => {
      if (!('visibilityState' in document) || document.visibilityState === 'visible') {
        trigger()
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)

    const intervalId = window.setInterval(trigger, intervalMs)

    return () => {
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(intervalId)
    }
  }, [intervalMs, isEnabled, trigger])

  return { token, trigger }
}
