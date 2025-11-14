// web/src/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
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

type RawEnsureCanonicalWorkspaceResponse = {
  ok?: unknown
  workspaceSlug?: unknown
  storeId?: unknown
  claims?: unknown
}

export type EnsureCanonicalWorkspaceResult = {
  ok: boolean
  workspaceSlug: string | null
  storeId: string | null
  claims?: unknown
}

const ensureCanonicalWorkspaceCallable = httpsCallable<
  undefined,
  RawEnsureCanonicalWorkspaceResponse
>(functions, 'ensureCanonicalWorkspace')

let ensureCanonicalWorkspacePromise: Promise<EnsureCanonicalWorkspaceResult> | null = null

export async function ensureCanonicalWorkspace(): Promise<EnsureCanonicalWorkspaceResult> {
  if (!ensureCanonicalWorkspacePromise) {
    ensureCanonicalWorkspacePromise = ensureCanonicalWorkspaceCallable()
      .then(response => {
        const payload = response?.data ?? {}

        const workspaceSlugRaw =
          typeof payload.workspaceSlug === 'string' ? payload.workspaceSlug.trim() : ''
        const storeIdRaw = typeof payload.storeId === 'string' ? payload.storeId.trim() : ''

        return {
          ok: payload.ok === true,
          workspaceSlug: workspaceSlugRaw || null,
          storeId: storeIdRaw || null,
          claims: payload.claims,
        }
      })
      .catch(error => {
        ensureCanonicalWorkspacePromise = null
        throw error
      })
  }

  return ensureCanonicalWorkspacePromise
}

const supportsPersistentCache =
  isBrowser && 'indexedDB' in window && window.indexedDB !== null

const buildFirestoreOptions = () => ({
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
  localCache: supportsPersistentCache
    ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    : memoryLocalCache(),
})

const rosterDatabaseIdRaw =
  typeof runtimeEnv.VITE_FIRESTORE_ROSTER_DATABASE_ID === 'string'
    ? runtimeEnv.VITE_FIRESTORE_ROSTER_DATABASE_ID
    : undefined

const rosterDatabaseId = (rosterDatabaseIdRaw ?? 'roster').trim()
const useDefaultRosterDb =
  rosterDatabaseId.length === 0 ||
  rosterDatabaseId === 'default' ||
  rosterDatabaseId === '(default)'

export const db = initializeFirestore(app, buildFirestoreOptions())

export const rosterDb = useDefaultRosterDb
  ? db
  : (() => {
      try {
        return initializeFirestore(app, buildFirestoreOptions(), rosterDatabaseId)
      } catch (error) {
        if (!isTest) {
          console.warn(
            `[firebase] Falling back to default Firestore for roster (failed to init "${rosterDatabaseId}")`,
            error,
          )
        }
        return db
      }
    })()
