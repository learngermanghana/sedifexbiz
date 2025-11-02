import { initializeApp } from 'firebase/app'
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

const firebaseConfig = {
  apiKey: firebaseEnv.apiKey,
  authDomain: firebaseEnv.authDomain,
  projectId: firebaseEnv.projectId,
  storageBucket: firebaseEnv.storageBucket,
  appId: firebaseEnv.appId,
}

export const app = initializeApp(firebaseConfig)

const shouldInitializeAppCheck =
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  import.meta.env.MODE !== 'test'

if (shouldInitializeAppCheck) {
  const globalScope = globalThis as typeof globalThis & {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: string
  }

  if (firebaseEnv.appCheckDebugToken) {
    globalScope.FIREBASE_APPCHECK_DEBUG_TOKEN = firebaseEnv.appCheckDebugToken
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(firebaseEnv.appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}

export const auth = getAuth(app)

export const functions = getFunctions(app, firebaseEnv.functionsRegion)

const supportsPersistentCache = (() => {
  if (typeof window === 'undefined') {
    return false
  }

  const indexedDbAvailable = 'indexedDB' in window && window.indexedDB !== null
  const documentAvailable = typeof document !== 'undefined'

  return indexedDbAvailable && documentAvailable
})()

const buildFirestoreOptions = () => ({
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
  localCache: supportsPersistentCache
    ? persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      })
    : memoryLocalCache(),
})

export const db = initializeFirestore(app, buildFirestoreOptions())

export const rosterDb = initializeFirestore(app, buildFirestoreOptions(), 'roster')
