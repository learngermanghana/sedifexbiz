// functions/src/firestore.ts
import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'

// Ensure we only initialize the app once
try {
  admin.app()
} catch {
  admin.initializeApp()
}

// IMPORTANT:
// You recreated Firestore with a named database ID "default" (not the older "(default)").
// Tell the Admin SDK to use that database explicitly.
const app = admin.app()
const defaultDb = getFirestore(app, 'default')

// Keep ignoring undefined properties like before
if (typeof (defaultDb as any).settings === 'function') {
  defaultDb.settings({ ignoreUndefinedProperties: true })
}

// We no longer use a separate roster DB – point it at the same instance
const rosterDb = defaultDb

export { admin, defaultDb, rosterDb }
