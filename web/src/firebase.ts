// web/src/firebase.ts
import { initializeApp } from 'firebase/app'
import { getAuth, RecaptchaVerifier } from 'firebase/auth'
import {
  initializeFirestore,
  enableIndexedDbPersistence,
  type Firestore,
} from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

type FirebaseEnvKey =
  | 'VITE_FB_API_KEY'
  | 'VITE_FB_AUTH_DOMAIN'
  | 'VITE_FB_PROJECT_ID'
  | 'VITE_FB_STORAGE_BUCKET'
  | 'VITE_FB_APP_ID'
  | 'VITE_FB_FUNCTIONS_REGION'

function requireEnv(key: FirebaseEnvKey): string {
  const v = import.meta.env[key]
  if (typeof v === 'string' && v.trim()) return v
  throw new Error(`[firebase] Missing ${key}. Add it to your env (local and Vercel).`)
}

export const firebaseConfig = {
  apiKey: requireEnv('VITE_FB_API_KEY'),
  authDomain: requireEnv('VITE_FB_AUTH_DOMAIN'),
  projectId: requireEnv('VITE_FB_PROJECT_ID'),
  storageBucket: requireEnv('VITE_FB_STORAGE_BUCKET'),
  appId: requireEnv('VITE_FB_APP_ID'),
}

// ----- Core app instances -----
export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const storage = getStorage(app)

// Region defaults to us-central1 (where your functions are deployed)
const FUNCTIONS_REGION =
  import.meta.env.VITE_FB_FUNCTIONS_REGION && import.meta.env.VITE_FB_FUNCTIONS_REGION.trim()
    ? import.meta.env.VITE_FB_FUNCTIONS_REGION.trim()
    : 'us-central1'

export const functions = getFunctions(app, FUNCTIONS_REGION)

// ----- Firestore -----
const FIRESTORE_SETTINGS = { ignoreUndefinedProperties: true }

// Default Firestore database
export const db: Firestore = initializeFirestore(app, FIRESTORE_SETTINGS)

// ----- Offline persistence (browser only) -----
if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch(() => {
    // Multi-tab or unsupported browser; safe to ignore.
  })
}

// ----- Helpers -----
export function setupRecaptcha(containerId = 'recaptcha-container') {
  // v9/v10 signature: new RecaptchaVerifier(auth, container, options)
  return new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
}
