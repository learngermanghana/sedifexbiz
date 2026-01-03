import * as functions from 'firebase-functions';

export const commitSale = functions.https.onCall(async () => {
  return { ok: false, reason: 'commitSale not implemented yet' };
});
