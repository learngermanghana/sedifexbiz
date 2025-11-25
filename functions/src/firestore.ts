// functions/src/firestore.ts
import * as admin from 'firebase-admin'

/**
 * Single Admin app for all functions.
 * No network calls at import-time, just init.
 */
if (!admin.apps.length) {
  admin.initializeApp()
}

// Use one Firestore instance for everything
const defaultDb = admin.firestore()

// For now rosterDb is just an alias of defaultDb
const rosterDb = defaultDb

export { admin, defaultDb, rosterDb }
