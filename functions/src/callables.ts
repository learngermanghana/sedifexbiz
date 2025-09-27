import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const STORE_CODE_PATTERN = /^[A-Z]{6}$/;

function normalizeStoreCode(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return '';
  }

  if (!STORE_CODE_PATTERN.test(trimmed)) {
    throw new functions.https.HttpsError('invalid-argument', 'Store code must be exactly six letters.');
  }

  return trimmed;
}

function normalizeContact(data: unknown) {
  if (!data || typeof data !== 'object') {
    return { phone: null as string | null, firstSignupEmail: null as string | null };
  }

  const contact = data as Record<string, unknown>;
  const rawPhone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
  const phone = rawPhone ? rawPhone : null;
  const rawFirstSignupEmail =
    typeof contact.firstSignupEmail === 'string' ? contact.firstSignupEmail.trim().toLowerCase() : '';
  const firstSignupEmail = rawFirstSignupEmail ? rawFirstSignupEmail : null;
  return { phone, firstSignupEmail };
}

export const backfillMyStore = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const uid = context.auth.uid;
  const token = context.auth.token as Record<string, unknown>;
  const email = typeof token.email === 'string' ? (token.email as string) : null;
  const phone = typeof token.phone_number === 'string' ? (token.phone_number as string) : null;

  const payload = data ?? {};
  const storeId = normalizeStoreCode((payload as Record<string, unknown>).storeCode);
  if (!storeId) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid store code is required.');
  }

  const { phone: contactPhone, firstSignupEmail: contactFirstSignupEmail } = normalizeContact(
    (payload as Record<string, unknown>).contact,
  );
  const resolvedPhone = contactPhone ?? phone;
  const resolvedFirstSignupEmail = contactFirstSignupEmail ?? email;
  const db = admin.firestore();

  const storeRef = db.doc(`stores/${storeId}`);
  const memberRef = db.doc(`stores/${storeId}/members/${uid}`);
  const mapRef = db.doc(`storeUsers/${storeId}_${uid}`);

  const [storeSnap, memberSnap, mapSnap] = await db.getAll(storeRef, memberRef, mapRef);
  if (storeSnap.exists) {
    const ownerId = storeSnap.get('ownerId');
    if (ownerId && ownerId !== uid) {
      throw new functions.https.HttpsError('already-exists', 'That store code is already in use.');
    }
  }

  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(
    storeRef,
    {
      storeId,
      id: storeId,
      ownerId: uid,
      ownerEmail: email,
      ownerPhone: resolvedPhone ?? null,
      firstSignupEmail: resolvedFirstSignupEmail ?? null,
      updatedAt: timestamp,
      ...(storeSnap.exists
        ? {}
        : { createdAt: timestamp, plan: 'free', status: 'active' }),
    },
    { merge: true },
  );

  if (!memberSnap.exists) {
    batch.set(
      memberRef,
      {
        uid,
        role: 'owner',
        email,
        phone: resolvedPhone ?? null,
        firstSignupEmail: resolvedFirstSignupEmail ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true },
    );
  } else {
    batch.set(
      memberRef,
      {
        phone: resolvedPhone ?? null,
        firstSignupEmail: resolvedFirstSignupEmail ?? null,
        updatedAt: timestamp,
      },
      { merge: true },
    );
  }

  batch.set(
    mapRef,
    {
      uid,
      storeId,
      role: 'owner',
      email,
      phone: resolvedPhone ?? null,
      firstSignupEmail: resolvedFirstSignupEmail ?? null,
      updatedAt: timestamp,
      ...(mapSnap.exists ? {} : { createdAt: timestamp }),
    },
    { merge: true },
  );

  await batch.commit();

  const membershipsSnapshot = await db.collection('storeUsers').where('uid', '==', uid).get();
  const stores = Array.from(
    new Set(
      membershipsSnapshot.docs
        .map(doc => doc.get('storeId'))
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
  const roleByStore = membershipsSnapshot.docs.reduce<Record<string, string>>((acc, doc) => {
    const membershipStoreId = doc.get('storeId');
    const membershipRole = doc.get('role');
    if (typeof membershipStoreId === 'string' && typeof membershipRole === 'string') {
      acc[membershipStoreId] = membershipRole;
    }
    return acc;
  }, {});

  const existingClaims = await admin
    .auth()
    .getUser(uid)
    .then(result => (result.customClaims ?? {}) as Record<string, unknown>)
    .catch(() => ({} as Record<string, unknown>));

  const activeStoreId = stores.includes(storeId)
    ? storeId
    : (typeof existingClaims.activeStoreId === 'string' && stores.includes(existingClaims.activeStoreId)
        ? (existingClaims.activeStoreId as string)
        : stores[0] ?? null);

  const nextClaims = {
    ...existingClaims,
    stores,
    activeStoreId,
    roleByStore,
  };

  await admin.auth().setCustomUserClaims(uid, nextClaims);

  return { ok: true, storeId, claims: nextClaims };
});
