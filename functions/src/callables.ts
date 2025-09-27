import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

export const backfillMyStore = functions.https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const uid = context.auth.uid;
  const db = admin.firestore();
  const storeId = uid;

  const storeRef = db.doc(`stores/${storeId}`);
  const memberRef = db.doc(`stores/${storeId}/members/${uid}`);
  const mapRef = db.doc(`storeUsers/${storeId}_${uid}`);

  const [storeSnap, memberSnap] = await db.getAll(storeRef, memberRef);

  const batch = db.batch();
  if (!storeSnap.exists) {
    batch.set(storeRef, {
      id: storeId, ownerId: uid, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), plan: 'free', status: 'active',
    });
  }
  if (!memberSnap.exists) {
    batch.set(memberRef, { uid, role: 'owner', createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  batch.set(mapRef, { uid, storeId, role: 'owner', createdAt: admin.firestore.FieldValue.serverTimestamp() });

  await batch.commit();
  await admin.auth().setCustomUserClaims(uid, { storeId, role: 'owner' });

  return { ok: true, storeId };
});
