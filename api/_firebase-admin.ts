import * as admin from "firebase-admin";

let app: admin.app.App | undefined;

export function getAdmin() {
  if (app) return app;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  const creds = JSON.parse(json);
  app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(creds),
        projectId: creds.project_id || process.env.FIREBASE_PROJECT_ID,
      });
  return app;
}

export const db = () => getAdmin().firestore();
