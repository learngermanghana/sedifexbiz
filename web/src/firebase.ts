// web/src/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth } from 'firebase/auth'
import { getFunctions } from 'firebase/functions'
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

import { firebaseEnv } from './config/firebaseEnv'
import runtimeEnv from './config/runtimeEnv'

/**
 * firebaseEnv must provide:
 * - apiKey, authDomain, projectId, storageBucket, appId
 * - appCheckSiteKey  (YOUR reCAPTCHA Enterprise site key)
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

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
const envMode = typeof runtimeEnv.MODE === 'string' ? runtimeEnv.MODE : undefined
const isTest = envMode === 'test'

if (isBrowser && !isTest) {
  if (firebaseEnv.appCheckDebugToken) {
    ;(globalThis as any).FIREBASE_APPCHECK_DEBUG_TOKEN = firebaseEnv.appCheckDebugToken
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(firebaseEnv.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}

export const auth = getAuth(app)

export const functions = getFunctions(app, firebaseEnv.functionsRegion || 'us-central1')

const supportsPersistentCache =
  isBrowser && 'indexedDB' in window && window.indexedDB !== null

const buildFirestoreOptions = () => ({
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
  localCache: supportsPersistentCache
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache(),
})

export const db = initializeFirestore(app, buildFirestoreOptions())
export const rosterDb = initializeFirestore(app, buildFirestoreOptions(), 'roster')
