// web/src/firebase.ts
import { initializeApp } from 'firebase/app'
import { getAuth, RecaptchaVerifier } from 'firebase/auth'
import {
  initializeFirestore,
  getFirestore,
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
  appId: requireEnv('VITE_FB_APP_ID'),
}

// --- Core app instances ---
export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const storage = getStorage(app)
// If you later add a region: getFunctions(app, import.meta.env.VITE_FB_FUNCTIONS_REGION)
export const functions = getFunctions(app)

// --- Firestore (default + secondary "roster") ---
const FIRESTORE_SETTINGS = { ignoreUndefinedProperties: true }

// Create BOTH instances with settings so they’re consistent
export const db = initializeFirestore(app, FIRESTORE_SETTINGS) // default DB
export const rosterDb: Firestore = initializeFirestore(app, FIRESTORE_SETTINGS, 'roster') // secondary DB named "roster"

// Optionally re-acquire with getFirestore if you prefer (pointing to same instances):
// export const db = getFirestore(app)
// export const rosterDb = getFirestore(app, 'roster')

// --- Offline persistence (browser-only guards) ---
if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch(() => {
    // multi-tab/unsupported; safe to ignore
  })
  enableIndexedDbPersistence(rosterDb).catch(() => {
    // same as above
  })
}

// --- Helpers ---
export function setupRecaptcha(containerId = 'recaptcha-container') {
  // v10+ signature: new RecaptchaVerifier(auth, container, options)
  return new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
}
