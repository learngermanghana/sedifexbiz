import * as functions from 'firebase-functions';
export const logReceiptShareAttempt = functions.https.onCall(async () => {
  return { ok: false, reason: 'logReceiptShareAttempt not implemented yet' };
});
