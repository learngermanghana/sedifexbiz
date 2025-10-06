// web/src/firebase.ts
import { initializeApp } from 'firebase/app'
import { getAuth, RecaptchaVerifier } from 'firebase/auth'
import { initializeFirestore, enableIndexedDbPersistence } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

type FirebaseEnvKey =
  | 'VITE_FB_API_KEY'
  | 'VITE_FB_AUTH_DOMAIN'
  | 'VITE_FB_PROJECT_ID'
  | 'VITE_FB_STORAGE_BUCKET'
  | 'VITE_FB_APP_ID'
  | 'VITE_FB_DATABASE_ID'
  | 'VITE_FB_ROSTER_DATABASE_ID'

function requireFirebaseEnv(key: FirebaseEnvKey): string {
  const value = import.meta.env[key]
  if (typeof value === 'string' && value.trim() !== '') return value
  throw new Error(
    `[firebase] Missing required environment variable "${key}". ` +
      'Ensure the value is defined in your deployment configuration.'
  )
}

function getOptionalFirebaseEnv(key: FirebaseEnvKey): string | undefined {
  const value = import.meta.env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const firebaseConfig = {
  apiKey: requireFirebaseEnv('VITE_FB_API_KEY'),
  authDomain: requireFirebaseEnv('VITE_FB_AUTH_DOMAIN'),
  projectId: requireFirebaseEnv('VITE_FB_PROJECT_ID'),
  storageBucket: requireFirebaseEnv('VITE_FB_STORAGE_BUCKET'),
  appId: requireFirebaseEnv('VITE_FB_APP_ID'),
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

const firestoreSettings = { ignoreUndefinedProperties: true }

const primaryDatabaseId = getOptionalFirebaseEnv('VITE_FB_DATABASE_ID')
const rosterDatabaseId =
  getOptionalFirebaseEnv('VITE_FB_ROSTER_DATABASE_ID') ?? 'roster'

// Primary app data lives in the configured (or default) Firestore database.
export const db = primaryDatabaseId
  ? initializeFirestore(app, firestoreSettings, primaryDatabaseId)
  : initializeFirestore(app, firestoreSettings)

// The roster database stores team-member metadata used by access checks.
const rosterInstanceMatchesPrimary = (() => {
  if (!primaryDatabaseId) {
    return rosterDatabaseId === '(default)'
  }
  return rosterDatabaseId === primaryDatabaseId
})()

export const rosterDb = rosterInstanceMatchesPrimary
  ? db
  : initializeFirestore(app, firestoreSettings, rosterDatabaseId)

enableIndexedDbPersistence(db).catch(() => {
  /* multi-tab fallback handled */
})

export const storage = getStorage(app)

// If you have a region env, you can pass it; otherwise default project region is used.
export const functions = getFunctions(app /*, import.meta.env.VITE_FB_FUNCTIONS_REGION */)

export function setupRecaptcha(containerId = 'recaptcha-container') {
  return new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
}
