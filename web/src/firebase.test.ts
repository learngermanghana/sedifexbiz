import { describe, expect, beforeEach, vi } from 'vitest'

// Mock Firebase SDK modules to avoid real network initialization
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'app' })),
}))

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ auth: true })),
  RecaptchaVerifier: vi.fn(function RecaptchaVerifier() {
    return { widgetId: 'mock-recaptcha' }
  }),
}))

vi.mock('firebase/firestore', () => ({
  initializeFirestore: vi.fn(() => ({ firestore: true })),
  enableIndexedDbPersistence: vi.fn(() => Promise.resolve()),
}))

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({ functions: true })),
}))

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({ storage: true })),
}))

describe('firebase configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_FB_API_KEY', 'test-api-key')
    vi.stubEnv('VITE_FB_AUTH_DOMAIN', 'auth.example.com')
    vi.stubEnv('VITE_FB_PROJECT_ID', 'project-123')
    vi.stubEnv('VITE_FB_STORAGE_BUCKET', 'bucket-123')
    vi.stubEnv('VITE_FB_APP_ID', 'app-123')
    vi.stubEnv('VITE_FB_FUNCTIONS_REGION', 'us-test-1')
  })

  it('aliases rosterDb to the default Firestore database', async () => {
    const firebase = await import('./firebase')

    expect(firebase.rosterDb).toBe(firebase.db)
  })
})
