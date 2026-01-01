import * as functions from 'firebase-functions';
export const prepareReceiptShare = functions.https.onCall(async () => {
  return { ok: false, reason: 'prepareReceiptShare not implemented yet' };
});
