// web/src/firebase.ts
import { initializeApp } from 'firebase/app'
import { getAuth, RecaptchaVerifier } from 'firebase/auth'
import { enableIndexedDbPersistence, initializeFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'
import { firebaseEnv } from './config/firebaseEnv'

const firebaseConfig = {
  apiKey: firebaseEnv.apiKey,
  authDomain: firebaseEnv.authDomain,
  projectId: firebaseEnv.projectId,
  storageBucket: firebaseEnv.storageBucket,
  appId: firebaseEnv.appId,
}

// --- Core app instances ---
export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, firebaseEnv.functionsRegion)

// --- Firestore ---
const FIRESTORE_SETTINGS = {
  ignoreUndefinedProperties: true,
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
}

const primaryDb = initializeFirestore(app, FIRESTORE_SETTINGS)
const rosterDbInstance = initializeFirestore(app, FIRESTORE_SETTINGS, 'roster')

export const db = primaryDb
export const rosterDb = rosterDbInstance

if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(primaryDb).catch(() => {
    // multi-tab/unsupported; safe to ignore
  })
}

// --- Helpers ---
export function setupRecaptcha(containerId = 'recaptcha-container') {
  // v10+ signature: new RecaptchaVerifier(auth, container, options)
  return new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
}
