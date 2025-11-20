// web/src/firebase.ts
import { initializeApp } from 'firebase/app'
import { getAuth, RecaptchaVerifier } from 'firebase/auth'
import {
  initializeFirestore,
  enableIndexedDbPersistence,
  type Firestore
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

const firestoreDatabaseId =
  typeof import.meta.env.VITE_FB_DATABASE_ID === 'string' &&
  import.meta.env.VITE_FB_DATABASE_ID.trim()
    ? import.meta.env.VITE_FB_DATABASE_ID.trim()
    : 'default'

function requireEnv(key: FirebaseEnvKey): string {
  const v = import.meta.env[key]
  if (typeof v === 'string' && v.trim()) return v
  throw new Error(`[firebase] Missing ${key}. Add it to your env (local and Vercel).`)
}

const firebaseConfig = {
  apiKey: requireEnv('VITE_FB_API_KEY'),
  authDomain: requireEnv('VITE_FB_AUTH_DOMAIN'),
  projectId: requireEnv('VITE_FB_PROJECT_ID'),
  storageBucket: requireEnv('VITE_FB_STORAGE_BUCKET'),
  appId: requireEnv('VITE_FB_APP_ID')
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const storage = getStorage(app)

const FUNCTIONS_REGION =
  import.meta.env.VITE_FB_FUNCTIONS_REGION &&
  import.meta.env.VITE_FB_FUNCTIONS_REGION.trim()
    ? import.meta.env.VITE_FB_FUNCTIONS_REGION.trim()
    : 'us-central1'

export const functions = getFunctions(app, FUNCTIONS_REGION)

const FIRESTORE_SETTINGS = { ignoreUndefinedProperties: true }

export const db: Firestore = initializeFirestore(app, FIRESTORE_SETTINGS, firestoreDatabaseId)

// optional alias – keeps compatibility if we reuse old “rosterDb” imports
export const rosterDb: Firestore = db

if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch(() => {
    // ok if not available
  })
}

export function setupRecaptcha(containerId = 'recaptcha-container') {
  return new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
}
