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

type FirebaseRosterEnvKey =
  | 'VITE_FB_ROSTER_API_KEY'
  | 'VITE_FB_ROSTER_AUTH_DOMAIN'
  | 'VITE_FB_ROSTER_PROJECT_ID'
  | 'VITE_FB_ROSTER_STORAGE_BUCKET'
  | 'VITE_FB_ROSTER_APP_ID'

const env = import.meta.env as Record<string, string | undefined>

function requireEnv(key: FirebaseEnvKey): string {
  const v = env[key]
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed) return trimmed
  }
  throw new Error(`[firebase] Missing ${key}. Add it to your env (local and Vercel).`)
}

function envWithFallback(
  rosterKey: FirebaseRosterEnvKey,
  defaultKey: FirebaseEnvKey,
): string {
  const rosterValue = env[rosterKey]
  if (typeof rosterValue === 'string') {
    const trimmed = rosterValue.trim()
    if (trimmed) return trimmed
  }
  return requireEnv(defaultKey)
}

const firebaseConfig = {
  apiKey: requireEnv('VITE_FB_API_KEY'),
  authDomain: requireEnv('VITE_FB_AUTH_DOMAIN'),
  projectId: requireEnv('VITE_FB_PROJECT_ID'),
  storageBucket: requireEnv('VITE_FB_STORAGE_BUCKET'),
  appId: requireEnv('VITE_FB_APP_ID'),
}

const rosterFirebaseConfig = {
  apiKey: envWithFallback('VITE_FB_ROSTER_API_KEY', 'VITE_FB_API_KEY'),
  authDomain: envWithFallback('VITE_FB_ROSTER_AUTH_DOMAIN', 'VITE_FB_AUTH_DOMAIN'),
  projectId: envWithFallback('VITE_FB_ROSTER_PROJECT_ID', 'VITE_FB_PROJECT_ID'),
  storageBucket: envWithFallback(
    'VITE_FB_ROSTER_STORAGE_BUCKET',
    'VITE_FB_STORAGE_BUCKET',
  ),
  appId: envWithFallback('VITE_FB_ROSTER_APP_ID', 'VITE_FB_APP_ID'),
}

// --- Core app instances ---
export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const storage = getStorage(app)
// If you later add a region: getFunctions(app, import.meta.env.VITE_FB_FUNCTIONS_REGION)
export const functions = getFunctions(app)

// --- Firestore (default + secondary "roster") ---
const FIRESTORE_SETTINGS = { ignoreUndefinedProperties: true }

export const rosterApp = initializeApp(rosterFirebaseConfig, 'roster')

// Create BOTH instances with settings so they’re consistent
export const db = initializeFirestore(app, FIRESTORE_SETTINGS) // default DB
export const rosterDb: Firestore = initializeFirestore(
  rosterApp,
  FIRESTORE_SETTINGS,
) // secondary DB

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
