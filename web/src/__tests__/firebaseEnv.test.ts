import { describe, expect, it } from 'vitest'
import { createFirebaseEnv } from '../config/firebaseEnv'

const baseEnv = {
  VITE_FB_API_KEY: 'api-key',
  VITE_FB_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FB_PROJECT_ID: 'demo-project',
  VITE_FB_STORAGE_BUCKET: 'demo.appspot.com',
  VITE_FB_APP_ID: 'app-id',
} satisfies Record<string, string | undefined>

describe('firebaseEnv', () => {
  it('trims whitespace when reading values', () => {
    const env = createFirebaseEnv({
      ...baseEnv,
      VITE_FB_API_KEY: '  trimmed-api-key  ',
      VITE_FB_FUNCTIONS_REGION: ' europe-west1 ',
    })

    expect(env.apiKey).toBe('trimmed-api-key')
    expect(env.functionsRegion).toBe('europe-west1')
  })

  it('falls back to the default functions region when not provided', () => {
    const env = createFirebaseEnv(baseEnv)

    expect(env.functionsRegion).toBe('us-central1')
  })

  it('throws when a required value is missing', () => {
    expect(() =>
      createFirebaseEnv({
        ...baseEnv,
        VITE_FB_APP_ID: undefined,
      })
    ).toThrowError(/VITE_FB_APP_ID/)
  })
})
