import { triggerQueueProcessing } from './utils/offlineQueue'

// Simple service worker registration with offline queue support hooks
if ('serviceWorker' in navigator) {
  const baseUrl = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`

  window.addEventListener('load', () => {
    const swUrl = `${baseUrl}sw.js`
    navigator.serviceWorker
      .register(swUrl, { scope: baseUrl })
      .catch(error => {
        console.error('Service worker registration failed:', error)

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('service-worker-registration-error', { detail: error })
          )
          window.alert?.(
            'Offline support could not be enabled. Some features may not work until you refresh.'
          )
        }
      })
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
