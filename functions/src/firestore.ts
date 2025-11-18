import * as admin from 'firebase-admin';

// ─────────────────────────────────────────────────────────────────────────────
// One-time Admin init
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Firestore DB: this is your main project database
const defaultDb = admin.firestore();

// Ignore undefined properties (matches original behaviour)
if (typeof defaultDb.settings === 'function') {
  defaultDb.settings({ ignoreUndefinedProperties: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// "Roster" DB ALIAS
// Any code that used rosterDb before will now hit the default DB.
// This is the "force everything to default" part.
const rosterDb = defaultDb;

// Exports used everywhere in the codebase
export { admin, defaultDb, rosterDb };
