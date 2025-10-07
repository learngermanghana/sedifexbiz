// web/src/firebase.ts
import { initializeApp } from 'firebase/app'
import { getAuth, RecaptchaVerifier } from 'firebase/auth'
import {
  getFirestore,
  enableIndexedDbPersistence,
  initializeFirestore,
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
  throw new Error(
    `[firebase] Missing ${key}. Add it to your env (local and Vercel).`
  )
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
export const functions = getFunctions(app /*, import.meta.env.VITE_FB_FUNCTIONS_REGION */)

// --- Firestore (default + secondary "roster") ---
// If you want ignoreUndefinedProperties, set it once with initializeFirestore
initializeFirestore(app, { ignoreUndefinedProperties: true })

// Default database (primary data)
export const db = getFirestore(app)

// Secondary database named exactly "roster"
export const rosterDb = getFirestore(app, 'roster')

// Optional: enable offline persistence (safe to ignore errors on multi-tab)
enableIndexedDbPersistence(db).catch(() => {})
// You can also enable for roster if desired:
enableIndexedDbPersistence(rosterDb).catch(() => {})

// --- Helpers ---
export function setupRecaptcha(containerId = 'recaptcha-container') {
  return new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
}
