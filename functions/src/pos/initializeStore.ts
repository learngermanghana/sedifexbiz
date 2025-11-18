import * as functions from 'firebase-functions';
export const initializeStore = functions.https.onCall(async () => {
  return { ok: false, reason: 'initializeStore not implemented yet' };
});
