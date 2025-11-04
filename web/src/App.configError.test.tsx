import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'

vi.mock('./firebase', () => ({
  auth: {},
}))

vi.mock('./components/ToastProvider', () => ({
  useToast: () => ({ publish: vi.fn() }),
}))

vi.mock('./controllers/sessionController', () => ({
  configureAuthPersistence: vi.fn(),
  ensureStoreDocument: vi.fn(),
  persistSession: vi.fn(),
  refreshSessionHeartbeat: vi.fn(),
}))

vi.mock('./controllers/accessController', () => ({
  initializeStore: vi.fn(),
  resolveStoreAccess: vi.fn(),
  extractCallableErrorMessage: () => 'mocked error',
  INACTIVE_WORKSPACE_MESSAGE: 'mocked inactive workspace',
}))

vi.mock('./lib/db', () => ({
  db: {},
  rosterDb: {},
  doc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(),
  Timestamp: { fromMillis: vi.fn() },
}))

vi.mock('./lib/paid', () => ({
  getPaidMarker: () => null,
  clearPaidMarker: () => {},
}))

vi.mock('./utils/activeStoreStorage', () => ({
  clearActiveStoreIdForUser: () => {},
}))

vi.mock('./config/firebaseEnv', () => {
  const error = new Error('Missing required environment variable "VITE_FB_API_KEY".')
  return {
    firebaseEnvError: error,
    firebaseEnv: {
      apiKey: 'fallback',
      authDomain: 'fallback',
      projectId: 'fallback',
      storageBucket: 'fallback',
      appId: 'fallback',
      functionsRegion: 'us-central1',
      appCheckSiteKey: 'fallback',
      appCheckDebugToken: undefined,
    },
  }
})

import App from './App'

describe('App configuration guard', () => {
  it('renders a helpful message when Firebase configuration is missing', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Sedifex is almost ready/i)).toBeVisible()
    expect(
      screen.getByText(/Contact your administrator to provide the missing Firebase environment values/i),
    ).toBeVisible()
    expect(screen.getByTestId('firebase-config-error').textContent).toContain('VITE_FB_API_KEY')
  })
})
