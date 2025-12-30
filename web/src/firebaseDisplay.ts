import { getApps, initializeApp } from 'firebase/app'
import {
  Auth,
  browserLocalPersistence,
  browserSessionPersistence,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth'
import { initializeFirestore } from 'firebase/firestore'
import { firebaseConfig } from './firebase'

const DISPLAY_APP_NAME = 'customer-display'

const displayApp =
  getApps().find(app => app.name === DISPLAY_APP_NAME) ??
  initializeApp(firebaseConfig, DISPLAY_APP_NAME)

const displayAuth = (() => {
  try {
    return initializeAuth(displayApp, { persistence: browserLocalPersistence })
  } catch {
    return getAuth(displayApp)
  }
})()

export const displayDb = initializeFirestore(displayApp, {
  ignoreUndefinedProperties: true,
})

let authReadyPromise: Promise<void> | null = null

async function configureDisplayPersistence(auth: Auth) {
  try {
    await setPersistence(auth, browserLocalPersistence)
    return
  } catch (error) {
    console.warn('[display-auth] Falling back from local persistence', error)
  }

  try {
    await setPersistence(auth, browserSessionPersistence)
  } catch (error) {
    console.warn('[display-auth] Falling back to in-memory persistence', error)
    await setPersistence(auth, inMemoryPersistence)
  }
}

export function ensureDisplayAuth() {
  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      await configureDisplayPersistence(displayAuth)
      if (!displayAuth.currentUser) {
        await signInAnonymously(displayAuth)
      }
      await displayAuth.currentUser?.getIdToken(true)
    })()
  }

  return authReadyPromise
}
