import { triggerQueueProcessing } from './utils/offlineQueue'

// Simple service worker registration with offline queue support hooks
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
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
