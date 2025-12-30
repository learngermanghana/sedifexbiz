import { getApps, initializeApp } from 'firebase/app'
import {
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
    return initializeAuth(displayApp, { persistence: inMemoryPersistence })
  } catch {
    const auth = getAuth(displayApp)
    void setPersistence(auth, inMemoryPersistence)
    return auth
  }
})()

export const displayDb = initializeFirestore(displayApp, {
  ignoreUndefinedProperties: true,
})

let authReadyPromise: Promise<void> | null = null

export function ensureDisplayAuth() {
  if (!authReadyPromise) {
    authReadyPromise = (async () => {
      if (!displayAuth.currentUser) {
        await signInAnonymously(displayAuth)
      }
    })()
  }

  return authReadyPromise
}
