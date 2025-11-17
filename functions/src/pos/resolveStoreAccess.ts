import * as functions from 'firebase-functions';
export const resolveStoreAccess = functions.https.onCall(async () => {
  return { ok: false, reason: 'resolveStoreAccess not implemented yet' };
});
