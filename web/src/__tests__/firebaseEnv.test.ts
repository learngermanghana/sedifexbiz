import { describe, expect, it } from 'vitest'
import { createFirebaseEnv } from '../config/firebaseEnv'

const baseEnv = {
  VITE_FB_API_KEY: 'api-key',
  VITE_FB_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FB_PROJECT_ID: 'demo-project',
  VITE_FB_STORAGE_BUCKET: 'demo.appspot.com',
  VITE_FB_APP_ID: 'app-id',
  VITE_FB_APP_CHECK_SITE_KEY: 'recaptcha-key',
} as Record<string, string | undefined>

describe('firebaseEnv', () => {
  it('trims whitespace when reading values', () => {
    const env = createFirebaseEnv(
      {
        ...baseEnv,
        VITE_FB_API_KEY: '  trimmed-api-key  ',
        VITE_FB_FUNCTIONS_REGION: ' europe-west1 ',
      },
      { allowDefaults: false },
    )

    expect(env.apiKey).toBe('trimmed-api-key')
    expect(env.functionsRegion).toBe('europe-west1')
  })

  it('falls back to the default functions region when not provided', () => {
    const env = createFirebaseEnv(baseEnv, { allowDefaults: false })

    expect(env.functionsRegion).toBe('us-central1')
    expect(env.appCheckSiteKey).toBe('recaptcha-key')
    expect(env.appCheckDebugToken).toBeUndefined()
  })

  it('reads the app check site key from VITE_RECAPTCHA_SITE_KEY when provided', () => {
    const env = createFirebaseEnv(
      {
        ...baseEnv,
        VITE_FB_APP_CHECK_SITE_KEY: undefined,
        VITE_RECAPTCHA_SITE_KEY: 'enterprise-site-key',
      },
      { allowDefaults: false },
    )

    expect(env.appCheckSiteKey).toBe('enterprise-site-key')
  })

  it('throws when a required value is missing', () => {
    expect(() =>
      createFirebaseEnv(
        {
          ...baseEnv,
          VITE_FB_APP_ID: undefined,
        },
        { allowDefaults: false },
      ),
    ).toThrowError(/VITE_FB_APP_ID/)
  })

  it('falls back to the deployed Firebase project when values are missing', () => {
    const env = createFirebaseEnv({})

    expect(env).toMatchObject({
      apiKey: 'AIzaSyDwqED5PminaTUDRAquyFMhSA6vroj1Ccw',
      authDomain: 'sedifex-ac2b0.firebaseapp.com',
      projectId: 'sedifex-ac2b0',
      storageBucket: 'sedifex-ac2b0.appspot.com',
      appId: '1:519571382805:web:d0f4653d62a71dfa58a41c',
      functionsRegion: 'us-central1',
      appCheckSiteKey: '6LcVMf8rAAAAAOpbzgdKCikJB7glk7slfrfHvtum',
      appCheckDebugToken: '967EB4EB-6354-494F-8C62-48F5B1F6B07F',
    })
  })

  it('reads the optional app check debug token when provided', () => {
    const env = createFirebaseEnv(
      { ...baseEnv, VITE_FB_APP_CHECK_DEBUG_TOKEN: ' debug-token ' },
      { allowDefaults: false },
    )

    expect(env.appCheckDebugToken).toBe('debug-token')
  })

  it('reads the optional app check debug token from VITE_APPCHECK_DEBUG_TOKEN when provided', () => {
    const env = createFirebaseEnv(
      {
        ...baseEnv,
        VITE_FB_APP_CHECK_DEBUG_TOKEN: undefined,
        VITE_APPCHECK_DEBUG_TOKEN: ' alt-debug-token ',
      },
      { allowDefaults: false },
    )

    expect(env.appCheckDebugToken).toBe('alt-debug-token')
  })

  it('requires explicit Firebase configuration when building for production', () => {
    expect(() =>
      createFirebaseEnv(
        {
          PROD: true,
        } as Record<string, string | boolean | undefined>,
      ),
    ).toThrowError(/VITE_FB_API_KEY/)
  })
})
