// functions/src/firestore.ts
import * as admin from 'firebase-admin';

// One-time Admin init
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// Single Firestore instance: DEFAULT database only
const defaultDb = admin.firestore();

// Safety: ignore undefined properties in writes
if (typeof defaultDb.settings === 'function') {
  defaultDb.settings({ ignoreUndefinedProperties: true });
}

// TEMP: keep the old name but point it to the same DB.
// All code that used `rosterDb` now talks to the default database.
const rosterDb = defaultDb;

export { admin, defaultDb, rosterDb };
