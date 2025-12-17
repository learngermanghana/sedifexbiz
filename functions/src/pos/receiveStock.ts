import * as functions from 'firebase-functions';
export const receiveStock = functions.https.onCall(async () => {
  return { ok: false, reason: 'receiveStock not implemented yet' };
});
