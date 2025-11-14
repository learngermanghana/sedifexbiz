// functions/src/firestore.ts
import * as admin from 'firebase-admin';
import { Firestore } from '@google-cloud/firestore';

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
const rosterDatabaseIdRaw =
  process.env.FIRESTORE_ROSTER_DATABASE_ID || process.env.ROSTER_DB_ID || 'roster';
const rosterDatabaseId = rosterDatabaseIdRaw.trim();
const useDefaultRosterDb =
  !rosterDatabaseId || rosterDatabaseId === 'default' || rosterDatabaseId === '(default)';

let rosterDb: FirebaseFirestore.Firestore;

if (useDefaultRosterDb) {
  rosterDb = defaultDb;
} else {
  // Secondary DB: named database (default: "roster")
  // For named databases we must use the @google-cloud/firestore client.
  const rosterOptions: ConstructorParameters<typeof Firestore>[0] = {
    databaseId: rosterDatabaseId,

    // prefer the REST transport in Cloud Functions Gen2 (often more reliable)
    // Safe to leave enabled elsewhere as well.
    preferRest: true,
  };

  if (projectId) {
    rosterOptions.projectId = projectId;
  }

  // When running against the emulator, @google-cloud/firestore honors the env var,
  // but we can be explicit to avoid surprises in some environments.
  if (isEmulator && emulatorHost) {
    const [host, portStr] = emulatorHost.split(':');
    const port = Number(portStr) || 8080;

    rosterOptions.host = host;
    rosterOptions.port = port;
    rosterOptions.ssl = false;
  }

  try {
    rosterDb = new Firestore(rosterOptions) as FirebaseFirestore.Firestore;
  } catch (error) {
    console.warn(
      `[firestore] Falling back to default database for roster (failed to init "${rosterDatabaseId}")`,
      error,
    );
    rosterDb = defaultDb;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export { admin, defaultDb, rosterDb };
