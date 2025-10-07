// ESM-compatible Firebase Admin singleton for Vercel Node functions
// Usage in other API files: `import { db } from "./_firebase-admin.js"`

import * as admin from "firebase-admin";

let app: admin.app.App | undefined;

/**
 * Load service account credentials from env.
 * - Prefer FIREBASE_SERVICE_ACCOUNT_JSON (full JSON string).
 * - Or FIREBASE_SERVICE_ACCOUNT_BASE64 (base64 of the same JSON).
 */
function loadServiceAccount(): admin.ServiceAccount {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson && rawJson.trim().startsWith("{")) {
    return JSON.parse(rawJson);
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (b64) {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  }

  throw new Error(
    "Missing service account: set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64 in Vercel env."
  );
}

/**
 * Initialize Admin SDK once per cold start.
 */
export function getAdmin(): admin.app.App {
  if (app) return app;

  const creds = loadServiceAccount();
  const projectId = process.env.FIREBASE_PROJECT_ID || (creds as any).project_id;

  app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(creds),
        projectId, // makes Firestore endpoint explicit when running outside GCP
      });

  return app;
}

/**
 * Convenient Firestore accessor.
 * Example:  const snap = await db().collection("sales").doc("x").get();
 */
export const db = () => getAdmin().firestore();

/**
 * (Optional) Export auth/storage if you need them later:
 *
 * export const auth = () => getAdmin().auth();
 * export const storage = () => getAdmin().storage();
 */
