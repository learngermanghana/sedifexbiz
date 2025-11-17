import * as admin from 'firebase-admin';

// ─────────────────────────────────────────────────────────────────────────────
// One-time Admin init
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// Common flags
const activeApp = admin.apps.length ? admin.app() : null;
const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  (activeApp?.options?.projectId as string | undefined) ||
  undefined;

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST; // e.g. "localhost:8080"
const isEmulator = Boolean(emulatorHost);

// ─────────────────────────────────────────────────────────────────────────────
// Default DB: (default) via Admin SDK
const defaultDb = admin.firestore();
if (typeof defaultDb.settings === 'function') {
  defaultDb.settings({ ignoreUndefinedProperties: true });
}

// If you really want to force Admin SDK through the emulator (usually not needed
// because Admin respects FIRESTORE_EMULATOR_HOST), you could uncomment below:
//
// if (isEmulator) {
//   // Admin SDK automatically uses the emulator when FIRESTORE_EMULATOR_HOST is set.
//   // This block is typically unnecessary.
// }

// ─────────────────────────────────────────────────────────────────────────────
// Secondary DB: named "roster"
// If you don't want a separate database, just use the default DB everywhere.
const rosterDb = defaultDb;

// ─────────────────────────────────────────────────────────────────────────────
export { admin, defaultDb, rosterDb };
