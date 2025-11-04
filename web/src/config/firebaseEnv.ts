// web/src/config/firebaseEnv.ts
import runtimeEnv from './runtimeEnv'

const requiredEnvKeys = [
  'VITE_FB_API_KEY',
  'VITE_FB_AUTH_DOMAIN',
  'VITE_FB_PROJECT_ID',
  'VITE_FB_STORAGE_BUCKET',
  'VITE_FB_APP_ID',
] as const

const appCheckSiteKeyEnvKeys = [
  'VITE_FB_APP_CHECK_SITE_KEY',
  'VITE_RECAPTCHA_SITE_KEY',
] as const

const appCheckDebugTokenEnvKeys = [
  'VITE_FB_APP_CHECK_DEBUG_TOKEN',
  'VITE_APPCHECK_DEBUG_TOKEN',
] as const

const defaultFirebaseEnv: Record<string, string | undefined> = {
  VITE_FB_API_KEY: 'AIzaSyDwqED5PminaTUDRAquyFMhSA6vroj1Ccw',
  VITE_FB_AUTH_DOMAIN: 'sedifex-ac2b0.firebaseapp.com',
  VITE_FB_PROJECT_ID: 'sedifex-ac2b0',
  VITE_FB_STORAGE_BUCKET: 'sedifex-ac2b0.appspot.com',
  VITE_FB_APP_ID: '1:519571382805:web:d0f4653d62a71dfa58a41c',
  VITE_FB_FUNCTIONS_REGION: 'us-central1',
  // Default to your Enterprise site key
  VITE_FB_APP_CHECK_SITE_KEY: '6LcVMf8rAAAAAOpbzgdKCikJB7glk7sIfrfHvtum',
  VITE_RECAPTCHA_SITE_KEY: '6LcVMf8rAAAAAOpbzgdKCikJB7glk7sIfrfHvtum',
  VITE_FB_APP_CHECK_DEBUG_TOKEN: undefined,
  VITE_APPCHECK_DEBUG_TOKEN: undefined,
}

type RequiredFirebaseEnvKey = (typeof requiredEnvKeys)[number]

export type FirebaseEnvConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  appId: string
  functionsRegion: string
  appCheckSiteKey: string
  appCheckDebugToken?: string
}

type EnvSource = Record<string, string | boolean | undefined>
type GetRequiredEnvOptions = { allowDefaults: boolean }

// … keep your existing getRequiredEnv / createFirebaseEnv logic,
// but ensure it picks the site key and debug token from those arrays:
