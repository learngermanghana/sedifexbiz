import { getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore } from 'firebase/firestore'
import { firebaseConfig } from './firebase'

const DISPLAY_APP_NAME = 'customer-display'

const displayApp =
  getApps().find(app => app.name === DISPLAY_APP_NAME) ??
  initializeApp(firebaseConfig, DISPLAY_APP_NAME)

getAuth(displayApp)

export const displayDb = initializeFirestore(displayApp, {
  ignoreUndefinedProperties: true,
})

export function ensureDisplayAuth() {
  return Promise.resolve()
}
