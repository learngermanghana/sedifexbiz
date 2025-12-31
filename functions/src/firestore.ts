// functions/src/firestore.ts
import * as admin from 'firebase-admin'

if (!admin.apps.length) {
  // In Cloud Functions, this is enough. Credentials come from the runtime SA automatically.
  admin.initializeApp()
}

const defaultDb = admin.firestore()
const rosterDb = defaultDb

export { admin, defaultDb, rosterDb }
