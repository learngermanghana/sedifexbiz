// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

import { firebaseEnv } from './config/firebaseEnv'

/**
 * Expected firebaseEnv fields:
 * - apiKey, authDomain, projectId, storageBucket, appId
 * - appCheckSiteKey (reCAPTCHA v3/Enterprise site key)
 * - appCheckDebugToken (optional)
 * - functionsRegion (e.g., "us-central1")
 */

const firebaseConfig = {
  apiKey: firebaseEnv.apiKey,
  authDomain: firebaseEnv.authDomain,
  projectId: firebaseEnv.projectId,
  storageBucket: firebaseEnv.storageBucket,
  appId: firebaseEnv.appId,
}

// --- Initialize app exactly once (avoids hot-reload duplicates) ---
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

// --- App Check: only in the browser, before Firestore/Functions usage ---
const isBrowser =
  typeof window !== 'undefined' && typeof document !== 'undefined'
const isTest = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test'

if (isBrowser && !isTest) {
  // Optional: enable debug token from env for local testing
  if (firebaseEnv.appCheckDebugToken) {
    ;(globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN =
      firebaseEnv.appCheckDebugToken
  }

  // IMPORTANT: Ensure your domains are allow-listed in App Check + Auth.
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(firebaseEnv.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}

// --- Auth ---
export const auth = getAuth(app)

// --- Functions: force the region to match your deploy (e.g., us-central1) ---
export const functions = getFunctions(
  app,
  firebaseEnv.functionsRegion || 'us-central1'
)

// --- Firestore: resilient networking + best local cache for the environment ---
const supportsPersistentCache = (() => {
  if (!isBrowser) return false
  const hasIndexedDB = 'indexedDB' in window && window.indexedDB !== null
  return hasIndexedDB
})()

const buildFirestoreOptions = () => ({
  // Helps on strict networks; detects when to switch to long polling
  experimentalAutoDetectLongPolling: true,
  // Keep your writes clean
  ignoreUndefinedProperties: true,
  // Prefer persistent, multi-tab cache when possible; fall back to memory
  localCache: supportsPersistentCache
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache(),
})

// Default Firestore
export const db = initializeFirestore(app, buildFirestoreOptions())

// Optional secondary DB (named instance), used by your app
export const rosterDb = initializeFirestore(app, buildFirestoreOptions(), 'roster')
