// functions/src/firestore.ts
import * as admin from 'firebase-admin';

// ─────────────────────────────────────────────────────────────────────────────
// One-time Admin init
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// ─────────────────────────────────────────────────────────────────────────────
// Default DB: (default) via Admin SDK
const defaultDb = admin.firestore();
if (typeof defaultDb.settings === 'function') {
  defaultDb.settings({ ignoreUndefinedProperties: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Roster DB now always uses the default database. Having a single database keeps
// reads/writes consistent across the app and avoids confusion about where data
// lives.
const rosterDb = defaultDb;

// ─────────────────────────────────────────────────────────────────────────────
export { admin, defaultDb, rosterDb };
