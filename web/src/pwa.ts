import { triggerQueueProcessing } from './utils/offlineQueue'
import runtimeEnv from './config/runtimeEnv'

// Simple service worker registration with offline queue support hooks
if ('serviceWorker' in navigator) {
  const rawBaseUrl = typeof runtimeEnv.BASE_URL === 'string' ? runtimeEnv.BASE_URL : '/'
  const baseUrl = rawBaseUrl.endsWith('/') ? rawBaseUrl : `${rawBaseUrl}/`

  let hasScheduledReload = false
  const monitoredRegistrations = new WeakSet<ServiceWorkerRegistration>()

  function requestImmediateActivation(registration: ServiceWorkerRegistration | undefined) {
    if (!registration || !navigator.serviceWorker.controller) return
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  }

  function monitorRegistration(registration: ServiceWorkerRegistration) {
    if (monitoredRegistrations.has(registration)) {
      requestImmediateActivation(registration)
      return
    }

    monitoredRegistrations.add(registration)
    requestImmediateActivation(registration)

    registration.addEventListener('updatefound', () => {
      const installingWorker = registration.installing
      if (!installingWorker) return

      installingWorker.addEventListener('statechange', () => {
        if (installingWorker.state === 'installed') {
          requestImmediateActivation(registration)
        }
      })
    })
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hasScheduledReload) return
    hasScheduledReload = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    const swUrl = `${baseUrl}sw.js`
    navigator.serviceWorker
      .register(swUrl, { scope: baseUrl })
      .then(registration => monitorRegistration(registration))
      .catch(error => {
        console.warn('[sw] Registration failed', error)
      })
  })

  navigator.serviceWorker.ready
    .then(registration => monitorRegistration(registration))
    .catch(error => {
      console.warn('[sw] Ready rejected', error)
    })

  window.addEventListener('online', () => {
    triggerQueueProcessing()
  })

  navigator.serviceWorker.addEventListener('message', event => {
    const data = event.data
    if (!data || typeof data !== 'object') return

    if (data.type === 'QUEUE_PROCESSING_REQUIRED' && navigator.onLine) {
      triggerQueueProcessing()
    }
  })
}
