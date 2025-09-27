import * as functions from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();

export const onAuthCreate = functions.auth.user().onCreate(async (user) => {
  const db = getFirestore();
  const uid = user.uid;
  const storeId = uid; // simple 1:1 default

  const storeRef = db.doc(`stores/${storeId}`);
  const memberRef = db.doc(`stores/${storeId}/members/${uid}`);
  const mapRef = db.doc(`storeUsers/${storeId}_${uid}`);

  // Idempotent: only create if not already there
  const [storeSnap, memberSnap] = await db.getAll(storeRef, memberRef);
  const batch = db.batch();

  if (!storeSnap.exists) {
    batch.set(storeRef, {
      id: storeId,
      ownerId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      plan: 'free',
      status: 'active',
    });
  }

  if (!memberSnap.exists) {
    batch.set(memberRef, {
      uid,
      role: 'owner',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  batch.set(mapRef, {
    uid,
    storeId,
    role: 'owner',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // Set custom claims (storeId, role)
  await getAuth().setCustomUserClaims(uid, { storeId, role: 'owner' });
});
