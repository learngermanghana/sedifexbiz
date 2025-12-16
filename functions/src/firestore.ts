// functions/src/firestore.ts
import * as admin from 'firebase-admin'

/**
 * Single Admin app for all functions.
 * Explicitly use application default credentials to avoid long
 * initialization timeouts when Firebase tries to auto-detect
 * credentials during function discovery.
 */
if (!admin.apps.length) {
  const firebaseConfig = process.env.FIREBASE_CONFIG
    ? undefined
    : { projectId: process.env.GCLOUD_PROJECT }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    ...firebaseConfig,
  })
}

// Use one Firestore instance for everything
const defaultDb = admin.firestore()

// For now rosterDb is just an alias of defaultDb
const rosterDb = defaultDb

export { admin, defaultDb, rosterDb }
